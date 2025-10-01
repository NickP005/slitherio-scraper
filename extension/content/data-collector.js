// Content Script for Slither.io Data Collector Extension

class SlitherDataCollector {
    constructor() {
        this.settings = null;
        this.serverConfig = null;
        this.isCollecting = false;
        this.gameState = {
            gameRadius: null,
            isActive: false,
            sessionId: null,
            frameCount: 0,
            validFrames: 0,
            errors: 0
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
                serverHost: 'http://127.0.0.1:5055',
                autoStart: true,
                debugMode: false
            });
            
            // Try to fetch server configuration
            await this.fetchServerConfig();
            
            console.log('[Slither Data Collector] Settings loaded:', this.settings);
        } catch (error) {
            console.error('[Slither Data Collector] Failed to load settings:', error);
            // Use defaults
            this.settings = {
                username: 'anonymous',
                serverHost: 'http://127.0.0.1:5055',
                autoStart: true,
                debugMode: false
            };
        }
    }
    
    async fetchServerConfig() {
        try {
            const configUrl = `${this.settings.serverHost}/config`;
            const response = await fetch(configUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            if (data.status === 'ok' && data.config) {
                this.serverConfig = data.config;
                console.log('[Slither Data Collector] Server config loaded:', this.serverConfig);
                return true;
            }
        } catch (error) {
            console.warn('[Slither Data Collector] Failed to fetch server config:', error.message);
            // Set default config
            this.serverConfig = {
                ANGULAR_BINS: 64,
                RADIAL_BINS: 24,
                ALPHA_WARP: 6.0,
                R_MIN: 60,
                R_MAX: 3200,
                SAMPLE_RATE_HZ: 10,
                EMA_ALPHA: 0.05,
                FOOD_NORM_FACTOR: 10.0,
                SNAKE_NORM_FACTOR: 5.0,
                HEAD_WEIGHT: 3.0,
                DEBUG_LOG: true,
                STATS_INTERVAL: 100
            };
        }
        return false;
    }
    
    injectCollectionScript() {
        // Inject the main data collection script into the page context
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/injected-script.js');
        script.onload = () => {
            // Send configuration to injected script (merge server config with settings)
            const config = {
                ...this.serverConfig,
                USERNAME: this.settings.username,
                BACKEND_URL: `${this.settings.serverHost}/ingest`,
                CONFIG_URL: `${this.settings.serverHost}/config`,
                DEBUG_LOG: this.settings.debugMode,
                CHANNELS: 4
            };
            
            window.postMessage({
                type: 'SLITHER_CONFIG',
                config: config
            }, '*');
            
            console.log('[Slither Data Collector] Configuration sent to injected script:', config);
        };
        
        (document.head || document.documentElement).appendChild(script);
    }
    
    setupMessageListeners() {
        // Listen for messages from injected script
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            
            switch (event.data.type) {
                case 'SLITHER_GAME_STATE':
                    this.updateGameState(event.data.gameState);
                    break;
                case 'SLITHER_COLLECTION_STATUS':
                    this.updateCollectionStatus(event.data.status);
                    break;
                case 'SLITHER_DATA_FRAME':
                    this.handleDataFrame(event.data.frame);
                    break;
                case 'SLITHER_ERROR':
                    this.handleError(event.data.error);
                    break;
            }
        });
        
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.type) {
                case 'GET_STATUS':
                    sendResponse({
                        isCollecting: this.isCollecting,
                        gameState: this.gameState,
                        settings: this.settings,
                        serverConfig: this.serverConfig
                    });
                    break;
                case 'START_COLLECTION':
                    this.startCollection();
                    sendResponse({ success: true });
                    break;
                case 'STOP_COLLECTION':
                    this.stopCollection();
                    sendResponse({ success: true });
                    break;
                case 'UPDATE_SETTINGS':
                    this.updateSettings(message.settings);
                    sendResponse({ success: true });
                    break;
                case 'TEST_CONNECTION':
                    this.testConnection().then(result => {
                        sendResponse(result);
                    });
                    return true; // Keep channel open for async response
            }
        });
    }
    
    async testConnection() {
        try {
            const response = await fetch(`${this.settings.serverHost}/health`);
            if (response.ok) {
                const data = await response.json();
                return { success: true, data: data };
            } else {
                return { success: false, error: `HTTP ${response.status}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    setupEventHandlers() {
        // Mouse movement tracking
        document.addEventListener('mousemove', (event) => {
            this.notifyMouseMove(event.clientX, event.clientY);
        });
        
        // Key events for boost tracking
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Space' || event.button === 0) {
                this.notifyBoostChange(true);
            }
        });
        
        document.addEventListener('keyup', (event) => {
            if (event.code === 'Space') {
                this.notifyBoostChange(false);
            }
        });
        
        document.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                this.notifyBoostChange(true);
            }
        });
        
        document.addEventListener('mouseup', (event) => {
            if (event.button === 0) {
                this.notifyBoostChange(false);
            }
        });
    }
    
    notifyMouseMove(x, y) {
        window.postMessage({
            type: 'SLITHER_MOUSE_MOVE',
            x: x,
            y: y
        }, '*');
    }
    
    notifyBoostChange(boosting) {
        window.postMessage({
            type: 'SLITHER_BOOST_CHANGE',
            boosting: boosting
        }, '*');
    }
    
    async updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        
        // Save to storage
        await chrome.storage.sync.set(this.settings);
        
        // Refetch server config if host changed
        if (newSettings.serverHost) {
            await this.fetchServerConfig();
        }
        
        // Update injected script configuration
        const config = {
            ...this.serverConfig,
            USERNAME: this.settings.username,
            BACKEND_URL: `${this.settings.serverHost}/ingest`,
            CONFIG_URL: `${this.settings.serverHost}/config`,
            DEBUG_LOG: this.settings.debugMode,
            CHANNELS: 4
        };
        
        window.postMessage({
            type: 'SLITHER_UPDATE_CONFIG',
            config: config
        }, '*');
    }
    
    updateGameState(gameState) {
        this.gameState = { ...this.gameState, ...gameState };
        
        // Auto-start collection if enabled
        if (this.settings.autoStart && gameState.isActive && !this.isCollecting) {
            this.startCollection();
        }
    }
    
    updateCollectionStatus(status) {
        this.isCollecting = status.isCollecting;
        if (status.frameCount !== undefined) {
            this.gameState.frameCount = status.frameCount;
        }
        if (status.errors !== undefined) {
            this.gameState.errors = status.errors;
        }
    }
    
    handleDataFrame(frame) {
        // Data frame received - send to backend
        this.gameState.validFrames++;
        this.sendDataToBackend(frame);
    }
    
    async sendDataToBackend(frame) {
        if (!this.settings || !this.settings.serverHost) {
            console.error('[Slither Data Collector] No server host configured');
            return;
        }
        
        try {
            const response = await fetch(`${this.settings.serverHost}/ingest`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'SlitherDataCollector/1.0'
                },
                body: JSON.stringify(frame)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            if (this.settings.debugMode) {
                console.log('[Slither Data Collector] Data sent to backend successfully');
            }
            
        } catch (error) {
            console.error('[Slither Data Collector] Backend error:', error);
            this.gameState.errors++;
        }
    }
    
    handleError(error) {
        console.error('[Slither Data Collector] Error from injected script:', error);
        this.gameState.errors++;
    }
    
    startCollection() {
        window.postMessage({
            type: 'SLITHER_START_COLLECTION'
        }, '*');
        this.isCollecting = true;
    }
    
    stopCollection() {
        window.postMessage({
            type: 'SLITHER_STOP_COLLECTION'
        }, '*');
        this.isCollecting = false;
    }
    
    startGamePolling() {
        // Poll for game state changes
        setInterval(() => {
            window.postMessage({
                type: 'SLITHER_REQUEST_STATUS'
            }, '*');
        }, 1000);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new SlitherDataCollector();
    });
} else {
    new SlitherDataCollector();
}