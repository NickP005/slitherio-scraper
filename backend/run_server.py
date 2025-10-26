#!/usr/bin/env python3
"""
Quick launcher script for the Slither.io data collector server
Automatically creates and manages a virtual environment if needed.
"""

import sys
import subprocess
import os
from pathlib import Path

VENV_DIR = Path(__file__).parent / "venv"

def is_in_venv():
    """Check if we're running inside a virtual environment"""
    return hasattr(sys, 'real_prefix') or (
        hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix
    )

def create_venv():
    """Create a virtual environment"""
    print("Creating virtual environment...")
    try:
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
        print("✓ Virtual environment created")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to create virtual environment: {e}")
        return False

def get_venv_python():
    """Get the path to the Python executable in the venv"""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"

def setup_venv():
    """Setup virtual environment if not already in one"""
    if is_in_venv():
        return True
    
    if not VENV_DIR.exists():
        print("Virtual environment not found.")
        if not create_venv():
            return False
    
    # Re-run this script using the venv Python
    venv_python = get_venv_python()
    print(f"Switching to virtual environment...")
    print("-" * 50)
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

def check_dependencies():
    """Check if required packages are installed"""
    try:
        import fastapi
        import uvicorn
        import numpy
        import zarr
        # Test zarr actually works (catches blosc issues on Windows)
        try:
            import zarr.storage
        except Exception as e:
            print(f"✗ Zarr installation issue (common on Windows): {e}")
            print("  This can be fixed by reinstalling dependencies.")
            return False
        print("✓ All dependencies are installed and working")
        return True
    except ImportError as e:
        print(f"✗ Missing dependency: {e}")
        return False

def install_dependencies():
    """Install required packages"""
    print("Installing dependencies...")
    try:
        # Upgrade pip first
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--upgrade", "pip"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # Install requirements
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", "requirements.txt"
        ])
        print("✓ Dependencies installed successfully")
        
        # On Windows, sometimes zarr needs reinstalling to fix blosc issues
        if sys.platform == "win32":
            print("  Verifying Windows compatibility...")
            try:
                import zarr.storage
            except Exception:
                print("  Fixing Windows-specific zarr/blosc compatibility...")
                subprocess.check_call([
                    sys.executable, "-m", "pip", "uninstall", "-y", "zarr", "numcodecs"
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                subprocess.check_call([
                    sys.executable, "-m", "pip", "install", "zarr>=2.18.0", "numcodecs>=0.12.0,<0.14.0"
                ])
                print("  ✓ Windows compatibility fixed")
        
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

    # Setup virtual environment (will restart script if needed)
    setup_venv()

    # At this point we're definitely in a venv
    print(f"Running in virtual environment: {sys.prefix}")

    # Check dependencies
    if not check_dependencies():
        print("\nAttempting to install dependencies...")
        if not install_dependencies():
            print("\nFailed to install dependencies. Please check the error messages above.")
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