// ==UserScript==
// @name         🔥 SUPER TEST TAMPERMONKEY 🔥
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Test SUPER SEMPLICE - DEVE FUNZIONARE!
// @author       Test
// @match        https://slither.io/*
// @match        http://slither.io/*
// @match        *://slither.io/*
// @match        https://*.slither.io/*
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    
    // ===== TEST IMMEDIATO =====
    alert('🚀 TAMPERMONKEY FUNZIONA! Script caricato su: ' + window.location.href);
    
    // Aggiungi elemento visuale alla pagina
    const testDiv = document.createElement('div');
    testDiv.innerHTML = '🎯 TAMPERMONKEY ATTIVO!';
    testDiv.style.cssText = `
        position: fixed !important;
        top: 10px !important;
        right: 10px !important;
        background: red !important;
        color: white !important;
        padding: 10px !important;
        font-size: 16px !important;
        font-weight: bold !important;
        z-index: 999999 !important;
        border: 3px solid yellow !important;
        border-radius: 5px !important;
    `;
    document.body.appendChild(testDiv);
    
    // Log nella console
    console.log('�🔥🔥 TAMPERMONKEY TEST SCRIPT FUNZIONA! 🔥🔥🔥');
    console.log('URL:', window.location.href);
    console.log('Timestamp:', new Date().toISOString());
    
    // Rimuovi il div dopo 5 secondi
    setTimeout(() => {
        testDiv.remove();
        console.log('✅ Test completato - elemento rimosso');
    }, 5000);
    
})();