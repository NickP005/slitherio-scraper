#!/bin/bash

# Slither.io Data Collector - Complete Setup Script
# This script sets up and runs the complete data collection and visualization system

echo "=============================================="
echo "Slither.io ESN Data Collector Setup"
echo "=============================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "slither-data-collector.user.js" ]; then
    echo -e "${RED}Error: Please run this script from the slitherio-scraper directory${NC}"
    exit 1
fi

echo -e "${BLUE}1. Setting up Python environment...${NC}"
cd backend

# Check if Python dependencies are installed
if ! python3 -c "import fastapi, uvicorn, zarr, numpy" 2>/dev/null; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    pip3 install -r requirements.txt
else
    echo -e "${GREEN}✓ Backend dependencies already installed${NC}"
fi

cd ..

# Check visualizer dependencies
if ! python3 -c "import pygame, requests" 2>/dev/null; then
    echo -e "${YELLOW}Installing visualizer dependencies...${NC}"
    pip3 install -r visualizer_requirements.txt
else
    echo -e "${GREEN}✓ Visualizer dependencies already installed${NC}"
fi

echo ""
echo -e "${BLUE}2. System Components:${NC}"
echo "   • Userscript: slither-data-collector.user.js (install in Tampermonkey)"
echo "   • Backend Server: backend/data_collector_server.py"
echo "   • Real-time Visualizer: visualizer.py"
echo ""

echo -e "${BLUE}3. Usage Instructions:${NC}"
echo -e "${GREEN}Step 1: Install the userscript${NC}"
echo "   1. Install Tampermonkey extension in your browser"
echo "   2. Open slither-data-collector.user.js and copy the content"
echo "   3. Create a new userscript in Tampermonkey and paste the code"
echo "   4. Save and enable the script"
echo ""

echo -e "${GREEN}Step 2: Start the backend server${NC}"
echo "   Run: cd backend && python3 run_server.py"
echo "   Server will start on http://127.0.0.1:5055"
echo ""

echo -e "${GREEN}Step 3: Start the visualizer (optional)${NC}"
echo "   Run: python3 visualizer.py"
echo "   Controls: 1-4 to switch channels, ESC to quit"
echo ""

echo -e "${GREEN}Step 4: Play Slither.io${NC}"
echo "   1. Go to https://slither.io"
echo "   2. Start playing - data collection will begin automatically"
echo "   3. Check the visualizer to see real-time polar grid data"
echo ""

echo -e "${BLUE}4. Data Storage:${NC}"
echo "   • Data is saved in backend/data/ directory"
echo "   • Each session gets its own folder with Zarr format files"
echo "   • Grid data, metadata, and player inputs are all saved"
echo ""

echo -e "${BLUE}5. Quick Start (choose one option):${NC}"
echo -e "${YELLOW}Option A - Start backend server only:${NC}"
echo "   ./start_server.sh"
echo ""
echo -e "${YELLOW}Option B - Start backend + visualizer:${NC}"
echo "   ./start_with_visualizer.sh"
echo ""

# Create helper scripts
echo -e "${BLUE}Creating helper scripts...${NC}"

# Backend only script
cat > start_server.sh << 'EOF'
#!/bin/bash
echo "Starting Slither.io Data Collector Server..."
cd backend && python3 run_server.py
EOF

# Backend + visualizer script
cat > start_with_visualizer.sh << 'EOF'
#!/bin/bash
echo "Starting Slither.io Data Collector with Visualizer..."

# Start server in background
cd backend && python3 run_server.py &
SERVER_PID=$!

# Wait a moment for server to start
sleep 2

# Start visualizer
cd ..
python3 visualizer.py

# When visualizer closes, stop the server
echo "Stopping server..."
kill $SERVER_PID
EOF

chmod +x start_server.sh
chmod +x start_with_visualizer.sh

echo -e "${GREEN}✓ Helper scripts created:${NC}"
echo "   • start_server.sh - Backend only"
echo "   • start_with_visualizer.sh - Backend + Visualizer"
echo ""

echo -e "${GREEN}Setup complete! 🎮${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Install the userscript in Tampermonkey"
echo "2. Run one of the helper scripts"
echo "3. Go play Slither.io!"
echo ""
echo -e "${BLUE}For support, check the console logs and server output.${NC}"