// Popup JavaScript for Slither.io Data Collector Extension

class PopupController {
    constructor() {
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.bindEvents();
        this.startStatusUpdates();
    }
    
    async loadSettings() {
        try {
            const settings = await chrome.storage.sync.get({
                username: '',
                serverHost: 'http://127.0.0.1:5055',
                autoStart: true,
                debugMode: true  // Enable debug by default for testing
            });
            
            document.getElementById('username').value = settings.username;
            document.getElementById('serverHost').value = settings.serverHost;
            
            if (document.getElementById('autoStart')) {
                document.getElementById('autoStart').checked = settings.autoStart;
            }
            if (document.getElementById('debugMode')) {
                document.getElementById('debugMode').checked = settings.debugMode;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
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
    }
    
    async saveSettings() {
        const settings = {
            username: document.getElementById('username').value.trim(),
            serverHost: document.getElementById('serverHost').value.trim(),
            autoStart: document.getElementById('autoStart') ? document.getElementById('autoStart').checked : true,
            debugMode: document.getElementById('debugMode') ? document.getElementById('debugMode').checked : false
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
        // Update status immediately
        this.updateStatus();
        
        // Update status every 2 seconds
        setInterval(() => {
            this.updateStatus();
        }, 2000);
        
        // Auto-test connection on load
        setTimeout(() => {
            const host = document.getElementById('serverHost').value.trim();
            if (host) {
                this.testConnection();
            }
        }, 1000);
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});