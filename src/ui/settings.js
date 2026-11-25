/**
 * settings.js - Game Settings, Viewport Metrics, Difficulty & POV Orientation
 * Manages 1st-Person vs Compass POV projection, safe areas, AI pacing, and UI dialogues.
 */
import { playSound } from './AudioHaptics.js';
import { I18N, currentLang, applyLanguage } from './i18n.js';
import { updateTopCompassBar } from '../net/network.js';

function getVisualPosition(pIndex) {
    if (mySeat === 99 || tableOrientation === 'COMPASS') return pIndex;
    return (pIndex - mySeat + 4) % 4;
}

function getPlayerAtVisualPosition(posIndex) {
    if (mySeat === 99 || tableOrientation === 'COMPASS') return posIndex;
    return (mySeat + posIndex) % 4;
}

function triggerHaptic(type) {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator) || typeof navigator.vibrate !== 'function') return;
    try {
        if (type === 'turn') {
            // Short, multiple crisp pulse (25ms) when it becomes Your Turn to play or bid
            navigator.vibrate([25, 40, 25]);
        } else if (type === 'pair') {
            // Double-pulse (40ms) when a Royal Pair (K+Q) is declared
            navigator.vibrate([40, 50, 40]);
        } else if (type === 'reveal') {
            // Dramatic heavy vibration (80ms) when the Secret Trump is Revealed
            navigator.vibrate([80, 50, 120]);
        }
    } catch(e) {}
}


// ==================== GAME SETTINGS MODAL LOGIC ====================
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    syncSettingsModalUI();
    modal.style.display = 'flex';
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
}

function syncSettingsModalUI() {
    let t = I18N[currentLang] || I18N.en;
    let isHi = (currentLang === 'hi');

    // Title & labels
    const titleEl = document.getElementById('settings-modal-title');
    if (titleEl) titleEl.innerText = isHi ? 'गेम सेटिंग्स' : 'Game Settings';
    const langBtnText = document.getElementById('settings-lang-btn-text');
    if (langBtnText) langBtnText.innerText = isHi ? '🌐 English में बदलें' : '🌐 Switch to हिन्दी';

    // Difficulty
    const diffPill = document.getElementById('settings-diff-pill');
    if (diffPill) {
        let diffLabel = currentDifficulty === 'easy' ? (isHi ? 'सरल' : 'Easy') : (currentDifficulty === 'hard' ? (isHi ? 'कठिन' : 'Hard') : (isHi ? 'मध्यम' : 'Medium'));
        diffPill.innerText = diffLabel;
        diffPill.style.color = currentDifficulty === 'hard' ? '#f87171' : (currentDifficulty === 'easy' ? '#86efac' : '#fde047');
    }
    ['easy', 'medium', 'hard'].forEach(d => {
        const btn = document.getElementById('s-diff-' + d);
        if (btn) {
            let active = (currentDifficulty === d);
            btn.style.background = active ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
            btn.style.borderColor = active ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
            btn.style.color = active ? 'var(--gold-bright)' : '#94a3b8';
        }
    });

    // Orientation
    const orientPill = document.getElementById('settings-orient-pill');
    if (orientPill) {
        orientPill.innerText = tableOrientation === 'FIRST_PERSON' ? (isHi ? '1st-पर्सन' : '1st-Person') : (isHi ? 'कंपास' : 'Compass');
    }
    const bFirst = document.getElementById('s-orient-first');
    const bCompass = document.getElementById('s-orient-compass');
    if (bFirst && bCompass) {
        let isFirst = (tableOrientation === 'FIRST_PERSON');
        bFirst.style.background = isFirst ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
        bFirst.style.borderColor = isFirst ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
        bFirst.style.color = isFirst ? 'var(--gold-bright)' : '#94a3b8';

        bCompass.style.background = !isFirst ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
        bCompass.style.borderColor = !isFirst ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
        bCompass.style.color = !isFirst ? 'var(--gold-bright)' : '#94a3b8';
    }

    // Speed
    const spdPill = document.getElementById('settings-speed-pill');
    const delayToSpeed = { 2.0: 0.5, 1.33: 0.75, 1.0: 1.0, 0.65: 1.5, 0.5: 2.0, 0.35: 2.0 };
    let curSpd = delayToSpeed[window.GAME_SPEED_MULTIPLIER] || (window.GAME_SPEED_MULTIPLIER ? Math.round((1 / window.GAME_SPEED_MULTIPLIER) * 100) / 100 : 1.0);
    if (spdPill) spdPill.innerText = `${curSpd}x`;
    [0.5, 0.75, 1.0, 1.5, 2.0].forEach(s => {
        let sKey = String(s).replace('.', '');
        if (s === 1.0) sKey = '1';
        if (s === 2.0) sKey = '2';
        const btn = document.getElementById('s-spd-' + sKey);
        if (btn) {
            let active = (Math.abs(curSpd - s) < 0.05);
            btn.style.background = active ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
            btn.style.borderColor = active ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
            btn.style.color = active ? 'var(--gold-bright)' : '#94a3b8';
        }
    });

    // Turn Timer Visibility
    const timerPill = document.getElementById('settings-timer-pill');
    if (timerPill) {
        timerPill.innerText = showTurnTimerSetting ? (isHi ? 'दिखाई दे रहा है' : 'Visible') : (isHi ? 'छिपा हुआ' : 'Hidden');
        timerPill.style.color = showTurnTimerSetting ? '#6ee7b7' : '#94a3b8';
    }
    const bTimerShow = document.getElementById('s-timer-show');
    const bTimerHide = document.getElementById('s-timer-hide');
    if (bTimerShow && bTimerHide) {
        bTimerShow.style.background = showTurnTimerSetting ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
        bTimerShow.style.borderColor = showTurnTimerSetting ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
        bTimerShow.style.color = showTurnTimerSetting ? 'var(--gold-bright)' : '#94a3b8';

        bTimerHide.style.background = !showTurnTimerSetting ? 'rgba(229,193,88,0.2)' : 'rgba(0,0,0,0.4)';
        bTimerHide.style.borderColor = !showTurnTimerSetting ? 'var(--gold-bright)' : 'rgba(255,255,255,0.1)';
        bTimerHide.style.color = !showTurnTimerSetting ? 'var(--gold-bright)' : '#94a3b8';
    }
}

var showTurnTimerSetting = true;
try {
    let saved = localStorage.getItem('twentyEight_showTurnTimer');
    if (saved !== null) {
        showTurnTimerSetting = (saved === 'true');
        if (!showTurnTimerSetting) document.body.classList.add('hide-turn-timer');
    }
} catch(e) {}

function setTimerVisibilityUI(show) {
    showTurnTimerSetting = show;
    try { localStorage.setItem('twentyEight_showTurnTimer', show ? 'true' : 'false'); } catch(e) {}
    if (show) {
        document.body.classList.remove('hide-turn-timer');
    } else {
        document.body.classList.add('hide-turn-timer');
    }
    syncSettingsModalUI();
}

function setDifficultyUI(diff) {
    currentDifficulty = diff;
    try { localStorage.setItem('twentyEight_difficulty', diff); } catch(e) {}
    syncSettingsModalUI();
    if (typeof showGameToast === 'function') {
        showGameToast(`🤖 AI Difficulty: <b>${diff.toUpperCase()}</b>`, 1800);
    }
}

function setOrientationUI(mode) {
    tableOrientation = (mode === 'COMPASS') ? 'COMPASS' : 'FIRST_PERSON';
    try { localStorage.setItem('twentyeight_orientation', tableOrientation); } catch(e) {}
    updateOrientationUI();
    syncSettingsModalUI();
    if (typeof ui !== 'undefined' && ui) {
        ui.updatePlayerNames();
        ui.renderStaticBoard();
        ui.syncTable();
    }
    if (typeof showGameToast === 'function') {
        let label = tableOrientation === 'FIRST_PERSON' ? '1st-Person (You at Bottom)' : 'Fixed Compass';
        showGameToast(`🧭 Table View: <b>${label}</b>`, 1800);
    }
}

function setSpeedUI(speed) {
    const numSpeed = parseFloat(speed) || 1.0;
    const speedToDelay = { 0.5: 2.0, 0.75: 1.33, 1.0: 1.0, 1.5: 0.65, 2.0: 0.5 };
    const delayMult = speedToDelay[numSpeed] || (1 / numSpeed);
    window.GAME_SPEED_MULTIPLIER = delayMult;
    try {
        localStorage.setItem('28_table_speed', delayMult.toString());
        localStorage.setItem('twentyEight_speed', numSpeed.toString());
    } catch(e) {}
    updateTableSpeedUI();
    syncSettingsModalUI();
    if (typeof isHost !== 'undefined' && isHost && typeof gameMode !== 'undefined' && gameMode === 'multi') {
        broadcastNetMessage({ type: 'SPEED_SYNC', speedMultiplier: delayMult });
    }
    if (typeof showGameToast === 'function') {
        showGameToast(`⚡ Pace: <b>${numSpeed}x</b>`, 1800);
    }
}

function toggleTableOrientation() {
    tableOrientation = (tableOrientation === 'FIRST_PERSON') ? 'COMPASS' : 'FIRST_PERSON';
    try {
        localStorage.setItem('twentyeight_orientation', tableOrientation);
    } catch(e) {}
    updateOrientationUI();
    syncSettingsModalUI();
    if (typeof ui !== 'undefined' && ui) {
        ui.updatePlayerNames();
        ui.renderStaticBoard();
        ui.syncTable();
    }
    triggerHaptic('turn');
}

function updateOrientationUI() {
    const btn = document.getElementById('orientation-toggle-btn');
    const label = document.getElementById('orientation-btn-text');
    if (!btn || !label) return;
    let isHi = (typeof currentLang !== 'undefined' && currentLang === 'hi');
    if (tableOrientation === 'FIRST_PERSON') {
        label.innerText = isHi ? '1st-पर्सन' : '1st-Person';
        btn.title = isHi ? 'टेबल दृश्य: 1st-पर्सन (आप नीचे) — क्लिक करके कंपास बदलें' : 'Table View: 1st-Person (You at Bottom) — Click for Fixed Compass';
    } else {
        label.innerText = isHi ? 'कंपास' : 'Compass';
        btn.title = isHi ? 'टेबल दृश्य: कंपास (स्थिर दिशाएँ) — क्लिक करके 1st-पर्सन बदलें' : 'Table View: Fixed Compass (S/E/N/W) — Click for 1st-Person View';
    }
}


// ==================== RESPONSIVE SCREEN DETECTOR & ADAPTIVE LAYOUT ====================

function updateScreenMetrics() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ar = w / h;
    const docEl = document.documentElement || document.body;
    if (!docEl || !docEl.style || typeof docEl.style.setProperty !== 'function') return;

    docEl.style.setProperty('--vh', (h * 0.01) + 'px');
    docEl.style.setProperty('--app-width', w + 'px');
    docEl.style.setProperty('--app-height', h + 'px');

    const isLandscape = (w > h);
    const isMobile = (w <= 680) || (ar < 1.05 && w <= 820);
    const isTallPhone = (!isLandscape && ar <= 0.56);
    const isStandardPhone = (!isLandscape && ar > 0.56 && ar <= 0.72);
    const isTablet = (!isLandscape && ar > 0.72 && w <= 1024) || (isLandscape && w <= 1100 && h <= 800);
    const isShortScreen = (h < 640);

    let tableCenterPercent = 42;
    if (isTallPhone) {
        tableCenterPercent = 48;
    } else if (isStandardPhone) {
        tableCenterPercent = 46.5;
    } else if (isTablet && !isLandscape) {
        tableCenterPercent = 45;
    } else if (isLandscape && isShortScreen) {
        tableCenterPercent = 44;
    } else {
        tableCenterPercent = 42;
    }
    docEl.style.setProperty('--table-center-y', tableCenterPercent + '%');

    let cardW, cardH, oppCardW, oppCardH;
    if (isMobile) {
        if (isLandscape) {
            cardH = Math.min(Math.max(52, h * 0.18), 76);
            cardW = Math.round(cardH * 0.69);
            oppCardH = Math.min(Math.max(30, h * 0.11), 42);
            oppCardW = Math.round(oppCardH * 0.69);
        } else {
            cardW = Math.min(Math.max(48, w * 0.145), 68);
            cardH = Math.min(Math.round(cardW * 1.44), h * 0.145);
            cardH = Math.max(cardH, 68);
            cardW = Math.round(cardH * 0.69);

            oppCardW = Math.min(Math.max(22, w * 0.075), 34);
            oppCardH = Math.min(Math.round(oppCardW * 1.47), h * 0.075);
            oppCardH = Math.max(oppCardH, 34);
            oppCardW = Math.round(oppCardH * 0.68);
        }
    } else if (isTablet) {
        cardW = Math.min(Math.max(58, w * 0.09), 78);
        cardH = Math.round(cardW * 1.44);
        oppCardW = Math.min(Math.max(28, w * 0.05), 40);
        oppCardH = Math.round(oppCardW * 1.47);
    } else {
        cardW = Math.min(Math.max(60, Math.min(w * 0.065, h * 0.11)), 88);
        cardH = Math.round(cardW * 1.44);
        oppCardW = Math.min(Math.max(30, Math.min(w * 0.04, h * 0.07)), 48);
        oppCardH = Math.round(oppCardW * 1.47);
    }

    docEl.style.setProperty('--card-w', cardW + 'px');
    docEl.style.setProperty('--card-h', cardH + 'px');
    docEl.style.setProperty('--opp-card-w', oppCardW + 'px');
    docEl.style.setProperty('--opp-card-h', oppCardH + 'px');

    let ringSize;
    if (isLandscape) {
        ringSize = Math.min(Math.max(140, h * 0.46), 220);
    } else {
        ringSize = Math.min(Math.max(160, Math.min(w * 0.48, h * 0.28)), 230);
    }
    docEl.style.setProperty('--ring-size', ringSize + 'px');

    let hudPillOffset = Math.round(ringSize * 0.5 + Math.min(Math.max(14, h * 0.022), 24));
    docEl.style.setProperty('--hud-pill-offset', hudPillOffset + 'px');

    let maxHandWidth = Math.min(w - 20, 560);
    let idealDenseMargin = Math.min(-18, Math.round((maxHandWidth - cardW) / 7 - cardW));
    let idealSparseMargin = Math.min(-6, Math.round((Math.min(w - 24, 380) - cardW) / 3 - cardW));
    idealSparseMargin = Math.max(idealSparseMargin, -16);

    docEl.style.setProperty('--dense-card-margin', idealDenseMargin + 'px');
    docEl.style.setProperty('--sparse-card-margin', idealSparseMargin + 'px');

    let safeBottom = 8;
    if (isShortScreen) safeBottom = 4;
    else if (isTallPhone) safeBottom = 10;
    docEl.style.setProperty('--south-bottom', safeBottom + 'px');
}
if (typeof window !== 'undefined') {
    updateScreenMetrics();
    window.addEventListener('resize', updateScreenMetrics);
    window.addEventListener('orientationchange', () => { setTimeout(updateScreenMetrics, 120); });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateScreenMetrics);
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

// ==================== PROCEDURAL SOUND EFFECTS ====================

// ==================== TABLE SPEED & PACING CONTROLLER ====================
if (typeof window !== 'undefined') window.GAME_SPEED_MULTIPLIER = 1.0;

function initTableSpeed() {
    try {
        const saved = localStorage.getItem('28_table_speed');
        if (saved) {
            const val = parseFloat(saved);
            if ([2.0, 1.33, 1.0, 0.65, 0.35].includes(val)) {
                window.GAME_SPEED_MULTIPLIER = val;
            }
        }
    } catch(e) {}
    updateTableSpeedUI();
}

function updateTableSpeedUI() {
    const btn = document.getElementById('table-speed-btn');
    const label = document.getElementById('table-speed-label');
    const icon = document.getElementById('table-speed-icon');
    const mult = window.GAME_SPEED_MULTIPLIER || 1.0;
    if (label) {
        if (mult === 2.0) label.innerText = '0.5x';
        else if (mult === 1.33) label.innerText = '0.75x';
        else if (mult === 1.0) label.innerText = '1x';
        else if (mult === 0.65) label.innerText = '1.5x';
        else if (mult === 0.35) label.innerText = 'Turbo';
    }
    if (icon) {
        if (mult === 2.0 || mult === 1.33) icon.innerText = '🐢';
        else if (mult === 0.35) icon.innerText = '🚀';
        else icon.innerText = '⚡';
    }
    if (btn) {
        let title = '1x Real';
        if (mult === 2.0) title = '0.5x Relaxed';
        else if (mult === 1.33) title = '0.75x Deliberate';
        else if (mult === 0.65) title = '1.5x Brisk';
        else if (mult === 0.35) title = 'Turbo Blitz';
        btn.title = `Table Pace: ${title}`;
    }
    if (window.gsap && gsap.globalTimeline) {
        let ts = Math.min(2.5, Math.max(0.4, 1 / mult));
        gsap.globalTimeline.timeScale(ts);
    }
}

function cycleTableSpeed() {
    if (gameMode === 'multi' && !isHost) {
        if (typeof ui !== 'undefined' && ui) {
            ui.renderLog("⚡ Table pace is synchronized by the Room Host.");
        }
        return;
    }
    let current = window.GAME_SPEED_MULTIPLIER || 1.0;
    if (current === 1.0) current = 0.65;
    else if (current === 0.65) current = 0.35;
    else if (current === 0.35) current = 2.0;
    else if (current === 2.0) current = 1.33;
    else current = 1.0;

    window.GAME_SPEED_MULTIPLIER = current;
    try { localStorage.setItem('28_table_speed', current.toString()); } catch(e) {}
    updateTableSpeedUI();
    playSound('rustle');

    if (gameMode === 'multi' && isHost) {
        broadcastNetMessage({ type: 'SPEED_SYNC', speedMultiplier: current });
    }
}

function getBotThinkTimeMs(engine, botSeat, legalCards) {
    const jitter = () => Math.floor(Math.random() * 220) - 110; // ±110ms organic variance
    const mult = window.GAME_SPEED_MULTIPLIER || 1.0;

    const isMulti = (typeof gameMode !== 'undefined' && gameMode === 'multi');

    // 1. Forced card (single legal option or last trick) -> Fast snap play in single-player, but buffered in multi for network animation sync
    if (legalCards && legalCards.length === 1) {
        let baseMin = isMulti ? 750 : 300;
        let baseTarget = isMulti ? 850 : 420;
        return Math.round(Math.max(baseMin, (baseTarget + jitter())) * mult);
    }

    let delay = isMulti ? 850 : 650; // Base human reaction time after previous card lands

    // 2. Leading the trick (Seat 1) requires picking a strategy (900ms - 1350ms)
    if (!engine.trickCards || engine.trickCards.length === 0) {
        delay += 450;
    } else {
        // 3. High stakes on the table (Jacks or 9s in the middle) -> 1100ms - 1600ms
        const trickPoints = engine.trickCards.reduce((sum, play) => sum + ((play.card && play.card.value) ? play.card.value : 0), 0);
        if (trickPoints >= 4) {
            delay += 550;
        } else if (trickPoints >= 2) {
            delay += 350;
        }

        // 4. Void in led suit while Trump is still secret -> Maximum dramatic tension (1600ms - 2400ms)
        const ledSuit = engine.leadSuit || (engine.trickCards[0] && engine.trickCards[0].card ? engine.trickCards[0].card.suit : null);
        const hand = engine.players[botSeat] || [];
        const hasLedSuit = hand.some(c => c.suit === ledSuit);
        if (ledSuit && !hasLedSuit && !engine.trumpRevealed) {
            delay += 1150; 
        }

        // 5. 4th Seat deciding high stakes trick
        if (engine.trickCards.length === 3 && trickPoints >= 3) {
            delay += 350;
        }
    }

    let finalDelay = Math.max(isMulti ? 800 : 350, delay + jitter());
    return Math.round(finalDelay * mult);
}

let soundEnabled = true;
let audioCtx = null;
let noiseBuffer = null;

let currentDifficulty = 'medium';
try {
    const savedDiff = localStorage.getItem('twenty_eight_difficulty');
    if (savedDiff && ['easy', 'medium', 'hard'].includes(savedDiff)) {
        currentDifficulty = savedDiff;
    }
} catch(e) {}

function setDifficulty(diff) {
    if (!['easy', 'medium', 'hard'].includes(diff)) diff = 'medium';
    currentDifficulty = diff;
    try { localStorage.setItem('twenty_eight_difficulty', diff); } catch(e) {}
    updateDifficultyUI();
}

function cycleDifficulty() {
    const order = ['easy', 'medium', 'hard'];
    const nextIdx = (order.indexOf(currentDifficulty) + 1) % order.length;
    setDifficulty(order[nextIdx]);
}

function updateDifficultyUI() {
    const t = I18N[currentLang] || I18N.en;
    ['easy', 'medium', 'hard'].forEach(d => {
        const pill = document.getElementById(`diff-pill-${d}`);
        if (pill) {
            if (d === currentDifficulty) pill.classList.add('active');
            else pill.classList.remove('active');
        }
    });

    const descEl = document.getElementById('diff-desc-text');
    if (descEl) {
        if (currentDifficulty === 'easy') descEl.innerText = t.diffDescEasy || "Easy: No AI involvement in enemy bots.";
        else if (currentDifficulty === 'hard') descEl.innerText = t.diffDescHard || "Hard: Grandmaster AI with card counting.";
        else descEl.innerText = t.diffDescMedium || "Medium: Moderate AI involvement.";
    }

    const topDot = document.getElementById('top-diff-dot');
    const topLabel = document.getElementById('top-diff-label');
    if (topLabel && topDot) {
        const colors = { easy: '#22c55e', medium: '#eab308', hard: '#ef4444' };
        const names = {
            easy: currentLang === 'hi' ? 'सरल' : 'Easy',
            medium: currentLang === 'hi' ? 'मध्यम' : 'Medium',
            hard: currentLang === 'hi' ? 'कठिन' : 'Hard'
        };
        topDot.style.background = colors[currentDifficulty] || '#eab308';
        topLabel.innerText = names[currentDifficulty] || 'Medium';
    }
}


let screenWakeLock = null;

export async function requestScreenWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
            screenWakeLock = await navigator.wakeLock.request('screen');
            screenWakeLock.addEventListener('release', () => {
                screenWakeLock = null;
            });
            console.log('[WakeLock] Screen wake lock acquired.');
        } catch (err) {
            console.warn('[WakeLock] Request skipped:', err);
        }
    }
}

export function releaseScreenWakeLock() {
    if (screenWakeLock) {
        screenWakeLock.release().catch(() => {});
        screenWakeLock = null;
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const startScreen = document.getElementById('start-screen');
            if (startScreen && startScreen.style.display === 'none') {
                requestScreenWakeLock();
            }
        }
    });
}

function startSinglePlayer() {
    requestScreenWakeLock();
    gameMode = 'ai'; mySeat = 0; isHost = true; humanSeats = [0]; viewMode = 'FULL';
    myNickname = document.getElementById('player-name-input').value.trim() || "Player 1";
    playerCustomNames[0] = myNickname;
    updateTopCompassBar();
    document.getElementById('menu-sections').style.display = 'none';
    document.getElementById('lobby-status').innerText = 'Single Player vs 3 Grandmaster Bots Ready.';
    document.getElementById('lobby-status').style.display = 'block';
    document.getElementById('host-controls').style.display = 'flex';
    const inviteBtn = document.getElementById('btn-view-invite');
    if (inviteBtn) inviteBtn.style.display = 'none';
    const backBtn = document.getElementById('btn-back-menu');
    if (backBtn) backBtn.style.display = 'inline-flex';
}

function backToMainMenu() {
    document.getElementById('start-screen').style.display = 'flex';
    document.getElementById('menu-sections').style.display = 'grid';
    document.getElementById('lobby-status').style.display = 'none';
    document.getElementById('host-controls').style.display = 'none';
    const rosterCard = document.querySelector('.lobby-roster-card');
    if (rosterCard) rosterCard.remove();
}

function exitToMainMenu() {
    releaseScreenWakeLock();
    if (confirm('Leave match and return to the main menu?')) {
        location.reload();
    }
}

function toggleJoinRoomInput() {
    const box = document.getElementById('join-room-container');
    if (!box) return;
    const isHidden = (box.style.display === 'none');
    box.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
        const inp = document.getElementById('room-code-input');
        if (inp) inp.focus();
    }
}

export {
    getVisualPosition,
    getPlayerAtVisualPosition,
    openSettingsModal,
    closeSettingsModal,
    syncSettingsModalUI,
    setTimerVisibilityUI,
    setDifficultyUI,
    setOrientationUI,
    setSpeedUI,
    toggleTableOrientation,
    updateOrientationUI,
    updateScreenMetrics,
    initTableSpeed,
    updateTableSpeedUI,
    cycleTableSpeed,
    getBotThinkTimeMs,
    setDifficulty,
    cycleDifficulty,
    updateDifficultyUI,
    toggleFullscreen,
    toggleJoinRoomInput,
    startSinglePlayer,
    backToMainMenu,
    exitToMainMenu
};
