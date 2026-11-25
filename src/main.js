/**
 * Twenty-Eight (28) - Royal Casino Edition
 * Main ES Module Entry Point (Zero-Build Browser Architecture)
 */

// 1. Engine & DDS Modules
import { TwentyEightEngine } from './engine/TwentyEightEngine.js';
import { TwentyEightDDS, DDS_SUITS, DDS_RANKS } from './dds/TwentyEightDDS.js';
import { calculateRoundTelemetry } from './dds/telemetry.js';

// 2. Networking & Backend Modules
import { PeerManager } from './net/PeerManager.js';
import { BackendAPI } from './net/BackendAPI.js';
import { 
    getOrCreatePlayerId,
    getOrCreateSessionToken,
    saveActiveSeatSession,
    clearActiveSeatSession,
    checkSavedSessionOnLoad,
    reconnectSavedSession,
    dismissSavedSession,
    getCleanRoomId,
    generateRandomRoom,
    openHandoverModal,
    closeHandoverModal,
    copyHandoverLink,
    leaveSeatToAI,
    checkUrlTakeover,
    cancelTakeoverPrompt,
    openShareModal,
    closeShareModal,
    copyInviteLink
} from './net/session.js';

import {
    getTeamDisplayName,
    renderLobbyRoster,
    openPartnerChangeModal,
    closePartnerChangeModal,
    sendPartnerRequest,
    cancelPartnerRequest,
    showIncomingPartnerRequestModal,
    closeIncomingPartnerModalIfAny,
    respondToPartnerRequest,
    showPartnerRejectedModal,
    closePartnerRejectedModal,
    handlePartnerResolvedLocal,
    handleHostPartnerRequest,
    handleHostCancelPartnerRequest,
    handleHostPartnerResponse,
    executeSeatSwap,
    sendNetMessage,
    broadcastNetMessage,
    joinNetworkGame,
    tryClaimHostThenClient,
    connectAsClient,
    becomeRoomHost,
    setupHostRole,
    handleHostProcessMessage,
    handleIncomingNetworkMessage,
    handleDeviceWakeup,
    hostStartGame,
    resetServerLobby,
    updateTopCompassBar
} from './net/network.js';

// 3. UI, Audio & Settings Modules
import { RenderQueue } from './ui/RenderQueue.js';
import { UIController, getTurnDurationMs } from './ui/UIController.js';
import { 
    audioCtx,
    soundEnabled,
    getAudioContext,
    unlockAudio,
    getNoiseBuffer,
    playSound,
    toggleAudio,
    triggerHaptic 
} from './ui/AudioHaptics.js';

import {
    getCareerStats,
    saveCareerStats,
    getEloRankTitle,
    recordMatchInCareer,
    openStatsModal,
    closeStatsModal
} from './ui/stats.js';

import {
    I18N,
    currentLang,
    setLanguage,
    toggleLanguage,
    applyLanguage
} from './ui/i18n.js';

import {
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
} from './ui/settings.js';

// Modern UI Utilities
function initVanillaTilt() {
    if (typeof VanillaTilt !== 'undefined' && typeof VanillaTilt.init === 'function') {
        try {
            const tiltEls = document.querySelectorAll('.tilt-box');
            if (tiltEls.length > 0) {
                VanillaTilt.init(tiltEls, {
                    max: 10,
                    speed: 400,
                    glare: true,
                    "max-glare": 0.2
                });
            }
        } catch(e) {}
    }
}

function triggerVictoryConfetti() {
    if (typeof confetti !== 'function') return;
    try {
        const casinoColors = ['#e5c158', '#ffd700', '#22c55e', '#38bdf8', '#ffffff', '#ef4444'];
        confetti({
            particleCount: 85,
            spread: 70,
            origin: { y: 0.6 },
            colors: casinoColors
        });
        setTimeout(() => {
            confetti({
                particleCount: 55,
                angle: 60,
                spread: 55,
                origin: { x: 0.05, y: 0.7 },
                colors: casinoColors
            });
            confetti({
                particleCount: 55,
                angle: 120,
                spread: 55,
                origin: { x: 0.95, y: 0.7 },
                colors: casinoColors
            });
        }, 260);
    } catch(e) {}
}

function refreshLucideIcons() {
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        try { lucide.createIcons(); } catch(e) {}
    }
}

function toggleLogModal() {
    const m = document.getElementById('log-modal');
    if (m) m.style.display = (m.style.display === 'flex' ? 'none' : 'flex');
}

let deferredPWAInstallPrompt = null;
if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPWAInstallPrompt = e;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'block';
    });
}

function installPWA() {
    if (!deferredPWAInstallPrompt) return;
    deferredPWAInstallPrompt.prompt();
    deferredPWAInstallPrompt.userChoice.then(() => {
        deferredPWAInstallPrompt = null;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
    });
}

// Instantiate Singletons
const game = new TwentyEightEngine();
const ui = new UIController(game);

// Global Exposing for inline HTML attribute compatibility
window.game = game;
window.ui = ui;
window.TwentyEightEngine = TwentyEightEngine;
window.TwentyEightDDS = TwentyEightDDS;
window.PeerManager = PeerManager;
window.BackendAPI = BackendAPI;

// Audio & Haptics
window.playSound = playSound;
window.toggleAudio = toggleAudio;
window.unlockAudio = unlockAudio;
window.triggerHaptic = triggerHaptic;

// Navigation & Modals
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.syncSettingsModalUI = syncSettingsModalUI;
window.openStatsModal = openStatsModal;
window.closeStatsModal = closeStatsModal;
window.openShareModal = openShareModal;
window.closeShareModal = closeShareModal;
window.copyInviteLink = copyInviteLink;
window.openHandoverModal = openHandoverModal;
window.closeHandoverModal = closeHandoverModal;
window.copyHandoverLink = copyHandoverLink;
window.leaveSeatToAI = leaveSeatToAI;
window.cancelTakeoverPrompt = cancelTakeoverPrompt;
window.toggleLogModal = toggleLogModal;
window.toggleFullscreen = toggleFullscreen;
window.toggleJoinRoomInput = toggleJoinRoomInput;
window.installPWA = installPWA;

// Game Controls
window.startSinglePlayer = startSinglePlayer;
window.joinNetworkGame = joinNetworkGame;
window.backToMainMenu = backToMainMenu;
window.exitToMainMenu = exitToMainMenu;
window.reconnectSavedSession = reconnectSavedSession;
window.dismissSavedSession = dismissSavedSession;
window.setDifficulty = setDifficulty;
window.cycleDifficulty = cycleDifficulty;
window.setOrientationUI = setOrientationUI;
window.toggleTableOrientation = toggleTableOrientation;
window.updateTopCompassBar = updateTopCompassBar;
window.setSpeedUI = setSpeedUI;
window.cycleTableSpeed = cycleTableSpeed;
window.setTimerVisibilityUI = setTimerVisibilityUI;
window.setLanguage = setLanguage;
window.toggleLanguage = toggleLanguage;
window.applyLanguage = applyLanguage;
window.triggerVictoryConfetti = triggerVictoryConfetti;
window.refreshLucideIcons = refreshLucideIcons;
window.initVanillaTilt = initVanillaTilt;

// UI delegated triggers
window.toggleTacticalReportCard = () => ui.toggleTacticalReportCard();
window.dismissBidWonModal = () => ui.dismissBidWonModal();
window.onAskRevealClick = () => ui.onAskRevealClick();
window.onDeclarePairClick = () => ui.onDeclarePairClick();
window.startNewRound = () => ui.startNewRound();
window.hostStartGame = hostStartGame;
window.resetServerLobby = resetServerLobby;

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW v4.0.0 registered with scope:', reg.scope))
            .catch(err => console.warn('SW registration skipped:', err));
    });
}

// App Initialization
function initApp() {
    updateOrientationUI();
    initTableSpeed();
    checkSavedSessionOnLoad();
    checkUrlTakeover();
    applyLanguage();
    refreshLucideIcons();
    initVanillaTilt();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}
