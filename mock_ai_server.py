#!/usr/bin/env python3
"""
Mock AI WebSocket Server for Testing Slither.io AI Control

This server simulates an ESN AI by accepting frame data and returning
simple control commands that make the snake move in circles.

Usage:
    python mock_ai_server.py

Then in the browser extension:
    - Connect to ws://127.0.0.1:8765
    - Start AI Control
    - Watch the snake move in circles!
"""

import asyncio
import websockets
import json
import time
import math
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('MockAIServer')

class MockAIServer:
    def __init__(self, host='127.0.0.1', port=8765):
        self.host = host
        self.port = port
        self.active_connection = None
        self.frame_count = 0
        
        # Mock AI behavior parameters
        self.circle_radius = 0.08  # Angle delta per frame for circular motion (~4.5 degrees)
        self.boost_interval = 50    # Boost every N frames
        self.confidence = 0.9       # Mock confidence
        
    async def handle_client(self, websocket):
        # Only one connection at a time
        if self.active_connection is not None:
            logger.warning(f"Rejecting connection - server busy")
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Server busy - another client connected"
            }))
            await websocket.close()
            return
        
        self.active_connection = websocket
        self.frame_count = 0
        
        logger.info(f"✅ Client connected")
        
        # Send ready message
        session_id = str(int(time.time() * 1000))
        await websocket.send(json.dumps({
            "type": "ready",
            "sessionId": session_id,
            "modelInfo": {
                "reservoirSize": 1000,
                "expectedPerformance": {
                    "angularError": 36,
                    "boostAccuracy": 0.81
                }
            }
        }))
        logger.info(f"📤 Sent ready message (session: {session_id})")
        
        try:
            async for message in websocket:
                start_time = time.time()
                
                # Parse frame data
                try:
                    frame_data = json.loads(message)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse JSON: {e}")
                    continue
                
                self.frame_count += 1
                
                # Generate mock AI command
                command = self.generate_command(frame_data)
                
                # Calculate processing time
                processing_time = time.time() - start_time
                
                # Build response
                response = {
                    "type": "control",
                    "timestamp": time.time(),
                    "frameIndex": frame_data.get('frameIndex', 0),
                    "command": command,
                    "confidence": self.confidence,
                    "meta": {
                        "processingTime": processing_time,
                        "predictedAngle": frame_data['metadata']['heading'] + command['angleDelta']
                    }
                }
                
                # Send response
                await websocket.send(json.dumps(response))
                
                # Log every 50 frames
                if self.frame_count % 50 == 1:
                    logger.info(f"📊 Processed {self.frame_count} frames | "
                              f"Latency: {processing_time*1000:.1f}ms | "
                              f"Current heading: {frame_data['metadata']['heading']:.2f} rad")
                
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"❌ Client disconnected: {e.code} - {e.reason}")
        except Exception as e:
            logger.error(f"⚠️  Error handling client: {e}", exc_info=True)
        finally:
            self.active_connection = None
            logger.info(f"🏁 Session ended. Total frames: {self.frame_count}")
    
    def generate_command(self, frame_data):
        """
        Generate a simple mock command that makes the snake move in circles
        """
        # Make the snake turn in circles
        # Positive angleDelta = turn left (counter-clockwise)
        angle_delta = self.circle_radius
        
        # Alternate direction every 200 frames for variety
        if (self.frame_count // 200) % 2 == 1:
            angle_delta = -self.circle_radius  # Turn right
        
        # Boost periodically
        boost = (self.frame_count % self.boost_interval) < 10  # Boost for 10 frames every N
        
        # Add some randomness for more natural movement
        if self.frame_count % 100 == 0:
            angle_delta *= 1.5  # Sharper turn occasionally
        
        command = {
            "angleDelta": angle_delta,
            "boost": boost
        }
        
        return command
    
    async def start(self):
        """Start the WebSocket server"""
        logger.info(f"🚀 Mock AI Server starting on ws://{self.host}:{self.port}")
        logger.info("=" * 60)
        logger.info("Server behavior:")
        logger.info(f"  - Circle motion: {self.circle_radius:.3f} rad/frame (~{math.degrees(self.circle_radius):.1f}°)")
        logger.info(f"  - Boost interval: every {self.boost_interval} frames")
        logger.info(f"  - Direction change: every 200 frames")
        logger.info("=" * 60)
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            logger.info("✨ Server ready - waiting for connections...")
            await asyncio.Future()  # Run forever

def main():
    """Main entry point"""
    print("""
╔═══════════════════════════════════════════════════════════╗
║         Slither.io Mock AI WebSocket Server              ║
║                                                           ║
║  This server simulates an ESN AI for testing purposes    ║
║  The snake will move in circles and boost periodically   ║
╚═══════════════════════════════════════════════════════════╝
    """)
    
    server = MockAIServer(host='127.0.0.1', port=8765)
    
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("\n🛑 Server stopped by user")
        print("\nGoodbye! 👋")
    except Exception as e:
        logger.error(f"💥 Server error: {e}", exc_info=True)

if __name__ == "__main__":
    main()
