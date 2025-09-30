#!/usr/bin/env python3
"""
Quick launcher script for the Slither.io data collector server
"""

import sys
import subprocess
from pathlib import Path

def check_dependencies():
    """Check if required packages are installed"""
    try:
        import fastapi
        import uvicorn
        import numpy
        import zarr
        print("✓ All dependencies are installed")
        return True
    except ImportError as e:
        print(f"✗ Missing dependency: {e}")
        return False

def install_dependencies():
    """Install required packages"""
    print("Installing dependencies...")
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", "requirements.txt"
        ])
        print("✓ Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError:
        print("✗ Failed to install dependencies")
        return False

def main():
    """Main launcher"""
    print("Slither.io ESN Data Collector Server Launcher")
    print("=" * 50)

    # Check if we're in the right directory
    if not Path("requirements.txt").exists():
        print("✗ requirements.txt not found. Make sure you're in the backend directory.")
        return 1

    # Check dependencies
    if not check_dependencies():
        print("\nAttempting to install dependencies...")
        if not install_dependencies():
            print("\nFailed to install dependencies. Please run:")
            print("pip install -r requirements.txt")
            return 1

    # Start the server
    print("\nStarting data collector server...")
    print("Server will be available at: http://127.0.0.1:5055")
    print("Press Ctrl+C to stop the server")
    print("-" * 50)

    try:
        from data_collector_server import main as server_main
        server_main()
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
        return 0
    except Exception as e:
        print(f"\n✗ Server error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())