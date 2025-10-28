// ============================================================
// SLITHER.IO - TROVA VARIABILI KILLS/PREY
// ============================================================
// Esegui questo codice nella console di Chrome mentre giochi
// per trovare dove il gioco memorizza kills, prey, e score

console.log('🔍 SEARCHING FOR KILLS/PREY VARIABLES...\n');

// Test 1: Cerca nell'oggetto window
console.log('═══════════════════════════════════════════════════════');
console.log('📦 TEST 1: Window Global Variables');
console.log('═══════════════════════════════════════════════════════');

const killKeywords = ['kill', 'prey', 'victim', 'frag', 'death', 'collision'];
const scoreKeywords = ['score', 'point', 'rank', 'length', 'size'];

let foundVars = [];

for (let key in window) {
    const lowerKey = key.toLowerCase();
    
    // Cerca kills/prey
    if (killKeywords.some(k => lowerKey.includes(k))) {
        try {
            const value = window[key];
            if (typeof value !== 'function' && value !== undefined) {
                foundVars.push({type: 'kill', key, value});
                console.log(`✓ ${key} = ${JSON.stringify(value)}`);
            }
        } catch(e) {}
    }
    
    // Cerca score
    if (scoreKeywords.some(k => lowerKey.includes(k))) {
        try {
            const value = window[key];
            if (typeof value === 'number') {
                foundVars.push({type: 'score', key, value});
                console.log(`✓ ${key} = ${value}`);
            }
        } catch(e) {}
    }
}

// Test 2: Cerca nel tuo snake
console.log('\n═══════════════════════════════════════════════════════');
console.log('🐍 TEST 2: My Snake Object Properties');
console.log('═══════════════════════════════════════════════════════');

const mySnake = window.slither || window.snake;
if (mySnake) {
    console.log('Snake found! Analyzing properties...\n');
    
    for (let key in mySnake) {
        const lowerKey = key.toLowerCase();
        
        if (killKeywords.some(k => lowerKey.includes(k)) || 
            scoreKeywords.some(k => lowerKey.includes(k))) {
            try {
                const value = mySnake[key];
                if (typeof value !== 'function') {
                    console.log(`✓ snake.${key} = ${JSON.stringify(value)}`);
                    foundVars.push({type: 'snake', key, value});
                }
            } catch(e) {}
        }
    }
    
    // Mostra tutte le proprietà numeriche
    console.log('\n📊 All numeric properties:');
    for (let key in mySnake) {
        try {
            const value = mySnake[key];
            if (typeof value === 'number' && !key.startsWith('_')) {
                console.log(`   ${key}: ${value}`);
            }
        } catch(e) {}
    }
} else {
    console.log('❌ Snake not found. Are you in game?');
}

// Test 3: Cerca variabili globali comuni di slither.io
console.log('\n═══════════════════════════════════════════════════════');
console.log('🎮 TEST 3: Known Slither.io Variables');
console.log('═══════════════════════════════════════════════════════');

const knownVars = [
    'snake_count', 'biggest_snake_count', 'kills', 'prey',
    'fpsls', 'fps', 'lbf', 'rank', 'best_rank',
    'score', 'high_score', 'snake_length',
    'snl', // snake length
    'fmlts', 'fpsls', // food multipliers
    'lbh', 'lbs', 'lbn', 'lbp', 'lbr', // leaderboard
];

knownVars.forEach(varName => {
    if (window[varName] !== undefined) {
        console.log(`✓ ${varName} = ${window[varName]}`);
        foundVars.push({type: 'known', key: varName, value: window[varName]});
    }
});

// Test 4: Cerca negli array globali
console.log('\n═══════════════════════════════════════════════════════');
console.log('📋 TEST 4: Global Arrays (snakes, foods)');
console.log('═══════════════════════════════════════════════════════');

const allSnakes = window.slithers || window.snakes || [];
const allFoods = window.foods || [];

console.log(`Total snakes: ${allSnakes.length}`);
console.log(`Total foods: ${allFoods.length}`);

if (allSnakes.length > 0) {
    console.log('\n🐍 Sample snake properties (first snake):');
    const sampleSnake = allSnakes[0];
    const numericProps = [];
    
    for (let key in sampleSnake) {
        try {
            const value = sampleSnake[key];
            if (typeof value === 'number' && !key.startsWith('_')) {
                numericProps.push({key, value});
            }
        } catch(e) {}
    }
    
    numericProps.sort((a, b) => b.value - a.value).slice(0, 10).forEach(p => {
        console.log(`   ${p.key}: ${p.value}`);
    });
}

// Test 5: Cerca nel localStorage/sessionStorage
console.log('\n═══════════════════════════════════════════════════════');
console.log('💾 TEST 5: Storage (localStorage/sessionStorage)');
console.log('═══════════════════════════════════════════════════════');

for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (killKeywords.some(k => key.toLowerCase().includes(k)) ||
        scoreKeywords.some(k => key.toLowerCase().includes(k))) {
        console.log(`✓ localStorage.${key} = ${localStorage.getItem(key)}`);
    }
}

// Test 6: Monitora le modifiche (hook)
console.log('\n═══════════════════════════════════════════════════════');
console.log('👁️  TEST 6: Live Monitoring Setup');
console.log('═══════════════════════════════════════════════════════');

console.log('Setting up monitoring... (will log changes for 10 seconds)');

const monitorLog = [];
let monitorInterval = setInterval(() => {
    const currentState = {
        snakeLength: mySnake ? (mySnake.pts ? mySnake.pts.length : 0) : 0,
        snakesCount: (window.slithers || window.snakes || []).length,
        foodsCount: (window.foods || []).length,
    };
    
    // Cerca variabili che potrebbero cambiare quando uccidi qualcuno
    knownVars.forEach(v => {
        if (window[v] !== undefined) {
            currentState[v] = window[v];
        }
    });
    
    monitorLog.push(currentState);
}, 500);

setTimeout(() => {
    clearInterval(monitorInterval);
    console.log('\n📊 Monitoring stopped. Changes detected:');
    
    if (monitorLog.length > 1) {
        for (let i = 1; i < monitorLog.length; i++) {
            const prev = monitorLog[i-1];
            const curr = monitorLog[i];
            
            for (let key in curr) {
                if (prev[key] !== curr[key]) {
                    console.log(`   ${key}: ${prev[key]} → ${curr[key]}`);
                }
            }
        }
    }
}, 10000);

// Summary
console.log('\n═══════════════════════════════════════════════════════');
console.log('📊 SUMMARY');
console.log('═══════════════════════════════════════════════════════');

console.log(`\nFound ${foundVars.length} potentially relevant variables:\n`);

const byType = {};
foundVars.forEach(v => {
    if (!byType[v.type]) byType[v.type] = [];
    byType[v.type].push(v);
});

for (let type in byType) {
    console.log(`${type.toUpperCase()}:`);
    byType[type].forEach(v => {
        console.log(`  • ${v.key} = ${JSON.stringify(v.value)}`);
    });
    console.log('');
}

console.log('💡 TIP: Try to kill another snake and run this again!');
console.log('💡 Look for variables that increase when you kill someone.');
console.log('\n⏳ Monitoring active for 10 seconds... Try to kill someone now!');
