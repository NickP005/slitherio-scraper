# Installation Guide

Quick installation guide for the Slither.io ESN Data Collector. For complete documentation, see the main [README](README.md).

## Browser Extension (Recommended)

1. **Download and build the extension**:
   ```bash
   git clone https://github.com/NickP005/slitherio-scraper.git
   cd slitherio-scraper/extension
   npm install && npm run build
   ```

2. **Load in browser**:
   - Chrome/Edge: `chrome://extensions/` → Enable Developer mode → Load unpacked → Select `extension/dist`

3. **Configure**: Click extension icon → Set username and server host

See [Extension README](extension/README.md) for detailed instructions.

## Tampermonkey Userscript (Alternative)

### 1. Install Tampermonkey

Install the [Tampermonkey extension](https://www.tampermonkey.net/) for your browser.

### 2. Install the userscript

1. Open Tampermonkey Dashboard
2. Create a new script
3. Copy content from `slither-data-collector.user.js`
4. Save the script

### 3. Start Backend Server

```bash
cd backend
pip install -r requirements.txt
python3 run_server.py
```

### 4. Play and Collect

Navigate to [slither.io](https://slither.io) and start playing. Data collection begins automatically.

## Configuration

Both methods use the same backend server. Configuration options are available in:
- **Extension**: Popup interface
- **Userscript**: Edit script variables

## Data Output

Data is saved to `./backend/data/session_{timestamp}/` in Zarr format for ESN training.