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
        
        # Test zarr actually works (catches blosc issues on Windows)
        try:
            import zarr
            import numcodecs
            # Try to actually use zarr to catch runtime issues
            # Compatible with both zarr 2.x and 3.x
            try:
                # zarr 2.x API
                test_store = zarr.MemoryStore()
                _ = zarr.group(store=test_store)
            except AttributeError:
                # zarr 3.x API
                import zarr.storage
                test_store = zarr.storage.MemoryStore()
                _ = zarr.group(store=test_store)
        except Exception as e:
            error_msg = str(e)
            if "cbuffer_sizes" in error_msg or "blosc" in error_msg.lower():
                print(f"✗ Zarr/numcodecs compatibility issue (common on Windows)")
                print(f"  Error: {error_msg[:100]}...")
                print("  Fixing: Will reinstall with compatible versions...")
                return "fix_zarr"
            else:
                print(f"✗ Zarr installation issue: {e}")
                return False
        
        print("✓ All dependencies are installed and working")
        return True
    except ImportError as e:
        error_msg = str(e)
        if "cbuffer_sizes" in error_msg or "blosc" in error_msg.lower():
            print(f"✗ Zarr/numcodecs compatibility issue (common on Windows)")
            print(f"  Error: {error_msg[:100]}...")
            return "fix_zarr"
        print(f"✗ Missing dependency: {e}")
        return False
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
        
        return True
    except subprocess.CalledProcessError:
        print("✗ Failed to install dependencies")
        return False

def fix_zarr_windows():
    """Fix zarr/numcodecs compatibility issues"""
    print("\nFixing zarr/numcodecs compatibility...")
    try:
        # Check if we need --user flag (not in venv on Windows)
        user_flag = []
        if not is_in_venv() and sys.platform == "win32":
            user_flag = ["--user"]
            print("  Note: Installing with --user flag (not in virtual environment)")
        
        # Uninstall problematic packages
        print("  Removing old versions...")
        uninstall_cmd = [sys.executable, "-m", "pip", "uninstall", "-y", "zarr", "numcodecs"]
        try:
            subprocess.check_call(uninstall_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except:
            pass  # May not exist, that's fine
        
        # Install specific compatible versions
        print("  Installing compatible versions (numcodecs 0.12.1, zarr 2.18.3)...")
        install_cmd = [
            sys.executable, "-m", "pip", "install", "--no-cache-dir"
        ] + user_flag + ["numcodecs==0.12.1", "zarr==2.18.3"]
        
        subprocess.check_call(install_cmd)
        print("✓ Zarr/numcodecs fixed successfully")
        print("  Please restart the script for changes to take effect")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to fix zarr: {e}")
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
    deps_status = check_dependencies()
    
    if deps_status == "fix_zarr":
        # Need to fix zarr/numcodecs compatibility
        if not fix_zarr_windows():
            print("\nFailed to fix zarr compatibility. Please check the error messages above.")
            return 1
        
        # Exit and ask user to restart
        print("\n" + "=" * 50)
        print("✓ Fix applied! Please run the script again:")
        if sys.platform == "win32":
            print("  python run_server.py")
        else:
            print("  python3 run_server.py")
        print("=" * 50)
        return 0
        # Check again after fix
        deps_status = check_dependencies()
    
    if deps_status == False:
        print("\nAttempting to install dependencies...")
        if not install_dependencies():
            print("\nFailed to install dependencies. Please check the error messages above.")
            return 1
        # Check one more time
        if not check_dependencies():
            print("\nDependencies installed but still not working. Please report this issue.")
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