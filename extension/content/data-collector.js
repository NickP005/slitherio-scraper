// Content Script for Slither.io Data Collector Extension

class SlitherDataCollector {
    constructor() {
        this.settings = null;
        this.isCollecting = false;
        this.gameState = {
            gameRadius: null,
            isActive: false,
            sessionId: null,
            frameCount: 0,
            validFrames: 0,
            errors: 0
        };
        this.samplingState = {
            lastSampleTime: 0,
            previousPosition: null,
            emaChannels: null,
            isBoosting: false,
            mousePos: { x: 0, y: 0 }
        };
        
        this.init();
    }
    
    async init() {
        console.log('[Slither Data Collector] Initializing...');
        
        // Load settings
        await this.loadSettings();
        
        // Inject the main collection script
        this.injectCollectionScript();
        
        // Setup message listeners
        this.setupMessageListeners();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Start polling for game state
        this.startGamePolling();
        
        console.log('[Slither Data Collector] Initialized successfully');
    }
    
    async loadSettings() {
        try {
            this.settings = await chrome.storage.sync.get({
                username: 'anonymous',
                host: 'http://127.0.0.1:5055',
                sampleRate: '10',
                alphaWarp: '6.0',
                autoStart: true,
                debugMode: false
            });
            
            console.log('[Slither Data Collector] Settings loaded:', this.settings);
        } catch (error) {
            console.error('[Slither Data Collector] Error loading settings:', error);
            // Use defaults
            this.settings = {
                username: 'anonymous',
                host: 'http://127.0.0.1:5055',
                sampleRate: '10',
                alphaWarp: '6.0',
                autoStart: true,
                debugMode: false
            };
        }
    }
    
    injectCollectionScript() {
        // Inject the main data collection script into the page context
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/injected-script.js');
        script.onload = () => {
            // Send configuration to injected script
            window.postMessage({
                type: 'SLITHER_CONFIG',
                config: {
                    ANGULAR_BINS: 64,
                    RADIAL_BINS: 24,
                    ALPHA_WARP: parseFloat(this.settings.alphaWarp),
                    R_MIN: 60,
                    R_MAX: 3200,
                    SAMPLE_RATE_HZ: parseInt(this.settings.sampleRate),
                    EMA_BETA: 0.99,
                    SATURATION_FACTOR: 3.0,
                    CHANNELS: 4,
                    USERNAME: this.settings.username,
                    BACKEND_URL: `${this.settings.host}/ingest`,
                    DEBUG_LOG: this.settings.debugMode
                }
            }, '*');
        };
        (document.head || document.documentElement).appendChild(script);
    }
    
    setupMessageListeners() {
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'updateSettings':
                    this.updateSettings(request.settings);
                    sendResponse({success: true});
                    break;
                    
                case 'getStatus':
                    sendResponse({
                        collecting: this.isCollecting,
                        connected: true,
                        stats: {
                            sessionId: this.gameState.sessionId,
                            frameCount: this.gameState.frameCount,
                            validRate: this.gameState.frameCount > 0 ? 
                                Math.round((this.gameState.validFrames / this.gameState.frameCount) * 100) : 0,
                            errors: this.gameState.errors
                        }
                    });
                    break;
                    
                case 'startCollection':
                    this.startCollection();
                    sendResponse({success: true});
                    break;
                    
                case 'stopCollection':
                    this.stopCollection();
                    sendResponse({success: true});
                    break;
            }
        });
        
        // Listen for messages from injected script
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            
            switch (event.data.type) {
                case 'SLITHER_GAME_STATE':
                    this.updateGameState(event.data.gameState);
                    break;
                    
                case 'SLITHER_DATA_FRAME':
                    this.handleDataFrame(event.data.frame);
                    break;
                    
                case 'SLITHER_ERROR':
                    this.handleError(event.data.error);
                    break;
                    
                case 'SLITHER_STATUS':
                    this.updateCollectionStatus(event.data.status);
                    break;
            }
        });
    }
    
    setupEventHandlers() {
        // Mouse events for boost detection
        document.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                this.samplingState.isBoosting = true;
                this.notifyBoostChange(true);
            }
        });
        
        document.addEventListener('mouseup', (event) => {
            if (event.button === 0) {
                this.samplingState.isBoosting = false;
                this.notifyBoostChange(false);
            }
        });
        
        // Keyboard events for boost
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Space') {
                event.preventDefault();
                this.samplingState.isBoosting = true;
                this.notifyBoostChange(true);
            }
        });
        
        document.addEventListener('keyup', (event) => {
            if (event.code === 'Space') {
                event.preventDefault();
                this.samplingState.isBoosting = false;
                this.notifyBoostChange(false);
            }
        });
        
        // Mouse movement tracking
        document.addEventListener('mousemove', (event) => {
            this.samplingState.mousePos.x = event.clientX;
            this.samplingState.mousePos.y = event.clientY;
        });
    }
    
    notifyBoostChange(boosting) {
        window.postMessage({
            type: 'SLITHER_BOOST_CHANGE',
            boosting: boosting
        }, '*');
    }
    
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        
        // Send updated config to injected script
        window.postMessage({
            type: 'SLITHER_CONFIG_UPDATE',
            config: {
                ALPHA_WARP: parseFloat(this.settings.alphaWarp),
                SAMPLE_RATE_HZ: parseInt(this.settings.sampleRate),
                USERNAME: this.settings.username,
                BACKEND_URL: `${this.settings.host}/ingest`,
                DEBUG_LOG: this.settings.debugMode
            }
        }, '*');
        
        console.log('[Slither Data Collector] Settings updated:', this.settings);
    }
    
    updateGameState(gameState) {
        this.gameState = { ...this.gameState, ...gameState };
        
        // Auto-start collection if enabled and game is active
        if (this.settings.autoStart && gameState.isActive && !this.isCollecting) {
            this.startCollection();
        }
    }
    
    updateCollectionStatus(status) {
        this.isCollecting = status.collecting;
        
        if (this.settings.debugMode) {
            console.log('[Slither Data Collector] Status update:', status);
        }
    }
    
    handleDataFrame(frame) {
        this.gameState.frameCount++;
        if (frame.validation && frame.validation.hasSnake) {
            this.gameState.validFrames++;
        }
        
        // Send to backend via injected script (which handles CORS)
        window.postMessage({
            type: 'SLITHER_SEND_DATA',
            frame: frame
        }, '*');
    }
    
    handleError(error) {
        this.gameState.errors++;
        console.error('[Slither Data Collector] Error:', error);
    }
    
    startCollection() {
        window.postMessage({
            type: 'SLITHER_START_COLLECTION'
        }, '*');
        console.log('[Slither Data Collector] Collection started');
    }
    
    stopCollection() {
        window.postMessage({
            type: 'SLITHER_STOP_COLLECTION'
        }, '*');
        console.log('[Slither Data Collector] Collection stopped');
    }
    
    startGamePolling() {
        // Poll for game state every second
        setInterval(() => {
            window.postMessage({
                type: 'SLITHER_REQUEST_STATUS'
            }, '*');
        }, 1000);
    }
}

// Initialize when content script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new SlitherDataCollector();
    });
} else {
    new SlitherDataCollector();
}