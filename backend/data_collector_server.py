#!/usr/bin/env python3
"""
Slither.io ESN Data Collector Backend Server

This server receives game state data from the Tampermonkey userscript
and stores it in Zarr format optimized for ESN training.
"""

import asyncio
import json
import time
import numpy as np
import zarr
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging

# ===========================================
# CONFIGURATION
# ===========================================
CONFIG = {
    # Server settings
    'HOST': '127.0.0.1',
    'PORT': 5055,
    'DEBUG': True,

    # Data storage
    'DATA_DIR': Path('./data'),
    'CHUNK_SIZE': 512,  # Frames per chunk for Zarr
    'BUFFER_SIZE': 200,  # Frames to buffer before writing
    'MAX_SESSION_GAP_SECONDS': 30,  # Max gap before considering new session

    # Data validation
    'MAX_VELOCITY': 1000.0,  # Max reasonable velocity in game units/second
    'MIN_GAME_RADIUS': 10000,  # Min reasonable game radius
    'MAX_GAME_RADIUS': 50000,  # Max reasonable game radius

    # Grid validation
    'EXPECTED_ANGULAR_BINS': 64,
    'EXPECTED_RADIAL_BINS': 24,
    'EXPECTED_CHANNELS': 4,
}

# ===========================================
# DATA COLLECTION PARAMETERS (served to clients)
# ===========================================
COLLECTION_CONFIG = {
    # Grid configuration
    'ANGULAR_BINS': 64,           # Number of angular bins
    'RADIAL_BINS': 24,           # Number of radial bins
    'ALPHA_WARP': 6.0,           # Angular warping factor for front density
    'R_MIN': 60,                 # Minimum radius in game units
    'R_MAX': 3200,               # Maximum radius in game units

    # Sampling
    'SAMPLE_RATE_HZ': 10,        # Data collection frequency (Hz)
    'EMA_ALPHA': 0.05,           # Exponential moving average factor

    # Normalization
    'FOOD_NORM_FACTOR': 10.0,    # Food density normalization
    'SNAKE_NORM_FACTOR': 5.0,    # Snake density normalization
    'HEAD_WEIGHT': 3.0,          # Weight multiplier for enemy heads

    # Debug
    'DEBUG_LOG': True,           # Enable debug logging
    'STATS_INTERVAL': 100,       # Frames between statistics logging
}

# ===========================================
# LOGGING SETUP
# ===========================================
logging.basicConfig(
    level=logging.INFO if CONFIG['DEBUG'] else logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('slither-collector')

# ===========================================
# DATA MODELS
# ===========================================
class SessionData:
    def __init__(self, session_id: str, username: str = "unknown", client_ip: str = "unknown"):
        self.session_id = session_id
        self.username = username
        self.client_ip = client_ip
        self.start_time = time.time()
        self.last_frame_time = time.time()
        self.frame_count = 0
        self.valid_frames = 0
        self.errors = 0

        # Data buffers
        self.buffer: List[Dict[str, Any]] = []
        self.zarr_store = None
        self.zarr_group = None

        # Statistics
        self.stats = {
            'total_food_seen': 0,
            'total_enemies_seen': 0,
            'avg_velocity': 0.0,
            'boost_time': 0.0,
            'game_radius': None
        }

        logger.info(f"New session created: {session_id} for user {username} from {client_ip}")

    def is_expired(self, max_gap_seconds: float) -> bool:
        return (time.time() - self.last_frame_time) > max_gap_seconds

    def add_frame(self, frame_data: Dict[str, Any]) -> bool:
        """Add frame to buffer and return True if buffer should be flushed"""
        try:
            # Validate frame data
            if not self._validate_frame(frame_data):
                self.errors += 1
                return False

            self.buffer.append(frame_data)
            self.frame_count += 1
            self.valid_frames += 1
            self.last_frame_time = time.time()

            # Update statistics
            self._update_stats(frame_data)

            # Check if buffer should be flushed
            return len(self.buffer) >= CONFIG['BUFFER_SIZE']

        except Exception as e:
            logger.error(f"Error adding frame to session {self.session_id}: {e}")
            self.errors += 1
            return False

    def _validate_frame(self, frame_data: Dict[str, Any]) -> bool:
        """Validate frame data structure and values"""
        try:
            # Check required fields
            required_fields = ['grid', 'gridMeta', 'metadata', 'playerInput', 'validation']
            for field in required_fields:
                if field not in frame_data:
                    logger.warning(f"Missing required field: {field}")
                    return False

            # Validate grid dimensions
            grid_meta = frame_data['gridMeta']
            expected_size = (grid_meta['angularBins'] *
                           grid_meta['radialBins'] *
                           grid_meta['channels'])

            if len(frame_data['grid']) != expected_size:
                logger.warning(f"Grid size mismatch: expected {expected_size}, got {len(frame_data['grid'])}")
                return False

            # Validate metadata ranges
            metadata = frame_data['metadata']

            # Check velocity is reasonable
            if metadata['velocity'] > CONFIG['MAX_VELOCITY']:
                logger.warning(f"Velocity too high: {metadata['velocity']}")
                return False

            # Check game radius is reasonable
            if metadata.get('gameRadius'):
                gr = metadata['gameRadius']
                if gr < CONFIG['MIN_GAME_RADIUS'] or gr > CONFIG['MAX_GAME_RADIUS']:
                    logger.warning(f"Game radius out of range: {gr}")
                    return False

            # Check distance to border is non-negative
            if metadata['distanceToBorder'] < 0:
                logger.warning(f"Negative distance to border: {metadata['distanceToBorder']}")
                return False

            return True

        except Exception as e:
            logger.error(f"Frame validation error: {e}")
            return False

    def _update_stats(self, frame_data: Dict[str, Any]):
        """Update session statistics"""
        try:
            metadata = frame_data['metadata']
            debug = frame_data.get('debug', {})

            # Update averages
            n = self.valid_frames
            self.stats['avg_velocity'] = ((n - 1) * self.stats['avg_velocity'] + metadata['velocity']) / n

            # Accumulate counts
            self.stats['total_food_seen'] += debug.get('foodCount', 0)
            self.stats['total_enemies_seen'] += debug.get('enemySegments', 0)

            # Update boost time
            if metadata.get('boost'):
                self.stats['boost_time'] += frame_data.get('deltaTime', 0.1)

            # Set game radius (should be constant per session)
            if not self.stats['game_radius'] and metadata.get('gameRadius'):
                self.stats['game_radius'] = metadata['gameRadius']

        except Exception as e:
            logger.error(f"Error updating stats: {e}")

    def flush_buffer(self) -> bool:
        """Write buffered data to Zarr storage"""
        if not self.buffer:
            return True

        try:
            if not self.zarr_store:
                self._init_zarr_storage()

            batch_size = len(self.buffer)
            start_idx = self.zarr_group.attrs.get('frames_written', 0)
            end_idx = start_idx + batch_size

            # Prepare arrays
            grids = np.zeros((batch_size, CONFIG['EXPECTED_ANGULAR_BINS'],
                            CONFIG['EXPECTED_RADIAL_BINS'], CONFIG['EXPECTED_CHANNELS']),
                           dtype=np.float16)

            timestamps = np.zeros(batch_size, dtype=np.float64)
            headings = np.zeros(batch_size, dtype=np.float32)
            velocities = np.zeros(batch_size, dtype=np.float32)
            distances_to_border = np.zeros(batch_size, dtype=np.float32)
            boost_states = np.zeros(batch_size, dtype=np.bool_)

            player_inputs = np.zeros((batch_size, 3), dtype=np.float32)  # mx, my, boost

            # Fill arrays
            for i, frame in enumerate(self.buffer):
                # Reshape grid data
                grid_flat = np.array(frame['grid'], dtype=np.float16)
                grids[i] = grid_flat.reshape(CONFIG['EXPECTED_ANGULAR_BINS'],
                                           CONFIG['EXPECTED_RADIAL_BINS'],
                                           CONFIG['EXPECTED_CHANNELS'])

                # Scalar data
                timestamps[i] = frame['timestamp']
                headings[i] = frame['metadata']['heading']
                velocities[i] = frame['metadata']['velocity']
                distances_to_border[i] = frame['metadata']['distanceToBorder']
                boost_states[i] = frame['metadata']['boost']

                # Player input
                pi = frame['playerInput']
                player_inputs[i] = [pi['mx'], pi['my'], pi['boost']]

            # Extend Zarr arrays
            self._extend_zarr_array('grids', grids, start_idx, end_idx)
            self._extend_zarr_array('timestamps', timestamps, start_idx, end_idx)
            self._extend_zarr_array('headings', headings, start_idx, end_idx)
            self._extend_zarr_array('velocities', velocities, start_idx, end_idx)
            self._extend_zarr_array('distances_to_border', distances_to_border, start_idx, end_idx)
            self._extend_zarr_array('boost_states', boost_states, start_idx, end_idx)
            self._extend_zarr_array('player_inputs', player_inputs, start_idx, end_idx)

            # Update metadata
            self.zarr_group.attrs['frames_written'] = end_idx
            self.zarr_group.attrs['last_update'] = time.time()
            self.zarr_group.attrs['stats'] = self.stats

            logger.info(f"Flushed {batch_size} frames to storage for session {self.session_id}")

            # Clear buffer
            self.buffer.clear()
            return True

        except Exception as e:
            logger.error(f"Error flushing buffer for session {self.session_id}: {e}")
            return False

    def _init_zarr_storage(self):
        """Initialize Zarr storage for this session"""
        # Create user-specific directory structure: data/username/session_timestamp/
        user_dir = CONFIG['DATA_DIR'] / self.username
        session_dir = user_dir / f"session_{self.session_id}"
        session_dir.mkdir(parents=True, exist_ok=True)
        
        # Save session metadata
        metadata_file = session_dir / "metadata.json"
        metadata = {
            "session_id": self.session_id,
            "username": self.username,
            "client_ip": self.client_ip,
            "start_time": self.start_time,
            "start_time_iso": datetime.fromtimestamp(self.start_time).isoformat(),
            "config": COLLECTION_CONFIG
        }
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

        self.zarr_store = zarr.DirectoryStore(str(session_dir))
        self.zarr_group = zarr.group(store=self.zarr_store, overwrite=False)

        # Initialize arrays if they don't exist
        if 'grids' not in self.zarr_group:
            # Create resizable arrays
            self.zarr_group.create_dataset(
                'grids',
                shape=(0, CONFIG['EXPECTED_ANGULAR_BINS'], CONFIG['EXPECTED_RADIAL_BINS'], CONFIG['EXPECTED_CHANNELS']),
                chunks=(CONFIG['CHUNK_SIZE'], CONFIG['EXPECTED_ANGULAR_BINS'], CONFIG['EXPECTED_RADIAL_BINS'], CONFIG['EXPECTED_CHANNELS']),
                dtype=np.float16,
                compressor=zarr.Blosc(cname='zstd', clevel=3),
                fill_value=0.0
            )

            self.zarr_group.create_dataset(
                'timestamps',
                shape=(0,), chunks=(CONFIG['CHUNK_SIZE'],),
                dtype=np.float64, fill_value=0.0
            )

            self.zarr_group.create_dataset(
                'headings',
                shape=(0,), chunks=(CONFIG['CHUNK_SIZE'],),
                dtype=np.float32, fill_value=0.0
            )

            self.zarr_group.create_dataset(
                'velocities',
                shape=(0,), chunks=(CONFIG['CHUNK_SIZE'],),
                dtype=np.float32, fill_value=0.0
            )

            self.zarr_group.create_dataset(
                'distances_to_border',
                shape=(0,), chunks=(CONFIG['CHUNK_SIZE'],),
                dtype=np.float32, fill_value=0.0
            )

            self.zarr_group.create_dataset(
                'boost_states',
                shape=(0,), chunks=(CONFIG['CHUNK_SIZE'],),
                dtype=np.bool_, fill_value=False
            )

            self.zarr_group.create_dataset(
                'player_inputs',
                shape=(0, 3), chunks=(CONFIG['CHUNK_SIZE'], 3),
                dtype=np.float32, fill_value=0.0
            )

            # Store session metadata
            self.zarr_group.attrs['session_id'] = self.session_id
            self.zarr_group.attrs['start_time'] = self.start_time
            self.zarr_group.attrs['config'] = CONFIG
            self.zarr_group.attrs['frames_written'] = 0

            logger.info(f"Initialized Zarr storage for session {self.session_id}")

    def _extend_zarr_array(self, name: str, data: np.ndarray, start_idx: int, end_idx: int):
        """Extend a Zarr array with new data"""
        array = self.zarr_group[name]

        # Resize array if needed
        if end_idx > array.shape[0]:
            new_shape = list(array.shape)
            new_shape[0] = end_idx
            array.resize(new_shape)

        # Write data
        if len(data.shape) == 1:
            array[start_idx:end_idx] = data
        else:
            array[start_idx:end_idx, ...] = data

    def finalize(self):
        """Finalize session and flush remaining data"""
        if self.buffer:
            self.flush_buffer()

        if self.zarr_group:
            self.zarr_group.attrs['end_time'] = time.time()
            self.zarr_group.attrs['final_stats'] = self.stats
            self.zarr_group.attrs['frame_count'] = self.frame_count
            self.zarr_group.attrs['valid_frames'] = self.valid_frames
            self.zarr_group.attrs['errors'] = self.errors

        logger.info(f"Session {self.session_id} finalized with {self.valid_frames} valid frames")


# ===========================================
# SERVER CLASS
# ===========================================
class DataCollectorServer:
    def __init__(self):
        self.sessions: Dict[str, SessionData] = {}
        self.app = FastAPI(title="Slither.io ESN Data Collector", version="1.0.0")
        self.setup_middleware()
        self.setup_routes()

        # Ensure data directory exists
        CONFIG['DATA_DIR'].mkdir(parents=True, exist_ok=True)

        logger.info("Data Collector Server initialized")

    def setup_middleware(self):
        """Setup CORS and other middleware"""
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def setup_routes(self):
        """Setup API routes"""

        @self.app.post("/ingest")
        async def ingest_data(request: Request):
            """Receive and process game state data"""
            try:
                data = await request.json()
                session_id = data.get('sessionId')
                username = data.get('username', 'unknown')
                
                # Get client IP
                client_ip = request.client.host if request.client else 'unknown'
                
                # Check for forwarded IP headers (if behind proxy)
                if 'x-forwarded-for' in request.headers:
                    client_ip = request.headers['x-forwarded-for'].split(',')[0].strip()
                elif 'x-real-ip' in request.headers:
                    client_ip = request.headers['x-real-ip']

                if not session_id:
                    raise HTTPException(status_code=400, detail="Missing sessionId")

                # Get or create session with user info
                session = self.get_or_create_session(session_id, username, client_ip)

                # Add frame to session
                should_flush = session.add_frame(data)

                # Flush if needed
                if should_flush:
                    success = session.flush_buffer()
                    if not success:
                        logger.error(f"Failed to flush buffer for session {session_id}")

                return {"status": "ok", "session": session_id}

            except Exception as e:
                logger.error(f"Error processing ingest request: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.get("/sessions")
        async def get_sessions():
            """Get information about active sessions"""
            session_info = {}
            for sid, session in self.sessions.items():
                session_info[sid] = {
                    'frame_count': session.frame_count,
                    'valid_frames': session.valid_frames,
                    'errors': session.errors,
                    'stats': session.stats,
                    'buffer_size': len(session.buffer),
                    'last_frame_time': session.last_frame_time,
                    'is_expired': session.is_expired(CONFIG['MAX_SESSION_GAP_SECONDS'])
                }
            return session_info

        @self.app.get("/sessions/{session_id}/stats")
        async def get_session_stats(session_id: str):
            """Get detailed statistics for a session"""
            if session_id not in self.sessions:
                raise HTTPException(status_code=404, detail="Session not found")

            session = self.sessions[session_id]
            return {
                'session_id': session_id,
                'frame_count': session.frame_count,
                'valid_frames': session.valid_frames,
                'errors': session.errors,
                'stats': session.stats,
                'buffer_size': len(session.buffer),
                'start_time': session.start_time,
                'last_frame_time': session.last_frame_time
            }

        @self.app.post("/sessions/{session_id}/flush")
        async def flush_session(session_id: str):
            """Manually flush a session's buffer"""
            if session_id not in self.sessions:
                raise HTTPException(status_code=404, detail="Session not found")

            session = self.sessions[session_id]
            success = session.flush_buffer()

            return {"status": "ok" if success else "error", "session": session_id}

        @self.app.get("/health")
        async def health_check():
            """Health check endpoint"""
            return {
                "status": "healthy",
                "active_sessions": len(self.sessions),
                "data_dir": str(CONFIG['DATA_DIR']),
                "config": COLLECTION_CONFIG
            }

        @self.app.get("/config")
        async def get_collection_config():
            """Get data collection configuration parameters"""
            return {
                "status": "ok",
                "config": COLLECTION_CONFIG,
                "server_version": "2.0.0",
                "timestamp": time.time()
            }

        @self.app.get("/latest")
        async def get_latest_data():
            """Get the latest frame data for real-time visualization"""
            # Find the most recent frame from all active sessions
            latest_frame = None
            latest_timestamp = 0
            
            for session in self.sessions.values():
                if session.buffer:
                    # Get the most recent frame from this session's buffer
                    recent_frame = session.buffer[-1]
                    frame_timestamp = recent_frame.get('timestamp', 0)
                    
                    if frame_timestamp > latest_timestamp:
                        latest_timestamp = frame_timestamp
                        latest_frame = recent_frame
            
            if latest_frame:
                return latest_frame
            else:
                raise HTTPException(status_code=404, detail="No recent data available")

    def get_or_create_session(self, session_id: str, username: str = "unknown", client_ip: str = "unknown") -> SessionData:
        """Get existing session or create new one"""
        if session_id in self.sessions:
            return self.sessions[session_id]

        session = SessionData(session_id, username, client_ip)
        self.sessions[session_id] = session
        return session

    def cleanup_expired_sessions(self):
        """Clean up expired sessions"""
        expired_sessions = []

        for session_id, session in self.sessions.items():
            if session.is_expired(CONFIG['MAX_SESSION_GAP_SECONDS']):
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            session = self.sessions.pop(session_id)
            session.finalize()
            logger.info(f"Cleaned up expired session: {session_id}")

    async def start_background_tasks(self):
        """Start background maintenance tasks"""
        async def cleanup_task():
            while True:
                await asyncio.sleep(60)  # Run every minute
                self.cleanup_expired_sessions()

        asyncio.create_task(cleanup_task())

    def run(self):
        """Run the server"""
        logger.info(f"Starting server on {CONFIG['HOST']}:{CONFIG['PORT']}")

        # Create startup event handler for background tasks
        @self.app.on_event("startup")
        async def startup_event():
            await self.start_background_tasks()

        uvicorn.run(
            self.app,
            host=CONFIG['HOST'],
            port=CONFIG['PORT'],
            log_level="info" if CONFIG['DEBUG'] else "warning"
        )


# ===========================================
# MAIN
# ===========================================
def main():
    """Main entry point"""
    server = DataCollectorServer()
    server.run()


if __name__ == "__main__":
    main()