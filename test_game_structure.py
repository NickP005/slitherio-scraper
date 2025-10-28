#!/usr/bin/env python3
"""
Quick test to verify .zattrs structure
"""

import zarr
from pathlib import Path
import json

def test_game_directory(game_path):
    """Test a single game directory"""
    print(f"\n{'='*60}")
    print(f"Testing: {game_path}")
    print(f"{'='*60}\n")
    
    try:
        # Load Zarr
        z = zarr.open(str(game_path), mode='r')
        
        # Print all attributes
        print("📊 Zarr Attributes (.zattrs):")
        print(json.dumps(dict(z.attrs), indent=2, default=str))
        
        # Check required fields
        required = ['cumulative_score', 'final_score', 'max_score', 'avg_score']
        print("\n✅ Required Fields:")
        for field in required:
            value = z.attrs.get(field, 'MISSING')
            status = '✓' if field in z.attrs else '✗'
            print(f"  {status} {field}: {value}")
        
        # Array info
        print("\n📦 Arrays:")
        for name in z.array_keys():
            arr = z[name]
            print(f"  - {name}: shape={arr.shape}, dtype={arr.dtype}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    """Test all game directories in backend/data/"""
    data_dir = Path('backend/data')
    
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        print(f"Current directory: {Path.cwd()}")
        return
    
    print("\n🎮 GAME DIRECTORY TESTER\n")
    
    # Find all game directories
    game_dirs = list(data_dir.glob('*/game_*'))
    
    if not game_dirs:
        print("⚠️  No game_* directories found!")
        print("Expected structure: data/username/game_TIMESTAMP/")
        return
    
    print(f"Found {len(game_dirs)} game directories\n")
    
    # Test each
    success_count = 0
    for game_dir in sorted(game_dirs)[:5]:  # Test first 5
        if test_game_directory(game_dir):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"Results: {success_count}/{min(5, len(game_dirs))} games validated")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
