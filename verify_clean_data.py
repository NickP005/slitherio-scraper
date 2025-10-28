#!/usr/bin/env python3
"""
Quick verification of cleaned data from armageddon.py
"""

import zarr
import json
from pathlib import Path

def main():
    clean_dir = Path("clean_data")
    
    print("="*80)
    print("🔍 CLEAN DATA VERIFICATION")
    print("="*80)
    
    # Read report
    report_path = clean_dir / "armageddon_report.json"
    with open(report_path) as f:
        report = json.load(f)
    
    print("\n📄 ARMAGEDDON REPORT:")
    print(f"   Created: {report['created_at']}")
    print(f"   Games processed: {report['stats']['processed'] + report['stats']['skipped']}")
    print(f"   Frames removed per game: {report['config']['remove_frames']}")
    print(f"   Min frames filter: {report['config']['min_frames']}")
    
    print("\n👥 GAMES BY USER:")
    for user, count in report['users'].items():
        print(f"   {user}: {count} games")
    
    # Verify random sample
    print("\n🎯 SAMPLE VERIFICATION (3 random games):")
    print("-" * 80)
    
    import random
    all_games = []
    for user in report['users'].keys():
        user_dir = clean_dir / user
        if user_dir.exists():
            all_games.extend([(user, g) for g in user_dir.iterdir() if g.is_dir()])
    
    sample = random.sample(all_games, min(3, len(all_games)))
    
    for user, game_path in sample:
        store = zarr.open(str(game_path), mode='r')
        
        print(f"\n📦 {user}/{game_path.name}")
        print(f"   Frames: {store['timestamps'].shape[0]:,}")
        print(f"   Cleaned: {store.attrs.get('cleaned', False)}")
        print(f"   Frames removed: {store.attrs.get('frames_removed', 0)}")
        print(f"   Original frames: {store.attrs.get('original_num_frames', 0)}")
        print(f"   Cumulative score: {store.attrs.get('cumulative_score', 0):,.0f}")
        print(f"   Final score: {store.attrs.get('final_score', 0)}")
        print(f"   Max score: {store.attrs.get('max_score', 0)}")
        
        # Verify
        current = store['timestamps'].shape[0]
        original = store.attrs.get('original_num_frames', 0)
        removed = store.attrs.get('frames_removed', 0)
        
        if current + removed == original:
            print(f"   ✅ Verification: {current} + {removed} = {original}")
        else:
            print(f"   ⚠️  Mismatch: {current} + {removed} ≠ {original}")
    
    # Calculate total size
    total_size = sum(f.stat().st_size for f in clean_dir.rglob('*') if f.is_file())
    
    print(f"\n{'='*80}")
    print(f"📊 SUMMARY")
    print(f"{'='*80}")
    print(f"Total games: {len(all_games)}")
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")
    print(f"Avg size per game: {total_size / len(all_games) / 1024:.1f} KB")
    print(f"\n✅ Clean data ready for training!")
    print(f"   Location: {clean_dir.absolute()}")

if __name__ == "__main__":
    main()
