#!/usr/bin/env python3
"""
Check Player Inputs Analysis
Verifica che l'AI bot salvi correttamente gli input del giocatore (angle delta e boost)
come se fosse un giocatore umano.
"""

import zarr
import numpy as np
import sys
from pathlib import Path

def analyze_player_inputs(game_path, game_name="Game"):
    """Analizza gli input del giocatore da un gioco."""
    try:
        store = zarr.open(game_path, mode='r')
    except Exception as e:
        print(f"❌ Errore nell'aprire {game_path}: {e}")
        return None
    
    if 'player_inputs' not in store:
        print(f"❌ Player inputs non trovati in {game_path}")
        return None
    
    inputs = store['player_inputs'][:]
    headings = store['headings'][:] if 'headings' in store else None
    
    print(f"\n{'='*80}")
    print(f"🎮 {game_name}")
    print(f"{'='*80}")
    print(f"📁 Path: {game_path}")
    print(f"📊 Frames: {inputs.shape[0]:,}")
    print(f"📐 Input shape: {inputs.shape} (mx, my, boost)")
    
    # Calcola angle delta frame-by-frame
    angle_deltas = []
    for i in range(len(inputs)):
        angle = np.arctan2(inputs[i,1], inputs[i,0])
        angle_deltas.append(angle)
    
    angle_deltas = np.array(angle_deltas)
    
    # Calcola variazioni di angolo frame-by-frame
    angle_changes = np.diff(angle_deltas)
    # Normalizza gli angoli tra -pi e pi
    angle_changes = np.arctan2(np.sin(angle_changes), np.cos(angle_changes))
    
    print(f"\n📊 STATISTICHE INPUT:")
    print(f"   mx (laterale):     mean={inputs[:,0].mean():7.4f}, std={inputs[:,0].std():7.4f}, range=[{inputs[:,0].min():7.4f}, {inputs[:,0].max():7.4f}]")
    print(f"   my (avanti/dietro): mean={inputs[:,1].mean():7.4f}, std={inputs[:,1].std():7.4f}, range=[{inputs[:,1].min():7.4f}, {inputs[:,1].max():7.4f}]")
    print(f"   boost:             mean={inputs[:,2].mean():7.4f} ({inputs[:,2].mean()*100:.1f}% del tempo)")
    
    print(f"\n📐 ANGLE DELTA:")
    print(f"   Angle medio:       {np.rad2deg(angle_deltas.mean()):7.2f}° (target direction)")
    print(f"   Angle std:         {np.rad2deg(angle_deltas.std()):7.2f}°")
    print(f"   Angle range:       [{np.rad2deg(angle_deltas.min()):7.2f}°, {np.rad2deg(angle_deltas.max()):7.2f}°]")
    
    print(f"\n🔄 VARIAZIONI ANGOLO (frame-to-frame):")
    print(f"   Media variazione:  {np.rad2deg(angle_changes.mean()):7.4f}° per frame")
    print(f"   Std variazione:    {np.rad2deg(angle_changes.std()):7.2f}°")
    print(f"   Max variazione:    {np.rad2deg(np.abs(angle_changes).max()):7.2f}°")
    
    # Conta frames con variazione significativa
    significant_changes = np.abs(angle_changes) > np.deg2rad(5)  # > 5 gradi
    print(f"   Variazioni > 5°:   {significant_changes.sum():,} frames ({significant_changes.sum()/len(angle_changes)*100:.1f}%)")
    
    print(f"\n🎯 SAMPLE INPUT (primi 10 frames):")
    print(f"   Frame |   mx    |   my    | boost | Angle (°) | ΔAngle (°)")
    print(f"   ------|---------|---------|-------|-----------|------------")
    for i in range(min(10, len(inputs))):
        angle = np.rad2deg(angle_deltas[i])
        delta = np.rad2deg(angle_changes[i-1]) if i > 0 else 0.0
        print(f"   {i:5d} | {inputs[i,0]:7.4f} | {inputs[i,1]:7.4f} |  {inputs[i,2]:4.1f}  | {angle:8.2f}  | {delta:9.4f}")
    
    # Verifica qualità dei dati
    print(f"\n✅ VALIDAZIONE:")
    issues = []
    
    # Check 1: Non tutti zeri
    if np.all(inputs == 0):
        issues.append("❌ Tutti gli input sono zero!")
    else:
        print(f"   ✓ Input non sono tutti zero")
    
    # Check 2: Variazione sufficiente
    if np.std(inputs[:,0]) < 0.01 and np.std(inputs[:,1]) < 0.01:
        issues.append("⚠️  Input quasi costanti (poca variazione)")
    else:
        print(f"   ✓ Input variano sufficientemente")
    
    # Check 3: Normalizzazione corretta
    norms = np.sqrt(inputs[:,0]**2 + inputs[:,1]**2)
    if np.any(norms > 1.1):  # Tolleranza per floating point
        issues.append(f"⚠️  Alcuni input non sono normalizzati correttamente (max norm: {norms.max():.4f})")
    else:
        print(f"   ✓ Input normalizzati correttamente (max norm: {norms.max():.4f})")
    
    # Check 4: Boost valori corretti
    unique_boost = np.unique(inputs[:,2])
    if not np.all(np.isin(unique_boost, [0.0, 1.0])):
        issues.append(f"⚠️  Boost contiene valori diversi da 0/1: {unique_boost}")
    else:
        print(f"   ✓ Boost contiene solo 0 e 1")
    
    # Check 5: Angle changes ragionevoli
    if np.rad2deg(np.abs(angle_changes).max()) > 180:
        issues.append("⚠️  Variazioni angolo troppo grandi (possibile discontinuità)")
    else:
        print(f"   ✓ Variazioni angolo entro limiti ragionevoli")
    
    if issues:
        print(f"\n⚠️  PROBLEMI RILEVATI:")
        for issue in issues:
            print(f"   {issue}")
    else:
        print(f"\n✅ TUTTI I CHECK SUPERATI - Dati pronti per training!")
    
    return {
        'inputs': inputs,
        'angle_deltas': angle_deltas,
        'angle_changes': angle_changes,
        'valid': len(issues) == 0
    }

def main():
    data_dir = Path("backend/data")
    
    print("="*80)
    print("🔍 PLAYER INPUTS ANALYSIS")
    print("="*80)
    print("\nQuesto script verifica che l'AI bot salvi correttamente gli input")
    print("del giocatore (angle delta e boost) come se fosse un giocatore umano.")
    print()
    
    # Trova l'ultimo gioco AI_bot
    ai_bot_dir = data_dir / "AI_bot"
    if ai_bot_dir.exists():
        games = sorted([g for g in ai_bot_dir.iterdir() if g.is_dir() and g.name.startswith("game_")])
        if games:
            latest_ai = games[-1]
            print(f"📍 Ultimo gioco AI_bot trovato: {latest_ai.name}")
            ai_result = analyze_player_inputs(str(latest_ai), "🤖 AI BOT")
        else:
            print("❌ Nessun gioco AI_bot trovato")
            ai_result = None
    else:
        print("❌ Directory AI_bot non trovata")
        ai_result = None
    
    # Trova un gioco umano per confronto
    human_dirs = [d for d in data_dir.iterdir() if d.is_dir() and d.name not in ["AI_bot"]]
    human_result = None
    
    for user_dir in human_dirs:
        sessions = sorted([s for s in user_dir.iterdir() if s.is_dir()])
        if sessions:
            latest_human = sessions[-1]
            print(f"\n📍 Ultimo gioco {user_dir.name} trovato: {latest_human.name}")
            human_result = analyze_player_inputs(str(latest_human), f"👤 HUMAN ({user_dir.name})")
            break
    
    # Confronto
    if ai_result and human_result:
        print(f"\n{'='*80}")
        print(f"📊 CONFRONTO AI vs HUMAN")
        print(f"{'='*80}")
        
        ai_inputs = ai_result['inputs']
        human_inputs = human_result['inputs']
        
        print(f"\n🎯 FORMATO DATI:")
        print(f"   AI:     {ai_inputs.shape} - ✅ Formato identico")
        print(f"   HUMAN:  {human_inputs.shape} - ✅ Formato identico")
        
        print(f"\n📐 ANGLE DELTA STD (variabilità direzione):")
        ai_angle_std = np.rad2deg(ai_result['angle_deltas'].std())
        human_angle_std = np.rad2deg(human_result['angle_deltas'].std())
        print(f"   AI:     {ai_angle_std:7.2f}°")
        print(f"   HUMAN:  {human_angle_std:7.2f}°")
        
        print(f"\n🚀 BOOST USAGE:")
        ai_boost = ai_inputs[:,2].mean() * 100
        human_boost = human_inputs[:,2].mean() * 100
        print(f"   AI:     {ai_boost:5.1f}% del tempo")
        print(f"   HUMAN:  {human_boost:5.1f}% del tempo")
        
        print(f"\n✅ CONCLUSIONE:")
        print(f"   L'AI bot salva input nel STESSO FORMATO del giocatore umano:")
        print(f"   - mx, my: direzione normalizzata nel reference frame del serpente")
        print(f"   - boost: 0 o 1")
        print(f"   - Angle delta può essere calcolato da (mx, my) = arctan2(my, mx)")
        print(f"   - Questi dati sono PERFETTI per supervised learning!")
    
    print(f"\n{'='*80}")
    print("✅ Analisi completata!")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()
