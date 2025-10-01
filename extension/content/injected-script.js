// Injected Script - Runs in page context for Slither.io Data Collection
// This script has access to the game's global variables

(function() {
    'use strict';
    
    // Configuration (will be updated from content script)
    let CONFIG = {
        ANGULAR_BINS: 64,
        RADIAL_BINS: 24,
        ALPHA_WARP: 6.0,
        R_MIN: 60,
        R_MAX: 3200,
        SAMPLE_RATE_HZ: 10,
        EMA_BETA: 0.99,
        SATURATION_FACTOR: 3.0,
        CHANNELS: 4,
        CH_FOOD: 0,
        CH_ENEMY_BODY: 1,
        CH_MY_BODY: 2,
        CH_ENEMY_HEADS: 3,
        USERNAME: 'anonymous',
        BACKEND_URL: 'http://127.0.0.1:5055/ingest',
        DEBUG_LOG: false
    };
    
    // State variables
    let gameState = {
        gameRadius: null,
        isActive: false,
        sessionId: null,
        frameCount: 0,
        validFrames: 0,
        errors: 0
    };
    
    let samplingState = {
        lastSampleTime: 0,
        previousPosition: null,
        emaChannels: null,
        isBoosting: false,
        isCollecting: false,
        samplingInterval: null
    };
    
    // Polar grid mathematics (from original userscript)
    function angularWarp(phi, alpha) {
        const sign = Math.sign(phi);
        const x = Math.abs(phi) / Math.PI;
        const y = Math.log1p(alpha * x) / Math.log1p(alpha);
        return sign * y * Math.PI;
    }
    
    function getPolarIndex(u, v, K, M, rmin, rmax, alpha) {
        const r = Math.hypot(u, v);
        if (r > rmax || r < rmin) return null;

        const phi = Math.atan2(v, u);
        const warpedPhi = angularWarp(phi, alpha);
        const theta = (warpedPhi + Math.PI) / (2 * Math.PI);

        const k = Math.min(K - 1, Math.max(0, Math.floor(K * theta)));
        const logFactor = Math.log(r / rmin) / Math.log(rmax / rmin);
        const j = Math.min(M - 1, Math.max(0, Math.floor(M * logFactor)));

        return [k, j];
    }
    
    function createPolarGrid() {
        return new Float32Array(CONFIG.ANGULAR_BINS * CONFIG.RADIAL_BINS * CONFIG.CHANNELS);
    }
    
    function splatToGrid(grid, k, j, channel, weight = 0.25) {
        const idx = (j * CONFIG.ANGULAR_BINS + k) * CONFIG.CHANNELS + channel;
        grid[idx] = Math.min(1.0, grid[idx] + weight);
    }
    
    // Game data extraction
    function getMySnake() {
        return window.slither || window.snake || null;
    }
    
    function getAllSnakes() {
        return window.slithers || window.snakes || [];
    }
    
    function getAllFood() {
        return window.foods || [];
    }
    
    function getMousePosition() {
        return {
            x: window.xm || 0,
            y: window.ym || 0,
            screenWidth: window.ww || 800,
            screenHeight: window.hh || 600
        };
    }
    
    // Data collection functions (adapted from original userscript)
    function populateGridWithFood(grid, mySnake) {
        const foods = getAllFood();
        if (!foods || !Array.isArray(foods)) return 0;
        
        const cos_ang = Math.cos(mySnake.ang);
        const sin_ang = Math.sin(mySnake.ang);
        let foodCount = 0;
        
        for (const food of foods) {
            if (!food || typeof food.xx !== 'number' || typeof food.yy !== 'number' ||
                isNaN(food.xx) || isNaN(food.yy)) continue;
            
            const dx = food.xx - mySnake.xx;
            const dy = food.yy - mySnake.yy;
            const u = dx * cos_ang + dy * sin_ang;
            const v = -dx * sin_ang + dy * cos_ang;
            
            const polarIdx = getPolarIndex(u, v, CONFIG.ANGULAR_BINS, CONFIG.RADIAL_BINS,
                                         CONFIG.R_MIN, CONFIG.R_MAX, CONFIG.ALPHA_WARP);
            
            if (polarIdx) {
                const weight = (food.sz || 1) * 0.1;
                splatToGrid(grid, polarIdx[0], polarIdx[1], CONFIG.CH_FOOD, weight);
                foodCount++;
            }
        }
        
        return foodCount;
    }
    
    function populateGridWithSnakes(grid, mySnake) {
        const snakes = getAllSnakes();
        if (!snakes || !Array.isArray(snakes)) {
            return { enemySegments: 0, mySegments: 0, enemyHeads: 0 };
        }
        
        const cos_ang = Math.cos(mySnake.ang);
        const sin_ang = Math.sin(mySnake.ang);
        let enemySegments = 0, mySegments = 0, enemyHeads = 0;
        
        for (const snake of snakes) {
            if (!snake || !snake.pts || !Array.isArray(snake.pts)) continue;
            
            const isMe = snake === mySnake;
            const segments = snake.pts;
            
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                if (!segment || typeof segment.xx !== 'number' || typeof segment.yy !== 'number' ||
                    isNaN(segment.xx) || isNaN(segment.yy)) continue;
                
                const dx = segment.xx - mySnake.xx;
                const dy = segment.yy - mySnake.yy;
                const u = dx * cos_ang + dy * sin_ang;
                const v = -dx * sin_ang + dy * cos_ang;
                
                const polarIdx = getPolarIndex(u, v, CONFIG.ANGULAR_BINS, CONFIG.RADIAL_BINS,
                                             CONFIG.R_MIN, CONFIG.R_MAX, CONFIG.ALPHA_WARP);
                
                if (polarIdx) {
                    const scale = snake.scl || 1;
                    const weight = scale * 0.3;
                    
                    if (isMe) {
                        splatToGrid(grid, polarIdx[0], polarIdx[1], CONFIG.CH_MY_BODY, weight);
                        mySegments++;
                    } else {
                        splatToGrid(grid, polarIdx[0], polarIdx[1], CONFIG.CH_ENEMY_BODY, weight);
                        enemySegments++;
                        
                        if (i === 0) {
                            splatToGrid(grid, polarIdx[0], polarIdx[1], CONFIG.CH_ENEMY_HEADS, weight * 2);
                            enemyHeads++;
                        }
                    }
                }
            }
        }
        
        return { enemySegments, mySegments, enemyHeads };
    }
    
    function normalizeGrid(grid, emaChannels) {
        for (let i = 0; i < grid.length; i++) {
            emaChannels[i] = CONFIG.EMA_BETA * emaChannels[i] + (1 - CONFIG.EMA_BETA) * grid[i];
            if (emaChannels[i] > 0) {
                grid[i] = Math.min(1.0, grid[i] / (CONFIG.SATURATION_FACTOR * emaChannels[i]));
            }
        }
    }
    
    function capturePlayerInput(mySnake) {
        const mouse = getMousePosition();
        const centerX = mouse.screenWidth / 2;
        const centerY = mouse.screenHeight / 2;
        const dx = (mouse.x - centerX) / centerX;
        const dy = (mouse.y - centerY) / centerY;
        
        const cos_ang = Math.cos(mySnake.ang);
        const sin_ang = Math.sin(mySnake.ang);
        const mx = dx * cos_ang + dy * sin_ang;
        const my = -dx * sin_ang + dy * cos_ang;
        const norm = Math.max(1.0, Math.hypot(mx, my));
        
        return {
            mx: mx / norm,
            my: my / norm,
            boost: samplingState.isBoosting ? 1 : 0
        };
    }
    
    function sampleGameState() {
        if (!samplingState.isCollecting) {
            if (CONFIG.DEBUG_LOG) console.log('[Slither Injected] Not collecting, skipping sample');
            return;
        }
        
        const now = performance.now();
        const deltaTime = (now - samplingState.lastSampleTime) / 1000.0;
        gameState.frameCount++;
        
        if (CONFIG.DEBUG_LOG && gameState.frameCount % 50 === 1) {
            console.log('[Slither Injected] Sample attempt', gameState.frameCount);
        }
        
        try {
            const mySnake = getMySnake();
            if (!mySnake) {
                if (CONFIG.DEBUG_LOG) console.log('[Slither Injected] No snake found');
                return;
            }
            
            if (!mySnake.xx || !mySnake.yy) {
                if (CONFIG.DEBUG_LOG) console.log('[Slither Injected] Snake has no position');
                return;
            }
            
            if (CONFIG.DEBUG_LOG && gameState.frameCount % 50 === 1) {
                console.log('[Slither Injected] Snake found at', mySnake.xx, mySnake.yy);
            }
            
            const currentPos = { x: mySnake.xx, y: mySnake.yy };
            const velocity = samplingState.previousPosition && deltaTime > 0 ? 
                Math.hypot(currentPos.x - samplingState.previousPosition.x, 
                          currentPos.y - samplingState.previousPosition.y) / deltaTime : 0;
            samplingState.previousPosition = currentPos;
            
            const gameRadius = gameState.gameRadius || 21600;
            const centerX = gameRadius, centerY = gameRadius;
            const distanceToCenter = Math.hypot(mySnake.xx - centerX, mySnake.yy - centerY);
            const distanceToBorder = Math.max(0, gameRadius - distanceToCenter);
            
            const grid = createPolarGrid();
            let foodCount = 0, snakeData = { enemySegments: 0, mySegments: 0, enemyHeads: 0 };
            
            try {
                foodCount = populateGridWithFood(grid, mySnake);
                snakeData = populateGridWithSnakes(grid, mySnake);
            } catch (error) {
                if (CONFIG.DEBUG_LOG) console.log('[Slither Injected] Grid population error:', error);
                gameState.errors++;
                return;
            }
            
            normalizeGrid(grid, samplingState.emaChannels);
            const playerInput = capturePlayerInput(mySnake);
            
            if (CONFIG.DEBUG_LOG && gameState.frameCount % 50 === 1) {
                console.log('[Slither Injected] Sending data package, foods:', foodCount, 'snakes:', snakeData);
            }
            
            const dataPackage = {
                timestamp: now,
                sessionId: gameState.sessionId,
                frameIndex: gameState.frameCount,
                deltaTime: deltaTime,
                username: CONFIG.USERNAME,
                
                grid: Array.from(grid),
                gridMeta: {
                    angularBins: CONFIG.ANGULAR_BINS,
                    radialBins: CONFIG.RADIAL_BINS,
                    channels: CONFIG.CHANNELS,
                    rMin: CONFIG.R_MIN,
                    rMax: CONFIG.R_MAX,
                    alphaWarp: CONFIG.ALPHA_WARP
                },
                
                metadata: {
                    heading: mySnake.ang,
                    headingSin: Math.sin(mySnake.ang),
                    headingCos: Math.cos(mySnake.ang),
                    velocity: velocity,
                    boost: samplingState.isBoosting,
                    distanceToBorder: distanceToBorder,
                    gameRadius: gameRadius,
                    snakeLength: mySnake.pts ? mySnake.pts.length : 0
                },
                
                playerInput: playerInput,
                
                validation: {
                    hasSnake: true,
                    hasGlobals: !!(window.snakes && window.foods),
                    hasWebSocket: !!(window.ws && window.ws.readyState === 1),
                    hasInput: true
                },
                
                debug: {
                    foodCount: foodCount,
                    enemySegments: snakeData.enemySegments,
                    mySegments: snakeData.mySegments,
                    enemyHeads: snakeData.enemyHeads
                }
            };
            
            // Send to content script
            window.postMessage({
                type: 'SLITHER_DATA_FRAME',
                frame: dataPackage
            }, '*');
            
            gameState.validFrames++;
            samplingState.lastSampleTime = now;
            
        } catch (error) {
            gameState.errors++;
            window.postMessage({
                type: 'SLITHER_ERROR',
                error: { message: error.message, stack: error.stack }
            }, '*');
        }
    }
    
    function sendDataToBackend(frame) {
        fetch(CONFIG.BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(frame)
        }).catch(error => {
            gameState.errors++;
            if (CONFIG.DEBUG_LOG) {
                console.error('[Slither Injected] Backend error:', error);
            }
        });
    }
    
    function startCollection() {
        if (samplingState.isCollecting) return;
        
        samplingState.isCollecting = true;
        gameState.sessionId = Date.now().toString();
        samplingState.emaChannels = new Float32Array(CONFIG.ANGULAR_BINS * CONFIG.RADIAL_BINS * CONFIG.CHANNELS);
        
        samplingState.samplingInterval = setInterval(sampleGameState, 1000 / CONFIG.SAMPLE_RATE_HZ);
        
        window.postMessage({
            type: 'SLITHER_STATUS',
            status: { collecting: true, sessionId: gameState.sessionId }
        }, '*');
        
        if (CONFIG.DEBUG_LOG) {
            console.log('[Slither Injected] Collection started, session:', gameState.sessionId);
        }
    }
    
    function stopCollection() {
        if (!samplingState.isCollecting) return;
        
        samplingState.isCollecting = false;
        if (samplingState.samplingInterval) {
            clearInterval(samplingState.samplingInterval);
            samplingState.samplingInterval = null;
        }
        
        window.postMessage({
            type: 'SLITHER_STATUS',
            status: { collecting: false }
        }, '*');
        
        if (CONFIG.DEBUG_LOG) {
            console.log('[Slither Injected] Collection stopped');
        }
    }
    
    function checkGameState() {
        const wasActive = gameState.isActive;
        gameState.isActive = !!(window.ws && window.ws.readyState === 1 && getMySnake());
        
        if (gameState.isActive && !wasActive) {
            // Game just became active
            window.postMessage({
                type: 'SLITHER_GAME_STATE',
                gameState: { isActive: true, gameRadius: gameState.gameRadius }
            }, '*');
        }
    }
    
    // Message listeners
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        
        switch (event.data.type) {
            case 'SLITHER_CONFIG':
                CONFIG = { ...CONFIG, ...event.data.config };
                if (CONFIG.DEBUG_LOG) {
                    console.log('[Slither Injected] Config updated:', CONFIG);
                    console.log('[Slither Injected] USERNAME in config:', CONFIG.USERNAME);
                }
                break;
                
            case 'SLITHER_CONFIG_UPDATE':
                CONFIG = { ...CONFIG, ...event.data.config };
                break;
                
            case 'SLITHER_START_COLLECTION':
                startCollection();
                break;
                
            case 'SLITHER_STOP_COLLECTION':
                stopCollection();
                break;
                
            case 'SLITHER_BOOST_CHANGE':
                samplingState.isBoosting = event.data.boosting;
                break;
                
            case 'SLITHER_SEND_DATA':
                sendDataToBackend(event.data.frame);
                break;
                
            case 'SLITHER_REQUEST_STATUS':
                window.postMessage({
                    type: 'SLITHER_GAME_STATE',
                    gameState: {
                        isActive: gameState.isActive,
                        sessionId: gameState.sessionId,
                        frameCount: gameState.frameCount,
                        validFrames: gameState.validFrames,
                        errors: gameState.errors
                    }
                }, '*');
                break;
        }
    });
    
    // Start monitoring game state
    setInterval(checkGameState, 1000);
    
    if (CONFIG.DEBUG_LOG) {
        console.log('[Slither Injected] Script loaded and ready');
    }
})();