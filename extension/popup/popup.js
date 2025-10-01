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
                host: 'http://127.0.0.1:5055',
                sampleRate: '10',
                alphaWarp: '6.0',
                autoStart: true,
                debugMode: false
            });
            
            document.getElementById('username').value = settings.username;
            document.getElementById('host').value = settings.host;
            document.getElementById('sampleRate').value = settings.sampleRate;
            document.getElementById('alphaWarp').value = settings.alphaWarp;
            document.getElementById('autoStart').checked = settings.autoStart;
            document.getElementById('debugMode').checked = settings.debugMode;
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
    
    bindEvents() {
        // Settings form submission
        document.getElementById('settingsForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSettings();
        });
        
        // Test connection button
        document.getElementById('testConnection').addEventListener('click', () => {
            this.testConnection();
        });
        
        // Advanced settings toggle
        document.getElementById('advancedToggle').addEventListener('click', (e) => {
            e.preventDefault();
            const advanced = document.getElementById('advancedSettings');
            advanced.classList.toggle('show');
            e.target.textContent = advanced.classList.contains('show') 
                ? 'Hide Advanced Settings' 
                : 'Advanced Settings';
        });
    }
    
    async saveSettings() {
        const settings = {
            username: document.getElementById('username').value.trim(),
            host: document.getElementById('host').value.trim(),
            sampleRate: document.getElementById('sampleRate').value,
            alphaWarp: document.getElementById('alphaWarp').value,
            autoStart: document.getElementById('autoStart').checked,
            debugMode: document.getElementById('debugMode').checked
        };
        
        // Validate settings
        if (!settings.username) {
            this.showStatus('error', 'Please enter a username');
            return;
        }
        
        if (!settings.host) {
            this.showStatus('error', 'Please enter a server host');
            return;
        }
        
        try {
            // Save to storage
            await chrome.storage.sync.set(settings);
            
            // Send to content script
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'updateSettings',
                    settings: settings
                });
            }
            
            this.showStatus('success', '✅ Settings saved successfully');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('error', 'Failed to save settings');
        }
    }
    
    async testConnection() {
        const host = document.getElementById('host').value.trim();
        if (!host) {
            this.showStatus('error', 'Please enter a server host first');
            return;
        }
        
        this.showStatus('testing', '🔄 Testing connection...');
        
        try {
            const response = await fetch(`${host}/health`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showStatus('success', `✅ Connected! Active sessions: ${data.active_sessions}`);
            } else {
                this.showStatus('error', `❌ Server error: ${response.status}`);
            }
        } catch (error) {
            console.error('Connection test failed:', error);
            this.showStatus('error', '❌ Connection failed. Check host and server status.');
        }
    }
    
    showStatus(type, message) {
        const statusEl = document.getElementById('status');
        statusEl.className = `status ${type}`;
        statusEl.textContent = message;
        
        // Reset after 3 seconds for non-persistent messages
        if (type !== 'connected' && type !== 'collecting') {
            setTimeout(() => {
                this.updateConnectionStatus();
            }, 3000);
        }
    }
    
    async updateConnectionStatus() {
        try {
            // Get status from background script or content script
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab && (tab.url.includes('slither.io') || tab.url.includes('slither.com'))) {
                chrome.tabs.sendMessage(tab.id, {action: 'getStatus'}, (response) => {
                    if (chrome.runtime.lastError) {
                        this.showStatus('disconnected', '🔴 Extension not active');
                        return;
                    }
                    
                    if (response) {
                        if (response.collecting) {
                            this.showStatus('collecting', '🟢 Collecting data...');
                            this.updateStats(response.stats);
                        } else if (response.connected) {
                            this.showStatus('connected', '🟡 Connected, waiting for game');
                        } else {
                            this.showStatus('disconnected', '🔴 Disconnected');
                        }
                    }
                });
            } else {
                this.showStatus('disconnected', '🔴 Go to slither.io to start');
            }
        } catch (error) {
            console.error('Error updating status:', error);
            this.showStatus('disconnected', '🔴 Disconnected');
        }
    }
    
    updateStats(stats) {
        if (!stats) return;
        
        const statsPanel = document.getElementById('statsPanel');
        statsPanel.style.display = 'block';
        
        document.getElementById('sessionId').textContent = 
            stats.sessionId ? stats.sessionId.substring(0, 8) + '...' : '-';
        document.getElementById('frameCount').textContent = stats.frameCount || '0';
        document.getElementById('validRate').textContent = 
            stats.validRate ? stats.validRate + '%' : '0%';
        document.getElementById('errorCount').textContent = stats.errors || '0';
    }
    
    startStatusUpdates() {
        // Update status immediately
        this.updateConnectionStatus();
        
        // Update every 2 seconds
        setInterval(() => {
            this.updateConnectionStatus();
        }, 2000);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});