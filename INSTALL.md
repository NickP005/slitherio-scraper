# Slither.io ESN Data Collector - Guida all'Installazione

Questo sistema raccoglie dati di gioco da Slither.io per l'addestramento di Echo State Networks (ESN).

## Architettura

- **Userscript Tampermonkey**: Intercetta i dati del gioco nel browser
- **Backend Python**: Riceve e organizza i dati in formato Zarr ottimizzato per ESN

## Caratteristiche Implementate

✅ **Griglia Polare Multi-Risoluzione**: 64x24 con densità logaritmica frontale
✅ **Metadati Scalari**: heading, velocità, boost, distanza dai bordi
✅ **Input Giocatore**: posizione mouse e stato boost come target ESN
✅ **Sampling 10Hz**: con normalizzazione adattiva EMA
✅ **4 Canali**: cibo, corpi nemici, corpo mio, teste nemiche
✅ **Intercettazione WebSocket**: per lettura del protocollo Slither.io
✅ **Validazione Dati**: con logging dettagliato per troubleshooting
✅ **Formato Zarr**: chunked per streaming efficiente a ESN

## Installazione

### 1. Setup Backend Python

```bash
cd backend
python3 -m pip install -r requirements.txt
```

Oppure usa il launcher automatico:
```bash
python3 run_server.py
```

### 2. Setup Userscript Tampermonkey

1. **Installa Tampermonkey**:
   - Chrome: [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - Firefox: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/)

2. **Installa lo Script**:
   - Apri Tampermonkey Dashboard
   - Clicca su "Create a new script"
   - Copia tutto il contenuto di `slither-data-collector.user.js`
   - Incolla nel editor Tampermonkey
   - Salva (Ctrl+S)

## Utilizzo

### 1. Avvia il Backend
```bash
cd backend
python3 run_server.py
```

Il server sarà disponibile su `http://127.0.0.1:5055`

### 2. Gioca su Slither.io

1. Vai su [slither.io](https://slither.io)
2. Verifica che lo script sia attivo (icona Tampermonkey verde)
3. Inizia a giocare

### 3. Monitoraggio

**Nel Browser (Console F12)**:
```
[SLITHER-ESN][INFO] Session Statistics
```

**API Backend**:
- Sessioni attive: `GET http://127.0.0.1:5055/sessions`
- Statistiche sessione: `GET http://127.0.0.1:5055/sessions/{session_id}/stats`
- Health check: `GET http://127.0.0.1:5055/health`

## Configurazione

### Userscript (`slither-data-collector.user.js`)

```javascript
const CONFIG = {
    // Griglia
    ANGULAR_BINS: 64,        // Bin angolari
    RADIAL_BINS: 24,         // Bin radiali
    ALPHA_WARP: 6.0,         // Fattore densità frontale
    R_MIN: 60,               // Raggio minimo
    R_MAX: 3200,             // Raggio massimo

    // Sampling
    SAMPLE_RATE_HZ: 10,      // Frequenza campionamento

    // Backend
    BACKEND_URL: 'http://127.0.0.1:5055/ingest',

    // Debug
    DEBUG_LOG: true
};
```

### Backend (`data_collector_server.py`)

```python
CONFIG = {
    'HOST': '127.0.0.1',
    'PORT': 5055,
    'CHUNK_SIZE': 512,       # Frame per chunk Zarr
    'BUFFER_SIZE': 200,      # Frame da bufferizzare
    'MAX_VELOCITY': 1000.0,  # Velocità massima valida
}
```

## Formato Dati di Output

I dati vengono salvati in `./backend/data/session_{timestamp}/` in formato Zarr:

```
session_123456789/
├── grids/              # [T, 64, 24, 4] float16 - Griglia polare
├── timestamps/         # [T] float64 - Timestamp frame
├── headings/           # [T] float32 - Direzione serpente
├── velocities/         # [T] float32 - Velocità
├── distances_to_border/# [T] float32 - Distanza dai bordi
├── boost_states/       # [T] bool - Stato boost
└── player_inputs/      # [T, 3] float32 - Input mouse + boost
```

### Struttura Griglia (4 canali)

- **Canale 0**: Densità cibo (normalizzata 0-1)
- **Canale 1**: Corpi serpenti nemici (normalizzata 0-1)
- **Canale 2**: Corpo del tuo serpente (normalizzata 0-1)
- **Canale 3**: Teste serpenti nemici (maggiore peso per pericolo)

### Player Input (Target ESN)

- `mx, my`: Direzione mouse in coordinate locali allineate al serpente [-1, 1]
- `boost`: Stato boost binario [0, 1]

## Troubleshooting

### Script non raccoglie dati

1. **Verifica Console Browser (F12)**:
   ```
   [SLITHER-ESN][INFO] WebSocket connection detected
   [SLITHER-ESN][INFO] Game radius detected from handshake
   ```

2. **Verifica variabili gioco**:
   ```javascript
   console.log(window.snake);  // Il tuo serpente
   console.log(window.snakes); // Tutti i serpenti
   console.log(window.foods);  // Tutto il cibo
   ```

### Backend non riceve dati

1. **Verifica server in ascolto**:
   ```bash
   curl http://127.0.0.1:5055/health
   ```

2. **Verifica CORS/Permessi**:
   - Controlla `@connect 127.0.0.1` nel userscript
   - Verifica che Tampermonkey abbia permessi

### Dati invalidi

Il sistema include validazione automatica e scarta frame con:
- Velocità > 1000 unità/secondo
- Distanza bordi negativa
- Dimensioni griglia incorrette
- Game radius fuori range

## Dati per Addestramento ESN

**Loading dati**:
```python
import zarr
import numpy as np

# Carica sessione
store = zarr.DirectoryStore('./data/session_123456789')
group = zarr.group(store=store)

# Estrai dati
X = group['grids'][:]          # [T, 64, 24, 4] - Input spaziale
y = group['player_inputs'][:]  # [T, 3] - Target controllo
meta = {
    'headings': group['headings'][:],
    'velocities': group['velocities'][:],
    'boost_states': group['boost_states'][:]
}
```

**Preprocessing per ESN**:
```python
# Flatten griglia spaziale
X_flat = X.reshape(X.shape[0], -1)  # [T, 64*24*4]

# Concatena metadati scalari
X_full = np.concatenate([
    X_flat,
    meta['headings'].reshape(-1, 1),
    meta['velocities'].reshape(-1, 1)
], axis=1)

# Target: direzione movimento + boost
y_direction = y[:, :2]  # [T, 2] - mx, my
y_boost = y[:, 2]       # [T] - boost
```

## Limitazioni e Note

- **Uso Personale**: Solo per ricerca/addestramento personale
- **Termini di Servizio**: Rispettare i ToS di Slither.io
- **Performance**: Impatto minimo sul gameplay (<1% CPU)
- **Privacy**: Nessun dato personale raccolto, solo stato del gioco
- **Robustezza**: Fallback tra variabili globali e parsing WebSocket