#!/usr/bin/env python3
"""
Analyze Game Sessions - Quick Analysis Script

Usage:
    python analyze_games.py                    # Analyze all users
    python analyze_games.py --user AI_bot      # Analyze specific user
    python analyze_games.py --best 10          # Show top 10 games
    python analyze_games.py --export           # Export to CSV
"""

import zarr
import json
import numpy as np
from pathlib import Path
import pandas as pd
from datetime import datetime
import argparse


def load_game_metadata(game_path):
    """Load metadata from a game directory"""
    try:
        z = zarr.open(str(game_path), mode='r')
        attrs = dict(z.attrs)
        
        # Extract metadata
        metadata = {
            'game_id': game_path.name,
            'path': str(game_path),
            'username': attrs.get('username', 'unknown'),
            
            # Performance metrics
            'final_score': attrs.get('final_score', 0),
            'max_score': attrs.get('max_score', 0),
            'avg_score': attrs.get('avg_score', 0),
            'cumulative_score': attrs.get('cumulative_score', 0),
            'final_kill_count': attrs.get('final_kill_count', 0),
            'max_kill_count': attrs.get('max_kill_count', 0),
            
            # Session info
            'num_frames': attrs.get('valid_frames', 0),
            'total_frames': attrs.get('frame_count', 0),
            'errors': attrs.get('errors', 0),
            
            # Timing
            'start_time': attrs.get('start_time', 0),
            'end_time': attrs.get('end_time', 0),
            'duration_sec': max(0, attrs.get('end_time', 0) - attrs.get('start_time', 0)),  # Prevent negative
            
            # Stats
            'avg_velocity': attrs.get('final_stats', {}).get('avg_velocity', 0),
            'boost_time': attrs.get('final_stats', {}).get('boost_time', 0),
            'total_food': attrs.get('final_stats', {}).get('total_food_seen', 0),
        }
        
        return metadata
    except Exception as e:
        print(f"Error loading {game_path.name}: {e}")
        return None


def analyze_user_games(username, data_dir='backend/data'):
    """Analyze all games for a specific user"""
    user_dir = Path(data_dir) / username
    
    if not user_dir.exists():
        print(f"❌ User directory not found: {user_dir}")
        return None
    
    print(f"\n📊 Analyzing games for: {username}")
    print(f"Directory: {user_dir}")
    
    games = []
    game_dirs = sorted(user_dir.glob('game_*'), key=lambda p: p.name)
    
    for game_dir in game_dirs:
        metadata = load_game_metadata(game_dir)
        if metadata:
            games.append(metadata)
    
    if not games:
        print(f"⚠️  No games found for {username}")
        return None
    
    df = pd.DataFrame(games)
    
    # Filter out games with no end_time (still active)
    active_games = df[df['end_time'] == 0]
    completed_games = df[df['end_time'] > 0]
    
    if len(active_games) > 0:
        print(f"⚠️  Found {len(active_games)} active/incomplete games (will be excluded from analysis)")
    
    # Use only completed games for analysis
    if len(completed_games) == 0:
        print(f"⚠️  No completed games found for {username}")
        return None
    
    df = completed_games
    
    # Add derived metrics
    df['survival_rate'] = (df['num_frames'] / df['total_frames'].clip(lower=1) * 100).round(1)
    df['score_per_sec'] = (df['final_score'] / df['duration_sec'].clip(lower=1)).round(2)
    df['start_time_str'] = pd.to_datetime(df['start_time'], unit='s').dt.strftime('%Y-%m-%d %H:%M:%S')
    
    # Calculate composite score based on percentiles
    df = calculate_composite_score(df)
    
    return df


def calculate_composite_score(df):
    """
    Calcola un composite score basato su percentili per final, cumulative, max e average score.
    
    Per ogni gioco calcola:
    - percentile_final (0-1): posizione rispetto agli altri per final_score
    - percentile_cumulative (0-1): posizione per cumulative_score
    - percentile_max (0-1): posizione per max_score
    - percentile_avg (0-1): posizione per avg_score (incentiva media alta)
    - composite_score = percentile_final * percentile_cumulative * percentile_max * percentile_avg
    
    Il miglior gioco ha composite_score = 1 (tutti i percentili a 1)
    Il peggior gioco ha composite_score vicino a 0
    """
    if len(df) == 0:
        return df
    
    if len(df) == 1:
        df['percentile_final'] = 1.0
        df['percentile_cumulative'] = 1.0
        df['percentile_max'] = 1.0
        df['percentile_avg'] = 1.0
        df['composite_score'] = 1.0
        return df
    
    # Calcola percentili usando rank (0-1)
    df['percentile_final'] = df['final_score'].rank(pct=True)
    df['percentile_cumulative'] = df['cumulative_score'].rank(pct=True)
    df['percentile_max'] = df['max_score'].rank(pct=True)
    df['percentile_avg'] = df['avg_score'].rank(pct=True)
    
    # Composite score = prodotto dei quattro percentili
    df['composite_score'] = (
        df['percentile_final'] * 
        df['percentile_cumulative'] * 
        df['percentile_max'] *
        df['percentile_avg']
    )
    
    return df


def print_summary(df, username):
    """Print summary statistics"""
    print(f"\n{'='*60}")
    print(f"📈 SUMMARY - {username}")
    print(f"{'='*60}")
    
    print(f"\n📊 Game Count:")
    print(f"  Total games: {len(df)}")
    print(f"  Total frames: {df['num_frames'].sum():,}")
    print(f"  Total playtime: {df['duration_sec'].sum()/60:.1f} minutes")
    
    print(f"\n🎯 Score Statistics:")
    print(f"  Avg final score: {df['final_score'].mean():.1f}")
    print(f"  Median final score: {df['final_score'].median():.1f}")
    print(f"  Best game: {df['final_score'].max()}")
    print(f"  Worst game: {df['final_score'].min()}")
    print(f"  Max score ever: {df['max_score'].max()}")
    
    print(f"\n💀 Kill Statistics:")
    print(f"  Total kills: {df['final_kill_count'].sum()}")
    print(f"  Avg kills per game: {df['final_kill_count'].mean():.2f}")
    print(f"  Best killing spree: {df['max_kill_count'].max()}")
    print(f"  Games with kills: {(df['final_kill_count'] > 0).sum()}/{len(df)}")
    
    print(f"\n⏱️  Duration Statistics:")
    print(f"  Avg game duration: {df['duration_sec'].mean():.1f}s")
    print(f"  Longest game: {df['duration_sec'].max():.1f}s")
    print(f"  Shortest game: {df['duration_sec'].min():.1f}s")
    
    print(f"\n🚀 Performance:")
    print(f"  Avg velocity: {df['avg_velocity'].mean():.1f}")
    print(f"  Avg boost time: {df['boost_time'].mean():.1f}s per game")
    print(f"  Avg score/sec: {df['score_per_sec'].mean():.2f}")
    
    print(f"\n❌ Errors:")
    print(f"  Total errors: {df['errors'].sum()}")
    print(f"  Avg error rate: {(df['errors'].sum() / df['total_frames'].sum() * 100):.2f}%")


def print_top_games(df, n=10, sort_by='composite_score'):
    """Print top N games"""
    sort_label = {
        'composite_score': 'composite score',
        'cumulative_score': 'cumulative score',
        'final_score': 'final score',
        'max_score': 'max score'
    }.get(sort_by, sort_by)
    
    print(f"\n{'='*60}")
    print(f"🏆 TOP {n} GAMES (by {sort_label})")
    print(f"{'='*60}\n")
    
    top = df.nlargest(n, sort_by)
    
    for idx, (_, game) in enumerate(top.iterrows(), 1):
        cumul = game['cumulative_score']
        comp = game.get('composite_score', 0)
        avg = game.get('avg_score', 0)
        kills = game.get('final_kill_count', 0)
        
        # Base info
        info = f"{idx:2d}. 🐍 "
        
        # Se ordinato per composite, mostra composite score prominente
        if sort_by == 'composite_score':
            info += f"Composite: {comp:.4f} | "
            info += f"Final: {game['final_score']:3d}, Max: {game['max_score']:3d}, Avg: {avg:5.1f}, Cumul: {cumul:,.0f}"
            info += f" | 💀 {kills} kills"
        else:
            info += f"Final: {game['final_score']:3d} "
            info += f"(max: {game['max_score']:3d}, avg: {avg:.1f}, cumul: {cumul:,.0f}, comp: {comp:.4f})"
            info += f" | 💀 {kills} kills"
        
        info += f" | {game['num_frames']:4d} frames ({game['duration_sec']:.0f}s) | {game['start_time_str']}"
        print(info)


def print_distribution(df):
    """Print score distribution"""
    print(f"\n{'='*60}")
    print(f"📊 SCORE DISTRIBUTION")
    print(f"{'='*60}\n")
    
    bins = [0, 20, 50, 100, 150, 200, float('inf')]
    labels = ['0-20', '21-50', '51-100', '101-150', '151-200', '200+']
    
    df['score_bin'] = pd.cut(df['final_score'], bins=bins, labels=labels)
    distribution = df['score_bin'].value_counts().sort_index()
    
    for bin_label, count in distribution.items():
        pct = count / len(df) * 100
        bar = '█' * int(pct / 2)
        print(f"{bin_label:>10s}: {count:4d} games ({pct:5.1f}%) {bar}")


def main():
    parser = argparse.ArgumentParser(description='Analyze Slither.io game sessions')
    parser.add_argument('--user', '-u', default=None, help='Username to analyze (default: all users)')
    parser.add_argument('--best', '-b', type=int, default=10, help='Number of top games to show')
    parser.add_argument('--sort', '-s', default='composite_score',
                       choices=['composite_score', 'cumulative_score', 'final_score', 'max_score'],
                       help='Sort criterion for top games (default: composite_score)')
    parser.add_argument('--export', '-e', action='store_true', help='Export to CSV')
    parser.add_argument('--data-dir', '-d', default='backend/data', help='Data directory')
    
    args = parser.parse_args()
    
    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        print(f"Current directory: {Path.cwd()}")
        print(f"Make sure you're running this from the slitherio-scraper root directory")
        return
    
    # Get list of users
    if args.user:
        users = [args.user]
    else:
        users = [d.name for d in data_dir.iterdir() if d.is_dir() and not d.name.startswith('.')]
    
    print(f"\n{'='*60}")
    print(f"🎮 SLITHER.IO GAME SESSION ANALYZER")
    print(f"{'='*60}")
    print(f"Data directory: {data_dir.absolute()}")
    print(f"Users found: {', '.join(users)}")
    
    # Analyze each user
    all_games = []
    
    for username in users:
        df = analyze_user_games(username, args.data_dir)
        
        if df is not None:
            all_games.append(df)
            print_summary(df, username)
            print_top_games(df, args.best, args.sort)
            print_distribution(df)
            
            if args.export:
                output_file = f"games_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
                df.to_csv(output_file, index=False)
                print(f"\n💾 Exported to: {output_file}")
    
    # Combined analysis if multiple users
    if len(all_games) > 1:
        combined = pd.concat(all_games, ignore_index=True)
        print(f"\n{'='*60}")
        print(f"📊 COMBINED ANALYSIS (All Users)")
        print(f"{'='*60}")
        print_summary(combined, "ALL USERS")
        
        if args.export:
            output_file = f"games_all_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            combined.to_csv(output_file, index=False)
            print(f"\n💾 Combined data exported to: {output_file}")


if __name__ == '__main__':
    main()
