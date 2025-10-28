#!/usr/bin/env python3
"""
Quick test to check if username and metrics are working
"""

import zarr
from pathlib import Path
import json

def check_latest_game():
    """Check the most recent game directory"""
    data_dir = Path('backend/data')
    
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        print("Make sure you're running this from the slitherio-scraper root directory")
        return
    
    # Find all game directories
    all_games = []
    for user_dir in data_dir.iterdir():
        if user_dir.is_dir() and not user_dir.name.startswith('.'):
            for game_dir in user_dir.glob('game_*'):
                all_games.append(game_dir)
    
    if not all_games:
        print("❌ No game directories found!")
        return
    
    # Sort by timestamp (most recent first)
    latest_game = sorted(all_games, key=lambda p: p.name)[-1]
    
    print(f"\n{'='*60}")
    print(f"🎮 Latest Game: {latest_game}")
    print(f"{'='*60}\n")
    
    # Check metadata.json
    metadata_file = latest_game / 'metadata.json'
    if metadata_file.exists():
        with open(metadata_file) as f:
            metadata = json.load(f)
        
        print("📄 metadata.json:")
        print(f"  Username: {metadata.get('username', 'NOT FOUND')}")
        print(f"  Session ID: {metadata.get('session_id', 'NOT FOUND')}")
        print(f"  Start time: {metadata.get('start_time_iso', 'NOT FOUND')}")
    else:
        print("⚠️  metadata.json not found")
    
    # Check .zattrs
    try:
        z = zarr.open(str(latest_game), mode='r')
        attrs = dict(z.attrs)
        
        print("\n📊 .zattrs (Performance Metrics):")
        
        # Check username
        username = attrs.get('username', 'NOT FOUND')
        status = '✅' if username == 'AI_bot' else '⚠️'
        print(f"  {status} Username: {username}")
        
        # Check metrics
        metrics = [
            ('cumulative_score', '✅'),
            ('final_score', '✅'),
            ('max_score', '✅'),
            ('avg_score', '✅'),
            ('valid_frames', '✅')
        ]
        
        print("\n  Metrics:")
        all_present = True
        for metric, _ in metrics:
            value = attrs.get(metric, 'MISSING')
            if value == 'MISSING':
                print(f"    ❌ {metric}: MISSING")
                all_present = False
            else:
                print(f"    ✓ {metric}: {value}")
        
        if all_present and username == 'AI_bot':
            print("\n✅ ALL CHECKS PASSED!")
        elif all_present:
            print(f"\n⚠️  Metrics OK but username is '{username}' (expected 'AI_bot')")
        else:
            print("\n❌ Some metrics are missing")
            
    except Exception as e:
        print(f"\n❌ Error reading .zattrs: {e}")


if __name__ == '__main__':
    check_latest_game()
