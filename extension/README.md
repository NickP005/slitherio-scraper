# Browser Extension Installation Guide

## Overview

The Slither.io ESN Data Collector Browser Extension provides a user-friendly interface for collecting game data directly from your browser, eliminating the need for userscripts.

## Features

- **Easy Configuration**: Set username and server host through a clean popup interface
- **Real-time Status**: Monitor connection status and collection statistics
- **Advanced Settings**: Configure sample rate, alpha warping, and other parameters
- **Auto-start**: Automatically begin collection when joining a game
- **Debug Mode**: Enable detailed logging for troubleshooting

## Installation Methods

### Method 1: From GitHub Releases (Recommended)

1. Go to the [Releases page](https://github.com/NickP005/slitherio-scraper/releases)
2. Download the latest `slither-esn-extension.zip`
3. Extract the ZIP file to a folder
4. Open Chrome/Edge and navigate to `chrome://extensions/`
5. Enable "Developer mode" (toggle in top-right)
6. Click "Load unpacked" and select the extracted folder
7. The extension icon should appear in your browser toolbar

### Method 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/NickP005/slitherio-scraper.git
cd slitherio-scraper/extension

# Install dependencies and build
npm install
npm run build

# The built extension will be in the 'dist' folder
# Load this folder as an unpacked extension in Chrome
```

## Configuration

1. **Click the extension icon** in your browser toolbar
2. **Enter your username** (will be included in collected data)
3. **Set server host** (default: `http://127.0.0.1:5055`)
4. **Click "Save Settings"**
5. **Test connection** to verify server is running

### Advanced Settings

- **Sample Rate**: Data collection frequency (default: 10 Hz)
- **Alpha Warp**: Angular warping factor (default: 6.0)
- **Auto-start**: Begin collection automatically when game starts
- **Debug Mode**: Enable detailed console logging

## Usage

1. **Start your backend server** (see main README)
2. **Configure the extension** with your settings
3. **Navigate to [slither.io](https://slither.io)**
4. **Start playing** - collection begins automatically
5. **Monitor status** via the extension popup

## Extension Status Indicators

- 🔴 **Disconnected**: Extension not active or no server connection
- 🟡 **Connected**: Extension ready, waiting for game to start
- 🟢 **Collecting**: Actively collecting data from gameplay

## Troubleshooting

### Extension Not Working
- Ensure you're on `slither.io` or `slither.com`
- Check that Developer Mode is enabled
- Refresh the page after installing/updating the extension

### Connection Issues
- Verify backend server is running on specified host/port
- Check firewall settings for local connections
- Test connection using the "Test Connection" button

### Data Not Collecting
- Ensure auto-start is enabled or manually start collection
- Check browser console for error messages (F12 → Console)
- Verify game has fully loaded before starting collection

## Development

### Project Structure

```
extension/
├── manifest.json           # Extension manifest
├── popup/                  # Extension popup UI
│   ├── popup.html
│   └── popup.js
├── content/               # Content scripts
│   ├── data-collector.js  # Main content script
│   └── injected-script.js # Game context script
├── background/            # Service worker
│   └── background.js
├── icons/                 # Extension icons
└── scripts/              # Build scripts
    └── validate-manifest.js
```

### Building

```bash
npm run build    # Build extension
npm run pack     # Create ZIP package
npm run dev      # Build and package
```

### Testing

1. Load unpacked extension in Chrome
2. Enable debug mode in extension settings
3. Open browser console to monitor logs
4. Test on slither.io with backend server running

## Permissions Explained

- **activeTab**: Access current tab when extension is used
- **storage**: Save user settings and configuration
- **scripting**: Inject data collection scripts into game pages

## Privacy & Security

- Extension only activates on Slither.io domains
- No data is sent to external servers (only your configured backend)
- All data collection is transparent and user-controlled
- Settings are stored locally in browser storage

## Chrome Web Store

Currently distributed as an unpacked extension for research use. Future versions may be published to the Chrome Web Store for easier distribution.

## Support

For issues with the extension:
1. Check browser console for error messages
2. Join our [Discord community](https://discord.gg/Q5jM8HJhNT)
3. Create an issue on [GitHub](https://github.com/NickP005/slitherio-scraper/issues)