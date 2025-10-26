# Slither.io ESN Data Collector

A professional browser extension for collecting real-time game state data from Slither.io, optimized for Echo State Network (ESN) training and machine learning research.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome)](https://github.com/NickP005/slitherio-scraper/releases)
[![Python](https://img.shields.io/badge/Python-3.7+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/License-GPL--3.0-green.svg)](LICENSE)
[![Research](https://img.shields.io/badge/Purpose-Research-purple.svg)](https://github.com/NickP005/slitherio-scraper)

## Overview

This project provides a complete data collection system for the browser game Slither.io, designed specifically for machine learning research. The system captures high-frequency game state data using an advanced polar coordinate transformation that provides enhanced spatial resolution optimized for AI training.

### Key Features

- 🎯 **Real-time Data Collection**: 10Hz sampling rate with minimal performance impact
- 📊 **Polar Logarithmic Grid**: 64 angular × 24 radial bins with smart spatial distribution
- 🧠 **ESN-Optimized**: 4-channel data format designed for Echo State Networks
- ⚙️ **Easy Configuration**: User-friendly popup interface for settings
- 🔄 **Automatic Sync**: Seamless data transmission to your backend server
- 📈 **Live Statistics**: Real-time collection status and performance metrics

## Installation

### Method 1: Download from Releases (Recommended)

1. **Download the extension**:
   - Go to [Releases](https://github.com/NickP005/slitherio-scraper/releases)
   - Download the latest `slither-esn-extension.zip`

2. **Install in Chrome/Edge**:
   - Extract the ZIP file to a folder
   - Open `chrome://extensions/` (or `edge://extensions/`)
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extracted folder

3. **Configure the extension**:
   - Click the extension icon in your browser
   - Set your username and server host
   - Click "Save Settings"

### Method 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/NickP005/slitherio-scraper.git
cd slitherio-scraper/extension

# Install dependencies and build
npm install
npm run build

# Load the dist/ folder in Chrome as unpacked extension
```

## Backend Setup

### Quick Start

```bash
# Navigate to backend directory
cd backend

# Create a virtual environment (required on macOS/Linux)
python3 -m venv venv

# Activate the virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python run_server.py
```

The server will start on `http://127.0.0.1:5055` by default.

**Note**: On macOS and modern Linux systems, you must use a virtual environment to install Python packages. The commands above create an isolated environment for the backend dependencies.

### Running the Server (After Initial Setup)

Once you've completed the initial setup, you can start the server anytime with:

```bash
cd backend
source venv/bin/activate  # Activate virtual environment
python run_server.py      # Start server

# To stop: Press Ctrl+C
# To deactivate virtual environment: deactivate
```

### Configuration

The backend automatically serves configuration to connected clients via the `/config` endpoint. Key parameters:

- **Grid Resolution**: 64 angular × 24 radial bins
- **Sampling Rate**: 10 Hz
- **Alpha Warping**: 6.0 (frontal enhancement)
- **Data Channels**: Food, enemy bodies, own segments, enemy heads

## Usage

1. **Start the backend server** (see Backend Setup above)
2. **Open Slither.io** in your browser
3. **Configure the extension**:
   - Username: Your identifier for data sessions
   - Server Host: `http://127.0.0.1:5055` (default)
   - Enable debug mode if needed
4. **Start playing** - data collection begins automatically
5. **Monitor status** via the extension popup

## Data Format

The system collects data in a structured format optimized for machine learning:

### Grid Data
- **Dimensions**: 64 angular × 24 radial × 4 channels
- **Channels**: 
  - Channel 0: Food density
  - Channel 1: Enemy snake bodies
  - Channel 2: Own snake segments
  - Channel 3: Enemy snake heads

### Metadata
- **Position**: Snake coordinates and heading
- **Velocity**: Movement speed and direction
- **Game State**: Boost status, border distance
- **Input**: Mouse/keyboard commands

### Storage
Data is stored in Zarr format for efficient access and ML pipeline integration.

## Technical Details

### Polar Coordinate System

The system uses a polar logarithmic grid with angular warping to provide enhanced spatial resolution:

```javascript
// Logarithmic radial mapping for better range coverage
const radialIndex = Math.floor(RADIAL_BINS * Math.log(r / R_MIN) / Math.log(R_MAX / R_MIN));

// Angular warping for frontal enhancement (α = 6.0)
const warpedAngle = Math.log(1 + ALPHA * normalizedAngle) / Math.log(1 + ALPHA);
const angularIndex = Math.floor(ANGULAR_BINS * warpedAngle);
```

This provides:
- **Enhanced frontal resolution** for navigation-critical areas
- **Logarithmic radial spacing** for efficient range representation
- **Smooth spatial transitions** between grid cells

### Performance

- **Collection Rate**: 10 Hz (configurable)
- **Browser Impact**: < 2% CPU usage
- **Network Traffic**: ~50 KB/minute
- **Storage Rate**: ~1 MB/hour per session

## Development

### Project Structure

```
slitherio-scraper/
├── extension/           # Chrome extension source
│   ├── manifest.json   # Extension configuration
│   ├── popup/          # User interface
│   ├── content/        # Data collection scripts
│   └── background/     # Service worker
├── backend/            # Python data server
│   ├── data_collector_server.py
│   └── requirements.txt
└── README.md
```

### Building

```bash
cd extension
npm run build      # Build extension
npm run validate   # Validate manifest
```

### Testing

```bash
cd backend
python -m pytest  # Run backend tests
```

## Research Applications

This system is designed for:

- **Echo State Network** training and evaluation
- **Reinforcement Learning** agent development
- **Game AI** behavior analysis
- **Spatial reasoning** research
- **Real-time decision making** studies

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Citation

If you use this system in your research, please cite:

```bibtex
@software{slither_esn_collector,
  title = {Slither.io ESN Data Collector},
  author = {NickP005},
  year = {2025},
  url = {https://github.com/NickP005/slitherio-scraper},
  version = {1.0}
}
```

## Support

- 📚 [Documentation](https://github.com/NickP005/slitherio-scraper/wiki)
- 🐛 [Report Issues](https://github.com/NickP005/slitherio-scraper/issues)
- 💬 [Discussions](https://github.com/NickP005/slitherio-scraper/discussions)

---

**Note**: This tool is designed for research purposes. Please respect Slither.io's terms of service and use responsibly.