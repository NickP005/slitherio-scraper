// Background Service Worker for Slither.io Data Collector Extension

class BackgroundService {
    constructor() {
        this.init();
    }
    
    init() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'install') {
                this.onInstall();
            } else if (details.reason === 'update') {
                this.onUpdate(details.previousVersion);
            }
        });
        
        // Handle messages from content scripts
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });
        
        // Handle tab updates to inject content scripts
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && this.isSlitherTab(tab.url)) {
                this.handleSlitherTabReady(tabId);
            }
        });
        
        console.log('[Background] Slither.io Data Collector service worker initialized');
    }
    
    async onInstall() {
        // Set default settings only if they don't exist
        const existing = await chrome.storage.sync.get({
            username: '',
            serverHost: 'http://127.0.0.1:5055',
            autoStart: true,
            debugMode: false
        });
        
        // Only set defaults for missing values
        const defaults = {
            username: existing.username || '',
            serverHost: existing.serverHost || 'http://127.0.0.1:5055',
            autoStart: existing.autoStart !== undefined ? existing.autoStart : true,
            debugMode: existing.debugMode !== undefined ? existing.debugMode : false
        };
        
        await chrome.storage.sync.set(defaults);
        
        // Show welcome notification (only on fresh install)
        if (!existing.username && !existing.serverHost) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Slither.io Data Collector Installed',
                message: 'Click the extension icon to configure settings and start collecting data!'
            });
        }
        
        console.log('[Background] Extension installed, default settings applied');
    }
    
    onUpdate(previousVersion) {
        console.log(`[Background] Extension updated from ${previousVersion}`);
        
        // Handle migration if needed
        if (this.compareVersions(previousVersion, '1.0.0') < 0) {
            // Migration logic for future updates
        }
    }
    
    compareVersions(a, b) {
        const aP = a.split('.').map(Number);
        const bP = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(aP.length, bP.length); i++) {
            const aV = aP[i] || 0;
            const bV = bP[i] || 0;
            if (aV > bV) return 1;
            if (aV < bV) return -1;
        }
        return 0;
    }
    
    isSlitherTab(url) {
        return url && (url.includes('slither.io') || url.includes('slither.com'));
    }
    
    async handleSlitherTabReady(tabId) {
        try {
            // Check if content script is already injected
            const response = await chrome.tabs.sendMessage(tabId, {action: 'ping'});
        } catch (error) {
            // Content script not injected, inject it
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content/data-collector.js']
                });
                console.log('[Background] Content script injected into tab', tabId);
            } catch (injectionError) {
                console.error('[Background] Failed to inject content script:', injectionError);
            }
        }
    }
    
    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'getSettings':
                    const settings = await chrome.storage.sync.get();
                    sendResponse({ success: true, settings });
                    break;
                    
                case 'saveSettings':
                    await chrome.storage.sync.set(request.settings);
                    sendResponse({ success: true });
                    break;
                    
                case 'testConnection':
                    const result = await this.testServerConnection(request.host);
                    sendResponse(result);
                    break;
                    
                case 'getStats':
                    const stats = await this.getCollectionStats();
                    sendResponse({ success: true, stats });
                    break;
                    
                case 'ping':
                    sendResponse({ success: true, pong: true });
                    break;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('[Background] Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    
    async testServerConnection(host) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${host}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    connected: true,
                    data: data
                };
            } else {
                return {
                    success: false,
                    connected: false,
                    error: `Server responded with status ${response.status}`
                };
            }
        } catch (error) {
            return {
                success: false,
                connected: false,
                error: error.message
            };
        }
    }
    
    async getCollectionStats() {
        // Get stats from storage or active tabs
        try {
            const tabs = await chrome.tabs.query({
                url: ['*://slither.io/*', '*://slither.com/*']
            });
            
            if (tabs.length === 0) {
                return { activeTabs: 0, collecting: false };
            }
            
            const stats = { activeTabs: tabs.length, collecting: false, totalFrames: 0 };
            
            for (const tab of tabs) {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, {action: 'getStatus'});
                    if (response && response.collecting) {
                        stats.collecting = true;
                        stats.totalFrames += response.stats?.frameCount || 0;
                    }
                } catch (error) {
                    // Tab doesn't have content script, ignore
                }
            }
            
            return stats;
        } catch (error) {
            console.error('[Background] Error getting stats:', error);
            return { error: error.message };
        }
    }
    
    // Utility method to update extension badge
    updateBadge(text, color = '#10b981') {
        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ color: color });
    }
    
    // Method to handle collection status updates
    onCollectionStatusChange(collecting, frameCount = 0) {
        if (collecting) {
            this.updateBadge('ON', '#10b981');
            chrome.action.setTitle({ title: `Slither.io Data Collector - Collecting (${frameCount} frames)` });
        } else {
            this.updateBadge('', '#6b7280');
            chrome.action.setTitle({ title: 'Slither.io Data Collector - Idle' });
        }
    }
}

// Initialize background service
new BackgroundService();