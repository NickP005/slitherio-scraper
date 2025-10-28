// Popup JavaScript for Slither.io Data Collector Extension

class PopupController {
    constructor() {
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.bindEvents();
        this.startStatusUpdates();
        
        // Query AI status immediately after init
        setTimeout(() => this.queryAIStatus(), 100);
    }
    
    async loadSettings() {
        try {
            const settings = await chrome.storage.sync.get({
                username: '',
                serverHost: 'http://127.0.0.1:5055',
                autoStart: true,
                debugMode: true,  // Enable debug by default for testing
                aiEnabled: false,
                aiServerUrl: 'ws://127.0.0.1:8765',
                aiAutoStart: false
            });
            
            // Load basic settings
            document.getElementById('username').value = settings.username;
            document.getElementById('serverHost').value = settings.serverHost;
            
            if (document.getElementById('autoStart')) {
                document.getElementById('autoStart').checked = settings.autoStart;
            }
            if (document.getElementById('debugMode')) {
                document.getElementById('debugMode').checked = settings.debugMode;
            }
            
            // Load AI settings
            if (document.getElementById('aiEnabled')) {
                document.getElementById('aiEnabled').checked = settings.aiEnabled;
                this.updateAIControls(settings.aiEnabled);
            }
            if (document.getElementById('aiServerUrl')) {
                document.getElementById('aiServerUrl').value = settings.aiServerUrl;
            }
            if (document.getElementById('aiAutoStart')) {
                document.getElementById('aiAutoStart').checked = settings.aiAutoStart;
            }
            
            console.log('[Popup] Settings loaded:', settings);
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
    
    async queryAIStatus() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                // The content script will send back AI status if available
                chrome.tabs.sendMessage(tab.id, {
                    type: 'GET_AI_STATUS'
                }).catch(() => {}); // Ignore if not ready
            }
        } catch (error) {
            // Ignore errors - page might not be ready
        }
    }
    
    bindEvents() {
        // Save settings button
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Test connection button
        document.getElementById('testConnection').addEventListener('click', () => {
            this.testConnection();
        });
        
        // Auto-test connection when serverHost changes
        document.getElementById('serverHost').addEventListener('blur', () => {
            const host = document.getElementById('serverHost').value.trim();
            if (host) {
                setTimeout(() => this.testConnection(), 300);
            }
        });
        
        // AI Control checkbox - save immediately when changed
        document.getElementById('aiEnabled').addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;
            this.updateAIControls(isEnabled);
            
            // Save aiEnabled immediately
            try {
                await chrome.storage.sync.set({ aiEnabled: isEnabled });
                console.log('[Popup] AI Enabled saved:', isEnabled);
            } catch (error) {
                console.error('[Popup] Error saving aiEnabled:', error);
            }
        });
        
        // AI Control buttons
        document.getElementById('aiConnect').addEventListener('click', () => {
            this.connectAI();
        });
        
        document.getElementById('aiDisconnect').addEventListener('click', () => {
            this.disconnectAI();
        });
        
        document.getElementById('aiStartControl').addEventListener('click', () => {
            this.startAIControl();
        });
        
        document.getElementById('aiStopControl').addEventListener('click', () => {
            this.stopAIControl();
        });
        
        // Listen for AI status updates
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'AI_STATUS_UPDATE') {
                this.updateAIStatus(message.status, message.details);
            } else if (message.type === 'AI_ERROR') {
                this.showStatus('error', 'AI Error: ' + message.error);
            }
        });
    }
    
    async saveSettings() {
        const settings = {
            username: document.getElementById('username').value.trim(),
            serverHost: document.getElementById('serverHost').value.trim(),
            autoStart: document.getElementById('autoStart') ? document.getElementById('autoStart').checked : true,
            debugMode: document.getElementById('debugMode') ? document.getElementById('debugMode').checked : false,
            aiEnabled: document.getElementById('aiEnabled') ? document.getElementById('aiEnabled').checked : false,
            aiServerUrl: document.getElementById('aiServerUrl') ? document.getElementById('aiServerUrl').value.trim() : 'ws://127.0.0.1:8765',
            aiAutoStart: document.getElementById('aiAutoStart') ? document.getElementById('aiAutoStart').checked : false
        };
        
        // Validate settings
        if (!settings.username) {
            this.showStatus('error', 'Please enter a username');
            return;
        }
        
        if (!settings.serverHost) {
            this.showStatus('error', 'Please enter a server host');
            return;
        }
        
        try {
            // Save to storage
            await chrome.storage.sync.set(settings);
            
            // Send to content script
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        type: 'UPDATE_SETTINGS',
                        settings: settings
                    });
                    
                    // If AI is enabled and we have a URL, show connect button
                    if (settings.aiEnabled && settings.aiServerUrl) {
                        this.updateAIControls(true);
                    }
                } catch (error) {
                    console.log('Content script not ready yet, settings saved to storage');
                }
            }
            
            this.showStatus('success', '✅ Settings saved successfully');
            
            // Test connection after saving
            setTimeout(() => this.testConnection(), 500);
            
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('error', 'Failed to save settings');
        }
    }
    
    async testConnection() {
        const serverHost = document.getElementById('serverHost').value.trim();
        const username = document.getElementById('username').value.trim();
        
        if (!serverHost) {
            this.showStatus('error', 'Please enter a server host first');
            return;
        }
        
        if (!username) {
            this.showStatus('error', 'Please enter a username first');
            return;
        }
        
        this.showStatus('testing', '🔄 Testing connection...');
        
        try {
            const response = await fetch(`${serverHost}/health`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showStatus('success', `✅ Connected! Active sessions: ${data.active_sessions}`);
                
                // Show server configuration if available
                if (data.config) {
                    this.displayServerConfig(data.config);
                }
                
                // Update connection status
                document.getElementById('connectionStatus').textContent = 'Connected';
                document.getElementById('connectionStatus').style.color = '#4CAF50';
                
            } else {
                this.showStatus('error', `❌ Server error: ${response.status}`);
                this.hideServerConfig();
            }
        } catch (error) {
            console.error('Connection test failed:', error);
            this.showStatus('error', '❌ Connection failed. Check host and server status.');
            this.hideServerConfig();
        }
    }
    
    displayServerConfig(config) {
        const section = document.getElementById('serverConfigSection');
        if (section) {
            section.style.display = 'block';
            
            const setBinValue = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.textContent = value || '-';
            };
            
            setBinValue('configAngularBins', config.ANGULAR_BINS);
            setBinValue('configRadialBins', config.RADIAL_BINS);
            setBinValue('configSampleRate', config.SAMPLE_RATE_HZ ? `${config.SAMPLE_RATE_HZ} Hz` : '-');
            setBinValue('configAlphaWarp', config.ALPHA_WARP);
        }
    }
    
    hideServerConfig() {
        const section = document.getElementById('serverConfigSection');
        if (section) {
            section.style.display = 'none';
        }
        
        // Update connection status
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            statusEl.textContent = 'Disconnected';
            statusEl.style.color = '#f44336';
        }
    }
    
    showStatus(type, message) {
        // Try to find a status element, create one if it doesn't exist
        let statusEl = document.getElementById('status');
        if (!statusEl) {
            // Create a temporary status display
            statusEl = document.createElement('div');
            statusEl.id = 'status';
            statusEl.style.cssText = `
                margin: 10px 0;
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 12px;
                text-align: center;
            `;
            
            // Insert after the actions div
            const actionsDiv = document.querySelector('.actions');
            if (actionsDiv && actionsDiv.parentNode) {
                actionsDiv.parentNode.insertBefore(statusEl, actionsDiv.nextSibling);
            }
        }
        
        // Set styles based on type
        switch (type) {
            case 'success':
                statusEl.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
                statusEl.style.color = '#4CAF50';
                statusEl.style.border = '1px solid #4CAF50';
                break;
            case 'error':
                statusEl.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
                statusEl.style.color = '#f44336';
                statusEl.style.border = '1px solid #f44336';
                break;
            case 'testing':
                statusEl.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
                statusEl.style.color = '#FFC107';
                statusEl.style.border = '1px solid #FFC107';
                break;
            default:
                statusEl.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                statusEl.style.color = 'white';
                statusEl.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        }
        
        statusEl.textContent = message;
        
        // Clear status after 5 seconds for non-error messages
        if (type !== 'error') {
            setTimeout(() => {
                if (statusEl && statusEl.parentNode) {
                    statusEl.style.opacity = '0';
                    setTimeout(() => {
                        if (statusEl && statusEl.parentNode) {
                            statusEl.parentNode.removeChild(statusEl);
                        }
                    }, 300);
                }
            }, 5000);
        }
    }
    
    async updateStatus() {
        try {
            // Check backend connection status
            const serverHost = document.getElementById('serverHost').value.trim() || 'http://127.0.0.1:5055';
            try {
                const healthResponse = await fetch(`${serverHost}/health`, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache',
                    signal: AbortSignal.timeout(2000) // 2 second timeout
                });
                
                if (healthResponse.ok) {
                    document.getElementById('connectionStatus').textContent = 'Connected';
                    document.getElementById('connectionStatus').style.color = '#4CAF50';
                } else {
                    document.getElementById('connectionStatus').textContent = 'Error';
                    document.getElementById('connectionStatus').style.color = '#FFC107';
                }
            } catch (error) {
                document.getElementById('connectionStatus').textContent = 'Disconnected';
                document.getElementById('connectionStatus').style.color = '#f44336';
            }
            
            // Check game status
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (!tab || (!tab.url.includes('slither.io') && !tab.url.includes('slither.com'))) {
                document.getElementById('gameStatus').textContent = 'Not on Slither.io';
                document.getElementById('collectionStatus').textContent = 'N/A';
                return;
            }
            
            // Try to get status from content script
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {type: 'GET_STATUS'});
                if (response) {
                    document.getElementById('gameStatus').textContent = 
                        response.gameState?.isActive ? 'Active' : 'Inactive';
                    document.getElementById('collectionStatus').textContent = 
                        response.isCollecting ? 'Collecting' : 'Stopped';
                }
            } catch (error) {
                // Content script might not be loaded yet
                document.getElementById('gameStatus').textContent = 'Loading...';
                document.getElementById('collectionStatus').textContent = 'Loading...';
            }
        } catch (error) {
            console.error('Error updating status:', error);
        }
    }
    
    startStatusUpdates() {
        // Initial update
        this.updateStatus();
        
        // Update every 2 seconds
        setInterval(() => this.updateStatus(), 2000);
    }
    
    // AI Control Methods
    updateAIControls(enabled) {
        const aiServerUrl = document.getElementById('aiServerUrl');
        const aiAutoStart = document.getElementById('aiAutoStart');
        const aiConnect = document.getElementById('aiConnect');
        const aiDisconnect = document.getElementById('aiDisconnect');
        const aiStartControl = document.getElementById('aiStartControl');
        const aiStopControl = document.getElementById('aiStopControl');
        
        if (enabled) {
            aiServerUrl.style.display = 'block';
            aiServerUrl.parentElement.style.display = 'block';
            aiAutoStart.parentElement.style.display = 'flex';
            aiConnect.style.display = 'block';
        } else {
            aiServerUrl.parentElement.style.display = 'none';
            aiAutoStart.parentElement.style.display = 'none';
            aiConnect.style.display = 'none';
            aiDisconnect.style.display = 'none';
            aiStartControl.style.display = 'none';
            aiStopControl.style.display = 'none';
        }
    }
    
    async connectAI() {
        const aiServerUrl = document.getElementById('aiServerUrl').value.trim();
        
        if (!aiServerUrl) {
            this.showStatus('error', 'Please enter AI server URL');
            return;
        }
        
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'AI_CONNECT',
                    serverUrl: aiServerUrl
                });
                this.showStatus('success', 'Connecting to AI server...');
            } else {
                this.showStatus('error', 'Please open slither.io first');
            }
        } catch (error) {
            console.error('Error connecting to AI:', error);
            this.showStatus('error', 'Failed to connect to AI');
        }
    }
    
    async disconnectAI() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'AI_DISCONNECT'
                });
                this.showStatus('success', 'Disconnected from AI');
            }
        } catch (error) {
            console.error('Error disconnecting from AI:', error);
        }
    }
    
    async startAIControl() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'AI_START_CONTROL'
                });
                this.showStatus('success', 'AI Control started!');
            }
        } catch (error) {
            console.error('Error starting AI control:', error);
            this.showStatus('error', 'Failed to start AI control');
        }
    }
    
    async stopAIControl() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'AI_STOP_CONTROL'
                });
                this.showStatus('success', 'AI Control stopped');
            }
        } catch (error) {
            console.error('Error stopping AI control:', error);
        }
    }
    
    updateAIStatus(status, details) {
        const aiStatusEl = document.getElementById('aiStatus');
        const aiLatencyItem = document.getElementById('aiLatencyItem');
        const aiLatencyEl = document.getElementById('aiLatency');
        
        const aiConnect = document.getElementById('aiConnect');
        const aiDisconnect = document.getElementById('aiDisconnect');
        const aiStartControl = document.getElementById('aiStartControl');
        const aiStopControl = document.getElementById('aiStopControl');
        
        switch (status) {
            case 'connected':
                aiStatusEl.textContent = 'Connected';
                aiStatusEl.style.color = '#4CAF50';
                aiConnect.style.display = 'none';
                aiDisconnect.style.display = 'block';
                aiStartControl.style.display = 'block';
                aiStopControl.style.display = 'none';
                break;
                
            case 'ready':
                aiStatusEl.textContent = 'Ready';
                aiStatusEl.style.color = '#4CAF50';
                aiStartControl.style.display = 'block';
                break;
                
            case 'controlling':
                aiStatusEl.textContent = '🤖 AI Controlling';
                aiStatusEl.style.color = '#10b981';
                aiStartControl.style.display = 'none';
                aiStopControl.style.display = 'block';
                
                if (details && details.avgLatency > 0) {
                    aiLatencyItem.style.display = 'flex';
                    aiLatencyEl.textContent = details.avgLatency.toFixed(0) + ' ms';
                }
                break;
                
            case 'disconnected':
                aiStatusEl.textContent = 'Disconnected';
                aiStatusEl.style.color = '#f44336';
                aiConnect.style.display = 'block';
                aiDisconnect.style.display = 'none';
                aiStartControl.style.display = 'none';
                aiStopControl.style.display = 'none';
                aiLatencyItem.style.display = 'none';
                break;
        }
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});