// ==UserScript==
// @name         Slither.io ESN Data Collector
// @namespace    https://github.com/NickP005/slitherio-scraper
// @version      2.0.0
// @description  Collects Slither.io game state data for Echo State Network training using polar multi-resolution grids
// @author       NickP005 (https://github.com/NickP005)
// @homepage     https://github.com/NickP005/slitherio-scraper
// @supportURL   https://github.com/NickP005/slitherio-scraper/issues
// @license      GPL-3.0
// @match        *://slither.io/*
// @match        *://slither.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @updateURL    https://github.com/NickP005/slitherio-scraper/raw/main/slither-data-collector.user.js
// @downloadURL  https://github.com/NickP005/slitherio-scraper/raw/main/slither-data-collector.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================
    // CONFIGURATION - Fetched from server
    // ===========================================
    let CONFIG = {
        // Default fallback values (will be replaced by server config)
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
        STATS_INTERVAL: 100,

        // Client-specific settings
        CHANNELS: 4,
        CH_FOOD: 0,
        CH_ENEMY_BODY: 1,
        CH_MY_BODY: 2,
        CH_ENEMY_HEADS: 3,
        
        // Backend
        BACKEND_URL: 'http://127.0.0.1:5055/ingest',
        CONFIG_URL: 'http://127.0.0.1:5055/config',
        
        // Username (modify this!)
        USERNAME: 'YourUsername'
    };

    // ===========================================
    // CONFIGURATION FETCHING
    // ===========================================
    async function fetchServerConfig() {
        try {
            const response = await fetch(CONFIG.CONFIG_URL);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            if (data.status === 'ok' && data.config) {
                // Merge server config with client config
                const serverConfig = data.config;
                Object.assign(CONFIG, serverConfig);
                
                // Reinitialize EMA array with new dimensions
                samplingState.emaChannels = new Float32Array(
                    CONFIG.ANGULAR_BINS * CONFIG.RADIAL_BINS * CONFIG.CHANNELS
                );
                
                log('INFO', 'Configuration loaded from server', {
                    angularBins: CONFIG.ANGULAR_BINS,
                    radialBins: CONFIG.RADIAL_BINS,
                    alphaWarp: CONFIG.ALPHA_WARP,
                    sampleRate: CONFIG.SAMPLE_RATE_HZ
                });
                
                return true;
            }
        } catch (error) {
            log('WARN', 'Failed to fetch server config, using defaults', error.message);
        }
        return false;
    }

    // ===========================================
    // STATE VARIABLES
    // ===========================================
    let gameState = {
        gameRadius: null,
        isActive: false,
        sessionId: null,
        frameCount: 0,
        validFrames: 0,
        errors: 0,
        configLoaded: false
    };

    let samplingState = {
        lastSampleTime: 0,
        previousPosition: null,
        emaChannels: new Float32Array(CONFIG.ANGULAR_BINS * CONFIG.RADIAL_BINS * CONFIG.CHANNELS),
        isBoosting: false,
        mousePos: { x: 0, y: 0 }
    };

    // ===========================================
    // LOGGING UTILITIES
    // ===========================================
    function log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const prefix = `[SLITHER-ESN][${level}][${timestamp}]`;

        // Always log to console regardless of DEBUG_LOG setting
        if (data) {
            console.log(`${prefix} ${message}`, data);
        } else {
            console.log(`${prefix} ${message}`);
        }

        // Also log via GM_log if available
        try {
            if (data) {
                GM_log(`${prefix} ${message} ${JSON.stringify(data)}`);
            } else {
                GM_log(`${prefix} ${message}`);
            }
        } catch (e) {
            console.log(`${prefix} GM_log not available:`, e);
        }
    }

    function logStats() {
        log('INFO', 'Session Statistics', {
            sessionId: gameState.sessionId,
            frameCount: gameState.frameCount,
            validFrames: gameState.validFrames,
            errors: gameState.errors,
            validRate: gameState.frameCount > 0 ? (gameState.validFrames / gameState.frameCount * 100).toFixed(2) + '%' : '0%',
            gameRadius: gameState.gameRadius,
            isActive: gameState.isActive
        });
    }

    // ===========================================
    // WEBSOCKET INTERCEPTION
    // ===========================================
    function interceptWebSocket() {
        const OriginalWebSocket = window.WebSocket;

        window.WebSocket = function(url, protocols) {
            log('INFO', 'WebSocket connection detected', { url });

            const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

            ws.addEventListener('message', (event) => {
                if (!event.data || !event.data.arrayBuffer) return;

                event.data.arrayBuffer().then(buffer => {
                    parseWebSocketMessage(buffer);
                }).catch(err => {
                    log('ERROR', 'WebSocket message parsing failed', { error: err.message });
                    gameState.errors++;
                });
            });

            ws.addEventListener('open', () => {
                log('INFO', 'WebSocket connection opened');
                gameState.isActive = true;
                if (!gameState.sessionId) {
                    gameState.sessionId = Date.now().toString();
                    log('INFO', 'New session started', { sessionId: gameState.sessionId });
                }
            });

            ws.addEventListener('close', () => {
                log('INFO', 'WebSocket connection closed');
                gameState.isActive = false;
            });

            return ws;
        };

        Object.defineProperty(window.WebSocket, 'prototype', {
            value: OriginalWebSocket.prototype
        });

        log('INFO', 'WebSocket interception installed');
    }

    function parseWebSocketMessage(buffer) {
        try {
            const view = new DataView(buffer);

            if (view.byteLength < 3) return;

            const messageType = view.getUint8(2);

            // Packet 'a' (0x61) - Initial setup with game radius
            if (messageType === 0x61 && view.byteLength >= 7 && gameState.gameRadius === null) {
                const b3 = view.getUint8(3);
                const b4 = view.getUint8(4);
                const b5 = view.getUint8(5);
                gameState.gameRadius = (b3 << 16) | (b4 << 8) | b5;

                log('INFO', 'Game radius detected from handshake', {
                    gameRadius: gameState.gameRadius
                });
            }

        } catch (err) {
            log('ERROR', 'WebSocket message parsing error', { error: err.message });
            gameState.errors++;
        }
    }

    // ===========================================
    // POLAR GRID MATHEMATICS
    // ===========================================
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

    // ===========================================
    // GAME DATA EXTRACTION
    // ===========================================

    // Use unsafeWindow to access the real page context
    const gameWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    function getMySnake() {
        return gameWindow.slither || gameWindow.snake || null;
    }

    function getAllSnakes() {
        return gameWindow.slithers || gameWindow.snakes || [];
    }

    function getAllFood() {
        return gameWindow.foods || [];
    }

    function getMousePosition() {
        return {
            x: gameWindow.xm || 0,
            y: gameWindow.ym || 0,
            screenWidth: gameWindow.ww || 800,
            screenHeight: gameWindow.hh || 600
        };
    }

    function calculateVelocity(currentPos, previousPos, deltaTime) {
        if (!previousPos || deltaTime <= 0) return 0;

        const dx = currentPos.x - previousPos.x;
        const dy = currentPos.y - previousPos.y;
        return Math.hypot(dx, dy) / deltaTime;
    }

    function calculateDistanceToBorder(snake, gameRadius) {
        if (!gameRadius || !snake) return 0;

        const centerX = gameRadius;
        const centerY = gameRadius;
        const distanceToCenter = Math.hypot(snake.xx - centerX, snake.yy - centerY);
        return Math.max(0, gameRadius - distanceToCenter);
    }

    // ===========================================
    // GRID POPULATION
    // ===========================================
    function populateGridWithFood(grid, mySnake) {
        const foods = getAllFood();
        if (!foods || !Array.isArray(foods)) {
            return 0;
        }
        
        const cos_ang = Math.cos(mySnake.ang);
        const sin_ang = Math.sin(mySnake.ang);

        let foodCount = 0;

        for (const food of foods) {
            // Skip null/undefined food items or items without proper coordinates
            if (!food || 
                typeof food.xx !== 'number' || 
                typeof food.yy !== 'number' ||
                isNaN(food.xx) || 
                isNaN(food.yy)) {
                continue;
            }

            const dx = food.xx - mySnake.xx;
            const dy = food.yy - mySnake.yy;

            // Transform to local coordinates aligned with snake direction
            const u = dx * cos_ang + dy * sin_ang;    // forward
            const v = -dx * sin_ang + dy * cos_ang;   // left-right

            const polarIdx = getPolarIndex(u, v, CONFIG.ANGULAR_BINS, CONFIG.RADIAL_BINS,
                                         CONFIG.R_MIN, CONFIG.R_MAX, CONFIG.ALPHA_WARP);

            if (polarIdx) {
                const weight = (food.sz || 1) * 0.1; // Scale by food size
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

        let enemySegments = 0;
        let mySegments = 0;
        let enemyHeads = 0;

        for (const snake of snakes) {
            // Skip null/undefined snakes or snakes without segments
            if (!snake || !snake.pts || !Array.isArray(snake.pts)) {
                continue;
            }

            const isMe = snake === mySnake;
            const segments = snake.pts;

            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];

                // Skip null/undefined segments or segments without proper coordinates
                if (!segment || 
                    typeof segment.xx !== 'number' || 
                    typeof segment.yy !== 'number' ||
                    isNaN(segment.xx) || 
                    isNaN(segment.yy)) {
                    continue;
                }

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

                        // Mark enemy heads with higher weight in separate channel
                        if (i === 0) { // First segment is head
                            splatToGrid(grid, polarIdx[0], polarIdx[1], CONFIG.CH_ENEMY_HEADS, weight * 2);
                            enemyHeads++;
                        }
                    }
                }
            }
        }

        return { enemySegments, mySegments, enemyHeads };
    }

    // ===========================================
    // NORMALIZATION
    // ===========================================
    function normalizeGrid(grid, emaChannels) {
        for (let i = 0; i < grid.length; i++) {
            // Update EMA
            emaChannels[i] = CONFIG.EMA_BETA * emaChannels[i] + (1 - CONFIG.EMA_BETA) * grid[i];

            // Normalize with saturation
            if (emaChannels[i] > 0) {
                grid[i] = Math.min(1.0, grid[i] / (CONFIG.SATURATION_FACTOR * emaChannels[i]));
            }
        }
    }

    // ===========================================
    // INPUT CAPTURE
    // ===========================================
    function capturePlayerInput(mySnake) {
        const mouse = getMousePosition();

        // Convert mouse to normalized screen coordinates [-1, 1]
        const centerX = mouse.screenWidth / 2;
        const centerY = mouse.screenHeight / 2;
        const dx = (mouse.x - centerX) / centerX;
        const dy = (mouse.y - centerY) / centerY;

        // Transform to local coordinates aligned with snake
        const cos_ang = Math.cos(mySnake.ang);
        const sin_ang = Math.sin(mySnake.ang);

        const mx = dx * cos_ang + dy * sin_ang;   // forward component
        const my = -dx * sin_ang + dy * cos_ang;  // left-right component

        // Clamp to [-1, 1]
        const norm = Math.max(1.0, Math.hypot(mx, my));

        return {
            mx: mx / norm,
            my: my / norm,
            boost: samplingState.isBoosting ? 1 : 0
        };
    }

    // ===========================================
    // DATA SAMPLING
    // ===========================================
    function sampleGameState() {
        const now = performance.now();
        const deltaTime = (now - samplingState.lastSampleTime) / 1000.0; // Convert to seconds

        gameState.frameCount++;

        // Enhanced debugging for first few frames
        if (gameState.frameCount <= 5) {
            console.log(`[SLITHER-ESN] Sample #${gameState.frameCount} - Checking game state...`);
            console.log('[SLITHER-ESN] window.slither:', window.slither);
            console.log('[SLITHER-ESN] window.slithers:', window.slithers);
            console.log('[SLITHER-ESN] window.foods:', window.foods ? window.foods.length : 'null/undefined');
        }

        // Check if game has started (WebSocket connected)
        if (!gameState.isActive && gameWindow.ws && gameWindow.ws.readyState === 1) {
            gameState.isActive = true;
            if (!gameState.sessionId) {
                gameState.sessionId = Date.now().toString();
                log('INFO', 'Game session started - WebSocket connected', {
                    sessionId: gameState.sessionId,
                    wsUrl: gameWindow.ws.url
                });
            }
        }

        try {
            const mySnake = getMySnake();
            if (!mySnake || !mySnake.xx || !mySnake.yy) {
                if (gameState.frameCount <= 10 || gameState.frameCount % 50 === 0) {
                    log('DEBUG', 'No valid snake data available', {
                        frameCount: gameState.frameCount,
                        mySnake: mySnake ? 'exists but no position' : 'null/undefined',
                        hasPosition: mySnake ? !!(mySnake.xx && mySnake.yy) : false,
                        wsConnected: gameWindow.ws ? gameWindow.ws.readyState === 1 : false,
                        foodsCount: gameWindow.foods ? gameWindow.foods.length : 0,
                        slithersCount: gameWindow.slithers ? gameWindow.slithers.length : 0
                    });
                }
                return;
            }

            // First valid frame - log success
            if (gameState.validFrames === 0) {
                log('INFO', 'First valid frame detected!', {
                    mySnake: {
                        xx: mySnake.xx,
                        yy: mySnake.yy,
                        ang: mySnake.ang
                    },
                    foodsCount: gameWindow.foods ? gameWindow.foods.length : 0,
                    slithersCount: gameWindow.slithers ? gameWindow.slithers.length : 0
                });
            }

            // Calculate velocity
            const currentPos = { x: mySnake.xx, y: mySnake.yy };
            const velocity = calculateVelocity(currentPos, samplingState.previousPosition, deltaTime);
            samplingState.previousPosition = currentPos;

            // Calculate metadata
            const gameRadius = gameState.gameRadius || 21600; // Fallback value
            const distanceToBorder = calculateDistanceToBorder(mySnake, gameRadius);

            // Create and populate grid
            const grid = createPolarGrid();
            let foodCount = 0;
            let snakeData = { enemySegments: 0, mySegments: 0, enemyHeads: 0 };
            
            try {
                foodCount = populateGridWithFood(grid, mySnake);
            } catch (error) {
                log('ERROR', 'Error populating food grid', { error: error.message });
                gameState.errors++;
            }
            
            try {
                snakeData = populateGridWithSnakes(grid, mySnake);
            } catch (error) {
                log('ERROR', 'Error populating snake grid', { error: error.message });
                gameState.errors++;
            }

            // Normalize grid
            normalizeGrid(grid, samplingState.emaChannels);

            // Capture player input
            const playerInput = capturePlayerInput(mySnake);

            // Create data package
            const dataPackage = {
                timestamp: now,
                sessionId: gameState.sessionId,
                frameIndex: gameState.frameCount,
                deltaTime: deltaTime,

                // Grid data
                grid: Array.from(grid),
                gridMeta: {
                    angularBins: CONFIG.ANGULAR_BINS,
                    radialBins: CONFIG.RADIAL_BINS,
                    channels: CONFIG.CHANNELS,
                    rMin: CONFIG.R_MIN,
                    rMax: CONFIG.R_MAX,
                    alphaWarp: CONFIG.ALPHA_WARP
                },

                // Scalar metadata
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

                // Player input (ESN target)
                playerInput: playerInput,

                // Validation flags
                validation: {
                    hasSnake: true,
                    hasGlobals: !!(window.snakes && window.foods),
                    hasWebSocket: gameState.isActive,
                    hasInput: true
                },

                // Debug info
                debug: {
                    foodCount: foodCount,
                    enemySegments: snakeData.enemySegments,
                    mySegments: snakeData.mySegments,
                    enemyHeads: snakeData.enemyHeads
                }
            };

            // Send to backend
            sendDataToBackend(dataPackage);

            gameState.validFrames++;
            samplingState.lastSampleTime = now;

        } catch (error) {
            log('ERROR', 'Error during sampling', { error: error.message, stack: error.stack });
            gameState.errors++;
        }
    }

    // ===========================================
    // BACKEND COMMUNICATION
    // ===========================================
    function sendDataToBackend(data) {
        // Add username to the data package
        data.username = CONFIG.USERNAME;
        
        if (gameState.frameCount <= 5) {
            console.log('[SLITHER-ESN] Attempting to send data to backend...', CONFIG.BACKEND_URL);
        }

        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.BACKEND_URL,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(data),
                onload: function(response) {
                    if (gameState.frameCount <= 5) {
                        console.log('[SLITHER-ESN] Backend response received:', response.status);
                    }
                    if (response.status !== 200) {
                        log('ERROR', 'Backend communication failed', {
                            status: response.status,
                            response: response.responseText
                        });
                        gameState.errors++;
                    } else {
                        if (gameState.frameCount <= 5 || gameState.frameCount % 100 === 0) {
                            log('DEBUG', 'Data sent successfully to backend', {
                                frameCount: gameState.frameCount,
                                status: response.status
                            });
                        }
                    }
                },
                onerror: function(error) {
                    console.log('[SLITHER-ESN] Backend request error:', error);
                    log('ERROR', 'Backend request error', { error: error });
                    gameState.errors++;
                },
                ontimeout: function() {
                    console.log('[SLITHER-ESN] Backend request timeout');
                    log('ERROR', 'Backend request timeout');
                    gameState.errors++;
                },
                timeout: 5000  // 5 second timeout (increased from 1 second)
            });
        } catch (error) {
            console.error('[SLITHER-ESN] GM_xmlhttpRequest error:', error);
            log('ERROR', 'Failed to create backend request', { error: error.message });
            gameState.errors++;
        }
    }

    // ===========================================
    // EVENT HANDLERS
    // ===========================================
    function setupEventHandlers() {
        // Mouse events for boost detection
        document.addEventListener('mousedown', (event) => {
            if (event.button === 0) { // Left mouse button
                samplingState.isBoosting = true;
                log('DEBUG', 'Boost started');
            }
        });

        document.addEventListener('mouseup', (event) => {
            if (event.button === 0) {
                samplingState.isBoosting = false;
                log('DEBUG', 'Boost ended');
            }
        });

        // Track mouse movement
        document.addEventListener('mousemove', (event) => {
            samplingState.mousePos.x = event.clientX;
            samplingState.mousePos.y = event.clientY;
        });

        // Keyboard events for boost (space key alternative)
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Space') {
                event.preventDefault();
                samplingState.isBoosting = true;
            }
        });

        document.addEventListener('keyup', (event) => {
            if (event.code === 'Space') {
                event.preventDefault();
                samplingState.isBoosting = false;
            }
        });

        log('INFO', 'Event handlers installed');
    }

    // ===========================================
    // GAME VARIABLES POLLING
    // ===========================================
    function waitForGameVariables() {
        console.log('[SLITHER-ESN] Waiting for game variables to load...');

        let attempts = 0;
        const maxAttempts = 300; // 30 seconds max

        const checkInterval = setInterval(() => {
            attempts++;

            // Check if any game variables exist using gameWindow
            const hasAnyGameVar = !!(gameWindow.slither || gameWindow.slithers || gameWindow.foods || gameWindow.snake || gameWindow.snakes);

            console.log(`[SLITHER-ESN] Attempt ${attempts}: checking for game variables...`);
            console.log('  gameWindow.slither:', !!gameWindow.slither);
            console.log('  gameWindow.slithers:', !!gameWindow.slithers);
            console.log('  gameWindow.foods:', !!gameWindow.foods);
            console.log('  gameWindow.snake:', !!gameWindow.snake);
            console.log('  gameWindow.snakes:', !!gameWindow.snakes);

            if (hasAnyGameVar) {
                clearInterval(checkInterval);
                log('INFO', 'Game variables detected! Starting data collection...', {
                    attempt: attempts,
                    foundVariables: {
                        slither: !!gameWindow.slither,
                        slithers: !!gameWindow.slithers,
                        foods: !!gameWindow.foods,
                        snake: !!gameWindow.snake,
                        snakes: !!gameWindow.snakes
                    }
                });
                startDataCollection();
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                log('ERROR', 'Timeout waiting for game variables. Game may not be started.', {
                    totalAttempts: attempts
                });
                return;
            }

            // Log every 50 attempts (5 seconds)
            if (attempts % 50 === 0) {
                console.log(`[SLITHER-ESN] Still waiting... (${attempts}/${maxAttempts})`);
            }
        }, 100); // Check every 100ms
    }

    function startDataCollection() {
        console.log('[SLITHER-ESN] Starting data collection timers...');

        // Start sampling timer
        const samplingInterval = setInterval(sampleGameState, 1000 / CONFIG.SAMPLE_RATE_HZ);
        console.log('[SLITHER-ESN] Sampling interval ID:', samplingInterval);

        // Start stats logging
        const statsInterval = setInterval(logStats, CONFIG.LOG_INTERVAL_MS);
        console.log('[SLITHER-ESN] Stats interval ID:', statsInterval);

        log('INFO', 'Data collection started successfully');
    }

    // ===========================================
    // INITIALIZATION
    // ===========================================
    async function initialize() {
        console.log('[SLITHER-ESN] INITIALIZE function called');

        try {
            // First, try to fetch server configuration
            log('INFO', 'Fetching server configuration...');
            gameState.configLoaded = await fetchServerConfig();
            
            log('INFO', 'Slither.io ESN Data Collector starting', {
                version: '2.0.0',
                configLoaded: gameState.configLoaded,
                username: CONFIG.USERNAME,
                config: {
                    angularBins: CONFIG.ANGULAR_BINS,
                    radialBins: CONFIG.RADIAL_BINS,
                    sampleRate: CONFIG.SAMPLE_RATE_HZ
                }
            });

            // Test basic functionality first
            console.log('[SLITHER-ESN] Testing basic objects...');
            console.log('[SLITHER-ESN] window.WebSocket available:', !!window.WebSocket);
            console.log('[SLITHER-ESN] setTimeout available:', !!window.setTimeout);
            console.log('[SLITHER-ESN] setInterval available:', !!window.setInterval);

            // Install WebSocket interception
            console.log('[SLITHER-ESN] Installing WebSocket interception...');
            interceptWebSocket();

            // Setup event handlers
            console.log('[SLITHER-ESN] Setting up event handlers...');
            setupEventHandlers();

            // Wait for game variables before starting data collection
            console.log('[SLITHER-ESN] Setting up game variables polling...');
            waitForGameVariables();

            log('INFO', 'Initialization complete - waiting for game to start');
            console.log('[SLITHER-ESN] INITIALIZATION COMPLETED SUCCESSFULLY');

        } catch (error) {
            console.error('[SLITHER-ESN] INITIALIZATION ERROR:', error);
            console.error('[SLITHER-ESN] Error stack:', error.stack);
        }
    }

    // ===========================================
    // STARTUP
    // ===========================================

    // Immediate startup log to verify script is loading
    console.log('[SLITHER-ESN] Script is loading...');
    console.log('[SLITHER-ESN] Current URL:', window.location.href);
    console.log('[SLITHER-ESN] Document ready state:', document.readyState);
    console.log('[SLITHER-ESN] Tampermonkey functions available:', {
        GM_xmlhttpRequest: typeof GM_xmlhttpRequest,
        GM_log: typeof GM_log
    });

    // Test if we can access basic DOM elements
    console.log('[SLITHER-ESN] Document:', !!document);
    console.log('[SLITHER-ESN] Window:', !!window);

    if (document.readyState === 'loading') {
        console.log('[SLITHER-ESN] Waiting for DOMContentLoaded...');
        document.addEventListener('DOMContentLoaded', function() {
            console.log('[SLITHER-ESN] DOMContentLoaded fired, initializing...');
            initialize();
        });
    } else {
        console.log('[SLITHER-ESN] DOM already ready, initializing immediately...');
        initialize();
    }

})();