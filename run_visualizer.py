#!/usr/bin/env python3
"""
Quick launcher for the Slither.io visualizer
Automatically creates and manages a virtual environment if needed.
"""

import sys
import subprocess
import os
from pathlib import Path

VENV_DIR = Path(__file__).parent / "visualizer_venv"
REQUIREMENTS_FILE = Path(__file__).parent / "visualizer_requirements.txt"

def is_in_venv():
    """Check if we're running inside a virtual environment"""
    return hasattr(sys, 'real_prefix') or (
        hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix
    )

def create_venv():
    """Create a virtual environment"""
    print("Creating virtual environment for visualizer...")
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
        import pygame
        import numpy
        import requests
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
            sys.executable, "-m", "pip", "install", "--upgrade", "pip"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        if REQUIREMENTS_FILE.exists():
            subprocess.check_call([
                sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)
            ])
        else:
            # Fallback: install essential packages
            subprocess.check_call([
                sys.executable, "-m", "pip", "install", "pygame", "numpy", "requests"
            ])
        print("✓ Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError:
        print("✗ Failed to install dependencies")
        return False

def main():
    """Main launcher"""
    print("Slither.io Data Visualizer Launcher")
    print("=" * 50)

    # Check if visualizer.py exists
    visualizer_path = Path(__file__).parent / "visualizer.py"
    if not visualizer_path.exists():
        print("✗ visualizer.py not found in the current directory.")
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

    # Start the visualizer
    print("\nStarting visualizer...")
    print("Make sure the backend server is running on http://127.0.0.1:5055")
    print("Press Ctrl+C to stop")
    print("-" * 50)

    try:
        # Import and run visualizer
        import runpy
        runpy.run_path(str(visualizer_path), run_name="__main__")
    except KeyboardInterrupt:
        print("\n\nVisualizer stopped by user")
        return 0
    except Exception as e:
        print(f"\n✗ Visualizer error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
