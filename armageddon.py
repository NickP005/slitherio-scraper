#!/usr/bin/env python3
"""
Armageddon Data Cleaner
Seleziona i 50% migliori giochi (per cumulative score) e rimuove gli ultimi 50 frame
(quelli che hanno portato alla morte) per creare un dataset "pulito" di giochi di successo.
"""

import zarr
import numpy as np
import shutil
import json
from pathlib import Path
from datetime import datetime
import argparse

def get_game_metadata(game_path):
    """Legge i metadati di un gioco."""
    try:
        store = zarr.open(str(game_path), mode='r')
        attrs = dict(store.attrs)
        
        # Determina numero di frame dagli array (fallback se num_frames non presente)
        if 'num_frames' not in attrs or attrs['num_frames'] == 0:
            # Prova a leggere da timestamps o altri array
            if 'timestamps' in store:
                attrs['num_frames'] = store['timestamps'].shape[0]
            elif 'grids' in store:
                attrs['num_frames'] = store['grids'].shape[0]
            elif 'player_inputs' in store:
                attrs['num_frames'] = store['player_inputs'].shape[0]
            else:
                attrs['num_frames'] = 0
        
        # Calcola cumulative score se non presente
        if 'cumulative_score' not in attrs:
            # Fallback: calcola da metadata se disponibile
            if 'metadata' in store and 'snakeLength' in store['metadata']:
                lengths = store['metadata']['snakeLength'][:]
                attrs['cumulative_score'] = float(np.sum(lengths))
            else:
                attrs['cumulative_score'] = 0.0
        
        # Assicurati che final_score e max_score esistano
        if 'final_score' not in attrs:
            attrs['final_score'] = 0
        if 'max_score' not in attrs:
            attrs['max_score'] = 0
        
        return attrs
    except Exception as e:
        print(f"❌ Errore lettura {game_path}: {e}")
        return None

def calculate_composite_score(games):
    """
    Calcola un composite score basato su percentili per final, cumulative e max score.
    
    Per ogni gioco calcola:
    - percentile_final (0-1): posizione rispetto agli altri per final_score
    - percentile_cumulative (0-1): posizione per cumulative_score
    - percentile_max (0-1): posizione per max_score
    - composite_score = percentile_final * percentile_cumulative * percentile_max
    
    Il miglior gioco ha composite_score = 1 (tutti i percentili a 1)
    Il peggior gioco ha composite_score vicino a 0
    """
    if not games:
        return games
    
    # Estrai gli score
    final_scores = np.array([g['metadata'].get('final_score', 0) for g in games])
    cumulative_scores = np.array([g['metadata'].get('cumulative_score', 0) for g in games])
    max_scores = np.array([g['metadata'].get('max_score', 0) for g in games])
    
    # Calcola percentili (rankdata da scipy.stats o implementazione manuale)
    def percentile_rank(scores):
        """Calcola percentile rank (0-1) per ogni score."""
        if len(scores) == 1:
            return np.array([1.0])
        
        # Ordina e trova rank
        sorted_indices = np.argsort(scores)
        ranks = np.empty_like(sorted_indices, dtype=float)
        ranks[sorted_indices] = np.arange(len(scores))
        
        # Normalizza a 0-1
        if len(scores) > 1:
            ranks = ranks / (len(scores) - 1)
        
        return ranks
    
    percentiles_final = percentile_rank(final_scores)
    percentiles_cumulative = percentile_rank(cumulative_scores)
    percentiles_max = percentile_rank(max_scores)
    
    # Calcola composite score (prodotto dei percentili)
    for i, game in enumerate(games):
        game['percentile_final'] = float(percentiles_final[i])
        game['percentile_cumulative'] = float(percentiles_cumulative[i])
        game['percentile_max'] = float(percentiles_max[i])
        game['composite_score'] = float(
            percentiles_final[i] * percentiles_cumulative[i] * percentiles_max[i]
        )
    
    return games

def collect_all_games(data_dir):
    """Raccoglie tutti i giochi da tutte le directory utente."""
    games = []
    
    for user_dir in data_dir.iterdir():
        if not user_dir.is_dir():
            continue
        
        username = user_dir.name
        
        # Cerca sia session_* che game_*
        for game_dir in user_dir.iterdir():
            if not game_dir.is_dir():
                continue
            
            if not (game_dir.name.startswith('session_') or game_dir.name.startswith('game_')):
                continue
            
            metadata = get_game_metadata(game_dir)
            if metadata:
                games.append({
                    'path': game_dir,
                    'username': username,
                    'game_id': game_dir.name,
                    'cumulative_score': metadata.get('cumulative_score', 0.0),
                    'num_frames': metadata.get('num_frames', 0),
                    'metadata': metadata
                })
    
    return games

def clean_game_data(source_path, dest_path, frames_to_remove=50):
    """
    Copia un gioco rimuovendo gli ultimi N frames.
    
    Args:
        source_path: Path al gioco sorgente
        dest_path: Path di destinazione
        frames_to_remove: Numero di frame da rimuovere dalla fine
    
    Returns:
        dict con statistiche della pulizia
    """
    try:
        # Apri store sorgente
        source_store = zarr.open(str(source_path), mode='r')
        
        # Crea store destinazione
        dest_store = zarr.open(str(dest_path), mode='w')
        
        # Copia attributi globali
        dest_store.attrs.update(dict(source_store.attrs))
        
        # Determina numero di frame effettivi dalla shape degli array
        num_frames = 0
        if 'timestamps' in source_store:
            num_frames = source_store['timestamps'].shape[0]
        elif 'grids' in source_store:
            num_frames = source_store['grids'].shape[0]
        elif 'player_inputs' in source_store:
            num_frames = source_store['player_inputs'].shape[0]
        
        if num_frames == 0:
            print(f"   ⚠️  Impossibile determinare numero di frames")
            return None
        
        # Se il gioco ha meno frame di quelli da rimuovere, salta
        if num_frames <= frames_to_remove:
            print(f"   ⚠️  Gioco troppo corto ({num_frames} frames), salto pulizia")
            return None
        
        # Nuovo numero di frame
        new_num_frames = num_frames - frames_to_remove
        
        stats = {
            'original_frames': num_frames,
            'removed_frames': frames_to_remove,
            'final_frames': new_num_frames,
            'arrays_processed': 0
        }
        
        # Copia tutti i dataset troncando gli ultimi N frame
        for key in source_store.keys():
            source_array = source_store[key]
            
            if isinstance(source_array, zarr.Array):
                # Leggi solo i primi (n - frames_to_remove) frame
                data = source_array[:new_num_frames]
                
                # Crea array destinazione senza specificare compressor (usa default)
                dest_array = dest_store.create_array(
                    key,
                    shape=data.shape,
                    chunks=source_array.chunks,
                    dtype=source_array.dtype
                )
                
                # Copia dati troncati
                dest_array[:] = data
                
                # Copia attributi array
                dest_array.attrs.update(dict(source_array.attrs))
                
                stats['arrays_processed'] += 1
            
            elif isinstance(source_array, zarr.Group):
                # Gestione gruppi (se presenti)
                dest_group = dest_store.create_group(key)
                dest_group.attrs.update(dict(source_array.attrs))
        
        # Aggiorna metadati globali
        dest_store.attrs['num_frames'] = new_num_frames
        dest_store.attrs['cleaned'] = True
        dest_store.attrs['cleaned_at'] = datetime.now().isoformat()
        dest_store.attrs['frames_removed'] = frames_to_remove
        dest_store.attrs['original_num_frames'] = num_frames
        
        # Ricalcola cumulative score (se possibile)
        if 'metadata' in dest_store:
            try:
                lengths = dest_store['metadata']['snakeLength'][:]
                new_cumulative = float(np.sum(lengths))
                dest_store.attrs['cumulative_score'] = new_cumulative
                dest_store.attrs['original_cumulative_score'] = source_store.attrs.get('cumulative_score', 0.0)
                stats['new_cumulative_score'] = new_cumulative
                stats['original_cumulative_score'] = source_store.attrs.get('cumulative_score', 0.0)
            except:
                pass
        
        # Aggiorna final_score e max_score
        if 'metadata' in dest_store and 'snakeLength' in dest_store['metadata']:
            try:
                lengths = dest_store['metadata']['snakeLength'][:]
                dest_store.attrs['final_score'] = int(lengths[-1]) if len(lengths) > 0 else 0
                dest_store.attrs['max_score'] = int(np.max(lengths)) if len(lengths) > 0 else 0
            except:
                pass
        
        return stats
        
    except Exception as e:
        print(f"   ❌ Errore durante pulizia: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description='Armageddon Data Cleaner - Pulisce i migliori giochi')
    parser.add_argument('--data-dir', default='backend/data', help='Directory contenente i dati')
    parser.add_argument('--output-dir', default='clean_data', help='Directory di output per dati puliti')
    parser.add_argument('--top-percent', type=float, default=20, help='Percentuale di migliori giochi da mantenere (default: 50)')
    parser.add_argument('--remove-frames', type=int, default=50, help='Numero di frame da rimuovere dalla fine (default: 50)')
    parser.add_argument('--min-frames', type=int, default=100, help='Numero minimo di frame per considerare un gioco (default: 100)')
    parser.add_argument('--user', help='Filtra per username specifico')
    parser.add_argument('--dry-run', action='store_true', help='Simula senza copiare files')
    
    args = parser.parse_args()
    
    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    
    print("=" * 80)
    print("🔥 ARMAGEDDON DATA CLEANER")
    print("=" * 80)
    print(f"📁 Data directory: {data_dir}")
    print(f"📂 Output directory: {output_dir}")
    print(f"📊 Top percent: {args.top_percent}%")
    print(f"✂️  Frames to remove: {args.remove_frames}")
    print(f"📏 Min frames: {args.min_frames}")
    if args.user:
        print(f"👤 Filter user: {args.user}")
    if args.dry_run:
        print("🧪 DRY RUN MODE - No files will be copied")
    print()
    
    # Raccogli tutti i giochi
    print("🔍 Scanning games...")
    all_games = collect_all_games(data_dir)
    
    if args.user:
        all_games = [g for g in all_games if g['username'] == args.user]
    
    # Filtra giochi con frame sufficienti
    valid_games = [g for g in all_games if g['num_frames'] >= args.min_frames]
    
    print(f"   Found {len(all_games)} total games")
    print(f"   Valid games (>= {args.min_frames} frames): {len(valid_games)}")
    
    if len(valid_games) == 0:
        print("❌ No valid games found!")
        return
    
    # Calcola composite score basato su percentili
    print("   Calculating composite scores (percentile-based)...")
    valid_games = calculate_composite_score(valid_games)
    
    # Ordina per composite score (prodotto dei percentili)
    sorted_games = sorted(valid_games, key=lambda g: g['composite_score'], reverse=True)
    
    # Seleziona top N%
    num_to_keep = max(1, int(len(sorted_games) * args.top_percent / 100))
    top_games = sorted_games[:num_to_keep]
    
    print(f"\n📊 SELECTION:")
    print(f"   Keeping top {num_to_keep} games ({args.top_percent}% of {len(sorted_games)})")
    print(f"   Composite score range: {top_games[-1]['composite_score']:.4f} - {top_games[0]['composite_score']:.4f}")
    print(f"   Best game breakdown:")
    best = top_games[0]
    print(f"      Final: {best['metadata'].get('final_score', 0)} (percentile: {best['percentile_final']:.3f})")
    print(f"      Cumulative: {best['metadata'].get('cumulative_score', 0):,.0f} (percentile: {best['percentile_cumulative']:.3f})")
    print(f"      Max: {best['metadata'].get('max_score', 0)} (percentile: {best['percentile_max']:.3f})")
    print(f"      Composite: {best['composite_score']:.4f}")
    
    # Raggruppa per username
    games_by_user = {}
    for game in top_games:
        username = game['username']
        if username not in games_by_user:
            games_by_user[username] = []
        games_by_user[username].append(game)
    
    print(f"\n👥 USERS:")
    for username, games in games_by_user.items():
        print(f"   {username}: {len(games)} games")
    
    # Processa giochi
    print(f"\n{'=' * 80}")
    print("🚀 PROCESSING GAMES")
    print(f"{'=' * 80}\n")
    
    total_processed = 0
    total_skipped = 0
    total_errors = 0
    total_frames_removed = 0
    
    for username, games in games_by_user.items():
        print(f"👤 {username} ({len(games)} games)")
        print("-" * 80)
        
        # Crea directory utente in output
        user_output_dir = output_dir / username
        
        if not args.dry_run:
            user_output_dir.mkdir(parents=True, exist_ok=True)
        
        for i, game in enumerate(games, 1):
            game_id = game['game_id']
            dest_path = user_output_dir / game_id
            
            # Salta se già esistente
            if dest_path.exists():
                print(f"   {i:3d}. ⏭️  {game_id} - Already exists, skipping")
                total_skipped += 1
                continue
            
            cumul = game['cumulative_score']
            frames = game['num_frames']
            comp_score = game.get('composite_score', 0)
            
            print(f"   {i:3d}. 🎮 {game_id}")
            print(f"        Composite: {comp_score:.4f} | Final: {game['metadata'].get('final_score', 0)} | Cumul: {cumul:,.0f} | Max: {game['metadata'].get('max_score', 0)}")
            print(f"        Frames: {frames:,} → {frames - args.remove_frames:,}")
            
            if args.dry_run:
                print(f"        [DRY RUN] Would copy to: {dest_path}")
                total_processed += 1
            else:
                # Pulisci e copia
                stats = clean_game_data(game['path'], dest_path, args.remove_frames)
                
                if stats:
                    print(f"        ✅ Cleaned: {stats['arrays_processed']} arrays, removed {stats['removed_frames']} frames")
                    if 'new_cumulative_score' in stats:
                        print(f"        📊 Cumulative: {stats['original_cumulative_score']:,.0f} → {stats['new_cumulative_score']:,.0f}")
                    total_processed += 1
                    total_frames_removed += stats['removed_frames']
                else:
                    print(f"        ❌ Failed to clean game")
                    total_errors += 1
        
        print()
    
    # Summary
    print(f"{'=' * 80}")
    print("📊 SUMMARY")
    print(f"{'=' * 80}")
    print(f"✅ Processed: {total_processed} games")
    print(f"⏭️  Skipped (already exist): {total_skipped} games")
    print(f"❌ Errors: {total_errors} games")
    print(f"✂️  Total frames removed: {total_frames_removed:,}")
    
    if not args.dry_run:
        print(f"\n📂 Clean data saved to: {output_dir}")
        print(f"   Total size: {sum(f.stat().st_size for f in output_dir.rglob('*') if f.is_file()) / 1024 / 1024:.1f} MB")
    
    print(f"\n{'=' * 80}")
    print("✅ Armageddon completed!")
    print(f"{'=' * 80}")
    
    # Crea un report JSON
    if not args.dry_run:
        report = {
            'created_at': datetime.now().isoformat(),
            'config': {
                'data_dir': str(data_dir),
                'output_dir': str(output_dir),
                'top_percent': args.top_percent,
                'remove_frames': args.remove_frames,
                'min_frames': args.min_frames,
                'filter_user': args.user
            },
            'stats': {
                'total_games_scanned': len(all_games),
                'valid_games': len(valid_games),
                'selected_games': len(top_games),
                'processed': total_processed,
                'skipped': total_skipped,
                'errors': total_errors,
                'total_frames_removed': total_frames_removed
            },
            'users': {username: len(games) for username, games in games_by_user.items()}
        }
        
        report_path = output_dir / 'armageddon_report.json'
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"\n📄 Report saved to: {report_path}")

if __name__ == "__main__":
    main()
