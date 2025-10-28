// AI Control Module - WebSocket client for ESN-based snake control
// This module handles connection to AI server and applies control commands

(function() {
    'use strict';
    
    // AI Control State
    const aiControlState = {
        websocket: null,
        isConnected: false,
        isControlling: false,
        serverUrl: null,
        
        // Frame tracking
        lastSentFrame: null,
        lastSentHeading: 0,
        lastCommand: null,
        
        // Target heading for smooth control
        targetHeading: null,
        
        // Statistics
        framesSent: 0,
        commandsReceived: 0,
        commandsApplied: 0,
        errors: 0,
        
        // Latency tracking
        latencySum: 0,
        latencyCount: 0,
        latencyAvg: 0,
        
        // Boost state
        boostState: false,
        lastBoostChange: 0,
        
        // Respawn tracking
        consecutiveRespawns: 0,
        maxConsecutiveRespawns: 3,
        lastSuccessfulSpawn: Date.now(),
        isRespawning: false,  // Flag to prevent multiple respawn attempts
        
        // Settings
        confidenceThreshold: 0.3,  // Min confidence to apply command
        maxAngleDelta: Math.PI,    // Max angle change per frame
        smoothingFactor: 1.0,      // Angle smoothing [0-1]
        
        // Debug
        debugMode: false
    };
    
    // ==========================================
    // WebSocket Management
    // ==========================================
    
    function connectToAIServer(serverUrl) {
        if (aiControlState.websocket && aiControlState.isConnected) {
            console.log('[AI Control] Already connected');
            return;
        }
        
        try {
            aiControlState.serverUrl = serverUrl;
            aiControlState.websocket = new WebSocket(serverUrl);
            
            aiControlState.websocket.onopen = handleWebSocketOpen;
            aiControlState.websocket.onmessage = handleWebSocketMessage;
            aiControlState.websocket.onerror = handleWebSocketError;
            aiControlState.websocket.onclose = handleWebSocketClose;
            
            console.log('[AI Control] Connecting to:', serverUrl);
            
        } catch (error) {
            console.error('[AI Control] Failed to create WebSocket:', error);
            notifyError('Failed to connect to AI server');
        }
    }
    
    function disconnectFromAIServer() {
        if (aiControlState.websocket) {
            aiControlState.isControlling = false;
            aiControlState.websocket.close();
            aiControlState.websocket = null;
        }
        
        aiControlState.isConnected = false;
        
        // Release boost if active
        if (aiControlState.boostState) {
            setBoost(false);
            aiControlState.boostState = false;
        }
        
        console.log('[AI Control] Disconnected from AI server');
        notifyStatus('disconnected');
    }
    
    function handleWebSocketOpen(event) {
        aiControlState.isConnected = true;
        console.log('[AI Control] WebSocket connected');
        notifyStatus('connected');
    }
    
    function handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'ready':
                    handleReadyMessage(message);
                    break;
                    
                case 'control':
                    handleControlCommand(message);
                    break;
                    
                case 'error':
                    console.error('[AI Control] Server error:', message.message);
                    notifyError(message.message);
                    break;
                    
                default:
                    console.warn('[AI Control] Unknown message type:', message.type);
            }
            
        } catch (error) {
            console.error('[AI Control] Failed to parse message:', error);
            aiControlState.errors++;
        }
    }
    
    function handleWebSocketError(event) {
        console.error('[AI Control] WebSocket error:', event);
        aiControlState.errors++;
        notifyError('WebSocket connection error');
    }
    
    function handleWebSocketClose(event) {
        console.log('[AI Control] WebSocket closed:', event.code, event.reason);
        aiControlState.isConnected = false;
        aiControlState.isControlling = false;
        
        // Release boost if active
        if (aiControlState.boostState) {
            setBoost(false);
            aiControlState.boostState = false;
        }
        
        notifyStatus('disconnected');
        
        // Auto-reconnect if it was an unexpected close
        if (event.code !== 1000 && aiControlState.serverUrl) {
            console.log('[AI Control] Attempting reconnect in 3 seconds...');
            setTimeout(() => {
                connectToAIServer(aiControlState.serverUrl);
            }, 3000);
        }
    }
    
    function handleReadyMessage(message) {
        console.log('[AI Control] Server ready:', message);
        
        if (message.modelInfo) {
            console.log('[AI Control] Model info:', message.modelInfo);
        }
        
        // Enable controlling if connection is successful
        notifyStatus('ready');
    }
    
    // ==========================================
    // Frame Sending
    // ==========================================
    
    function sendFrameToAI(frameData) {
        if (!aiControlState.isConnected || !aiControlState.websocket) {
            return false;
        }
        
        if (aiControlState.websocket.readyState !== WebSocket.OPEN) {
            return false;
        }
        
        try {
            // Store frame info for command application
            aiControlState.lastSentFrame = frameData;
            aiControlState.lastSentHeading = frameData.metadata.heading;
            
            // Add send timestamp for latency measurement
            frameData._sendTime = performance.now();
            
            // Send to AI server
            aiControlState.websocket.send(JSON.stringify(frameData));
            aiControlState.framesSent++;
            
            if (aiControlState.debugMode && aiControlState.framesSent % 50 === 1) {
                console.log('[AI Control] Sent frame', aiControlState.framesSent);
            }
            
            return true;
            
        } catch (error) {
            console.error('[AI Control] Failed to send frame:', error);
            aiControlState.errors++;
            return false;
        }
    }
    
    // ==========================================
    // Control Command Handling
    // ==========================================
    
    function handleControlCommand(message) {
        if (!aiControlState.isControlling) {
            return; // Ignore commands if not actively controlling
        }
        
        aiControlState.commandsReceived++;
        aiControlState.lastCommand = message;
        
        // Calculate latency
        if (aiControlState.lastSentFrame && aiControlState.lastSentFrame._sendTime) {
            const latency = performance.now() - aiControlState.lastSentFrame._sendTime;
            aiControlState.latencySum += latency;
            aiControlState.latencyCount++;
            aiControlState.latencyAvg = aiControlState.latencySum / aiControlState.latencyCount;
            
            if (aiControlState.debugMode && aiControlState.commandsReceived % 50 === 1) {
                console.log(`[AI Control] Latency: ${latency.toFixed(1)}ms, Avg: ${aiControlState.latencyAvg.toFixed(1)}ms`);
            }
        }
        
        // Validate command
        if (!message.command) {
            console.warn('[AI Control] Invalid command - missing command field');
            return;
        }
        
        const { angleDelta, boost } = message.command;
        const confidence = message.confidence || 1.0;
        
        // Check confidence threshold
        if (confidence < aiControlState.confidenceThreshold) {
            if (aiControlState.debugMode) {
                console.log(`[AI Control] Low confidence (${confidence.toFixed(2)}), skipping command`);
            }
            return;
        }
        
        // Validate angleDelta range
        if (Math.abs(angleDelta) > aiControlState.maxAngleDelta) {
            console.warn(`[AI Control] angleDelta too large (${angleDelta.toFixed(2)}), clamping`);
            return;
        }
        
        // Apply control command
        applyControlCommand(angleDelta, boost, confidence);
        
        if (aiControlState.debugMode && aiControlState.commandsReceived % 50 === 1) {
            console.log('[AI Control] Command applied:', {
                angleDelta: (angleDelta * 180 / Math.PI).toFixed(1) + '°',
                boost: boost,
                confidence: confidence.toFixed(2)
            });
        }
    }
    
    function applyControlCommand(angleDelta, boost, confidence) {
        // Get current snake to read actual heading
        const snake = window.slither || window.snake;
        if (!snake) {
            console.warn('[AI Control] No snake found, cannot apply command');
            return;
        }
        
        // Apply confidence smoothing
        let adjustedAngleDelta = angleDelta;
        if (confidence < 0.8) {
            adjustedAngleDelta *= (confidence * aiControlState.smoothingFactor);
        }
        
        // CRITICAL: Accumulate angle delta to target heading
        // Don't use current snake.ang because it's affected by our own mouse override!
        // Instead, maintain our own target angle that we increment
        if (aiControlState.targetHeading === null) {
            // First command - initialize with current heading
            aiControlState.targetHeading = snake.ang;
        }
        
        // Add the delta to our target heading
        aiControlState.targetHeading += adjustedAngleDelta;
        
        // Normalize to [-PI, PI] range
        while (aiControlState.targetHeading > Math.PI) {
            aiControlState.targetHeading -= 2 * Math.PI;
        }
        while (aiControlState.targetHeading < -Math.PI) {
            aiControlState.targetHeading += 2 * Math.PI;
        }
        
        if (aiControlState.debugMode && aiControlState.commandsApplied % 20 === 0) {
            console.log('[AI Control] Command:', {
                currentHeading: (snake.ang * 180 / Math.PI).toFixed(1) + '°',
                angleDelta: (angleDelta * 180 / Math.PI).toFixed(1) + '°',
                adjustedDelta: (adjustedAngleDelta * 180 / Math.PI).toFixed(1) + '°',
                targetHeading: (aiControlState.targetHeading * 180 / Math.PI).toFixed(1) + '°',
                boost: boost,
                confidence: confidence.toFixed(2)
            });
        }
        
        // Apply boost
        if (boost !== aiControlState.boostState) {
            setBoost(boost);
            aiControlState.boostState = boost;
            aiControlState.lastBoostChange = performance.now();
        }
        
        aiControlState.commandsApplied++;
    }
    
    // Continuous mouse position override - prevents real mouse from interfering
    let mouseOverrideIntervalId = null;
    
    // Auto-respawn monitoring
    let respawnMonitorIntervalId = null;
    
    function startMouseOverride() {
        if (mouseOverrideIntervalId !== null) {
            return; // Already running
        }
        
        // Override mouse position at 30 FPS (every ~33ms)
        // This is fast enough to prevent real mouse interference but not too aggressive
        mouseOverrideIntervalId = setInterval(() => {
            if (!aiControlState.isControlling || aiControlState.targetHeading === null) {
                return;
            }
            
            // Continuously apply the target heading
            const centerX = window.ww / 2;
            const centerY = window.hh / 2;
            
            // IMPORTANT: Use large radius for better control (1500 instead of 500)
            const radius = 1500;
            
            // IMPORTANT: Slither.io coordinate system
            // - Y axis is INVERTED (positive Y = down)
            // - So we need to NEGATE the sin component
            window.xm = centerX + Math.cos(aiControlState.targetHeading) * radius;
            window.ym = centerY - Math.sin(aiControlState.targetHeading) * radius;  // Note the MINUS!
            
        }, 33); // 30 FPS
        
        console.log('[AI Control] Mouse override started (30 FPS)');
    }
    
    function stopMouseOverride() {
        if (mouseOverrideIntervalId !== null) {
            clearInterval(mouseOverrideIntervalId);
            mouseOverrideIntervalId = null;
            console.log('[AI Control] Mouse override stopped');
        }
    }
    
    // Auto-respawn functionality
    function startRespawnMonitor() {
        if (respawnMonitorIntervalId !== null) {
            return; // Already monitoring
        }
        
        // Check game status every 500ms
        respawnMonitorIntervalId = setInterval(() => {
            if (!aiControlState.isControlling) {
                stopRespawnMonitor();
                return;
            }
            
            // Check if snake is alive
            const snake = window.slither || window.snake;
            const isPlaying = window.playing;
            
            if (snake && isPlaying) {
                // Snake is alive! Clear respawn flag and reset counter if enough time passed
                aiControlState.isRespawning = false;
                
                const timeSinceLastSpawn = Date.now() - aiControlState.lastSuccessfulSpawn;
                if (timeSinceLastSpawn > 10000) { // 10 seconds of survival = success
                    if (aiControlState.consecutiveRespawns > 0) {
                        console.log('[AI Control] ✅ Snake survived 10+ seconds, reset respawn counter');
                        aiControlState.consecutiveRespawns = 0;
                    }
                }
            } else if (!aiControlState.isRespawning) {
                // Snake is dead and we're not already respawning!
                
                // Check if we can respawn
                if (aiControlState.consecutiveRespawns >= aiControlState.maxConsecutiveRespawns) {
                    console.log('[AI Control] ⛔ Max consecutive respawns reached (' + 
                                aiControlState.maxConsecutiveRespawns + '). Stopping AI control.');
                    console.log('[AI Control] Please check server connection and restart AI manually.');
                    stopAIControl();
                    return;
                }
                
                // Set flag to prevent multiple attempts
                aiControlState.isRespawning = true;
                
                // Attempt respawn
                console.log('[AI Control] 💀 Snake died! Auto-respawning in 2 seconds... (attempt ' + 
                            (aiControlState.consecutiveRespawns + 1) + '/' + 
                            aiControlState.maxConsecutiveRespawns + ')');
                
                setTimeout(() => {
                    // Double-check we're still controlling
                    if (aiControlState.isControlling && typeof window.connect === 'function') {
                        try {
                            window.connect();
                            aiControlState.consecutiveRespawns++;
                            aiControlState.lastSuccessfulSpawn = Date.now();
                            console.log('[AI Control] ✅ Auto-respawned successfully!');
                            
                            // Reset targetHeading after respawn
                            aiControlState.targetHeading = null;
                        } catch (error) {
                            console.error('[AI Control] ❌ Respawn failed:', error);
                            aiControlState.consecutiveRespawns++;
                            // Clear flag so we can try again
                            aiControlState.isRespawning = false;
                        }
                    } else {
                        // Clear flag if we're no longer controlling
                        aiControlState.isRespawning = false;
                    }
                }, 2000);
            }
            // else: snake dead but isRespawning=true → skip (already scheduled)
        }, 500);
        
        console.log('[AI Control] Auto-respawn monitor started (max ' + 
                    aiControlState.maxConsecutiveRespawns + ' consecutive respawns)');
    }
    
    function stopRespawnMonitor() {
        if (respawnMonitorIntervalId !== null) {
            clearInterval(respawnMonitorIntervalId);
            respawnMonitorIntervalId = null;
            console.log('[AI Control] Auto-respawn monitor stopped');
        }
    }
    
    // ==========================================
    // Snake Control Functions
    // ==========================================
    
    function setSnakeDirection(angleRadians) {
        // This function is now only used for logging/debugging
        // The actual direction control happens in startMouseOverride()
        const snake = window.slither || window.snake;
        if (!snake) {
            return;
        }
        
        if (aiControlState.debugMode && aiControlState.commandsApplied % 200 === 0) {
            const centerX = window.ww / 2;
            const centerY = window.hh / 2;
            const radius = 500;
            const targetXm = centerX + Math.cos(angleRadians) * radius;
            const targetYm = centerY + Math.sin(angleRadians) * radius;
            
            console.log('[AI Control] Target direction:', {
                targetAngle: (angleRadians * 180 / Math.PI).toFixed(1) + '°',
                currentSnakeAngle: (snake.ang * 180 / Math.PI).toFixed(1) + '°',
                targetXm: targetXm.toFixed(0),
                targetYm: targetYm.toFixed(0),
                currentXm: window.xm.toFixed(0),
                currentYm: window.ym.toFixed(0)
            });
        }
    }
    
    function setBoost(enabled) {
        const eventType = enabled ? 'keydown' : 'keyup';
        const event = new KeyboardEvent(eventType, {
            key: ' ',
            code: 'Space',
            keyCode: 32,
            which: 32,
            bubbles: true,
            cancelable: true
        });
        
        document.dispatchEvent(event);
    }
    
    // ==========================================
    // Control Management
    // ==========================================
    
    function startAIControl() {
        if (!aiControlState.isConnected) {
            console.warn('[AI Control] Cannot start - not connected');
            notifyError('Not connected to AI server');
            return false;
        }
        
        const snake = window.slither || window.snake;
        if (!snake) {
            console.warn('[AI Control] Cannot start - snake not found');
            notifyError('Snake not found in game');
            return false;
        }
        
        aiControlState.isControlling = true;
        
        // Initialize target heading with current snake heading
        aiControlState.targetHeading = snake.ang;
        
        // Reset statistics
        aiControlState.framesSent = 0;
        aiControlState.commandsReceived = 0;
        aiControlState.commandsApplied = 0;
        aiControlState.latencySum = 0;
        aiControlState.latencyCount = 0;
        aiControlState.latencyAvg = 0;
        
        console.log('[AI Control] AI control started - mouse override at 30 FPS');
        notifyStatus('controlling');
        
        // Notify injected script that AI is now controlling
        window.postMessage({
            type: 'AI_CONTROL_STATUS',
            isControlling: true
        }, '*');
        
        // Start continuous mouse position override
        startMouseOverride();
        
        // Start auto-respawn monitor
        startRespawnMonitor();
        
        return true;
    }
    
    function stopAIControl() {
        aiControlState.isControlling = false;
        
        // Notify injected script that AI is no longer controlling
        window.postMessage({
            type: 'AI_CONTROL_STATUS',
            isControlling: false
        }, '*');
        
        // Stop mouse override
        stopMouseOverride();
        
        // Stop respawn monitor
        stopRespawnMonitor();
        
        // Release boost if active
        if (aiControlState.boostState) {
            setBoost(false);
            aiControlState.boostState = false;
        }
        
        console.log('[AI Control] AI control stopped');
        console.log('[AI Control] Statistics:', {
            framesSent: aiControlState.framesSent,
            commandsReceived: aiControlState.commandsReceived,
            commandsApplied: aiControlState.commandsApplied,
            avgLatency: aiControlState.latencyAvg.toFixed(1) + 'ms',
            errors: aiControlState.errors
        });
        
        notifyStatus('connected');
    }
    
    function getAIControlStatus() {
        return {
            isConnected: aiControlState.isConnected,
            isControlling: aiControlState.isControlling,
            serverUrl: aiControlState.serverUrl,
            framesSent: aiControlState.framesSent,
            commandsReceived: aiControlState.commandsReceived,
            commandsApplied: aiControlState.commandsApplied,
            avgLatency: aiControlState.latencyAvg,
            errors: aiControlState.errors
        };
    }
    
    // ==========================================
    // Notifications
    // ==========================================
    
    function notifyStatus(status) {
        window.postMessage({
            type: 'AI_CONTROL_STATUS',
            status: status,
            details: getAIControlStatus()
        }, '*');
    }
    
    function notifyError(errorMessage) {
        window.postMessage({
            type: 'AI_CONTROL_ERROR',
            error: errorMessage
        }, '*');
    }
    
    // ==========================================
    // Public API - exposed to injected script
    // ==========================================
    
    window.AIControl = {
        connect: connectToAIServer,
        disconnect: disconnectFromAIServer,
        start: startAIControl,
        stop: stopAIControl,
        sendFrame: sendFrameToAI,
        getStatus: getAIControlStatus,
        
        // Settings
        setDebugMode: (enabled) => { aiControlState.debugMode = enabled; },
        setConfidenceThreshold: (threshold) => { aiControlState.confidenceThreshold = threshold; },
        setSmoothingFactor: (factor) => { aiControlState.smoothingFactor = factor; },
        
        // State accessors
        isConnected: () => aiControlState.isConnected,
        isControlling: () => aiControlState.isControlling
    };
    
    console.log('[AI Control] Module loaded');
})();
