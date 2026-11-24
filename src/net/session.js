/**
 * session.js - Player Identity, Session Persistence & Seat Handover
 * Manages unique player IDs, reconnect tokens, URL takeover parameters, and QR codes.
 */
// ==================== SEAT HANDOVER & QR CODE TAKEOVER ====================
function openHandoverModal() {
    if (mySeat === 99 || gameMode !== 'multi') {
        if (typeof showGameToast === 'function') showGameToast("Handover is only available while seated in a multiplayer match.", 2500);
        return;
    }

    const modal = document.getElementById('handover-modal');
    const badge = document.getElementById('handover-seat-badge');
    const qrDiv = document.getElementById('handover-qrcode-container');
    const input = document.getElementById('handover-link-input');
    const statusMsg = document.getElementById('handover-status-msg');
    if (!modal || !badge || !qrDiv || !input) return;

    let dir = COMPASS_FULL[mySeat] || ('Seat ' + mySeat);
    badge.innerText = `${dir} (${currentRoom})`;

    let sess = getOrCreateSessionToken(currentRoom);
    let myToken = sess.token;
    const handoverUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom}&takeoverSeat=${mySeat}&takeoverToken=${encodeURIComponent(myToken)}`;
    input.value = handoverUrl;

    if (statusMsg) {
        statusMsg.style.display = 'none';
        statusMsg.innerText = '';
    }

    qrDiv.innerHTML = "";
    if (window.QRCode) {
        new QRCode(qrDiv, {
            text: handoverUrl,
            width: 150,
            height: 150,
            colorDark: "#09150d",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    modal.style.display = 'flex';
}

function closeHandoverModal() {
    const modal = document.getElementById('handover-modal');
    if (modal) modal.style.display = 'none';
}

function copyHandoverLink() {
    const input = document.getElementById('handover-link-input');
    if (!input) return;
    input.select();
    input.setSelectionRange(0, 99999);
    try {
        navigator.clipboard.writeText(input.value);
        if (typeof showGameToast === 'function') showGameToast("📋 Handover link copied!", 2500);
    } catch(e) {
        document.execCommand('copy');
        if (typeof showGameToast === 'function') showGameToast("📋 Handover link copied!", 2500);
    }
}

function leaveSeatToAI() {
    if (confirm("Are you sure you want to leave? The AI Bot will play in your place, and you (or a friend via QR code) can take over anytime.")) {
        if (gameMode === 'multi') {
            if (!isHost) {
                sendNetMessage({ type: 'LEAVE_TO_AI', seat: mySeat });
            } else {
                autoPlaySeats[mySeat] = true;
                broadcastNetMessage({ type: 'SEAT_TAKEOVER', seat: mySeat, autoPlay: true });
                ui.renderLog(`🤖 Host left seat. AI Auto-Sub active.`);
            }
        }
        closeHandoverModal();
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.style.display = 'flex';
        checkSavedSessionOnLoad();
    }
}

function checkUrlTakeover() {
    const params = new URLSearchParams(window.location.search);
    let room = params.get('room');
    let takeoverSeat = params.get('takeoverSeat');
    let takeoverToken = params.get('takeoverToken');

    if (room && takeoverSeat !== null && takeoverToken) {
        const modal = document.getElementById('takeover-confirm-modal');
        const textEl = document.getElementById('takeover-confirm-text');
        const confirmBtn = document.getElementById('takeover-confirm-btn');
        if (!modal || !textEl || !confirmBtn) return;

        let seatIdx = parseInt(takeoverSeat);
        let dir = COMPASS_FULL[seatIdx] || ('Seat ' + seatIdx);
        textEl.innerHTML = `You scanned a Handover invite for <b>${dir}</b> in Room <b>${room.toUpperCase()}</b>.<br>Would you like to step into this seat and take over their cards?`;

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            document.getElementById('room-code-input').value = room.toUpperCase();
            window._pendingTakeover = { room: room.toUpperCase(), seat: seatIdx, token: takeoverToken };
            joinNetworkGame('FULL', 'CLIENT');
        };

        modal.style.display = 'flex';
    }
}

function cancelTakeoverPrompt() {
    const modal = document.getElementById('takeover-confirm-modal');
    if (modal) modal.style.display = 'none';
    window._pendingTakeover = null;
}


function getOrCreatePlayerId() {
    try {
        let pid = localStorage.getItem('twentyeight_player_id');
        if (!pid) {
            pid = 'pid_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
            localStorage.setItem('twentyeight_player_id', pid);
        }
        return pid;
    } catch(e) {
        return 'pid_' + Math.random().toString(36).substring(2, 11);
    }
}

function getOrCreateSessionToken(roomCode) {
    try {
        let cleanRoom = (roomCode || 'default').toUpperCase();
        let key = 'twentyeight_session_' + cleanRoom;
        let stored = localStorage.getItem(key) || sessionStorage.getItem(key);
        let pid = getOrCreatePlayerId();
        if (stored) {
            let data = JSON.parse(stored);
            if (data && data.token) {
                if (!data.playerId) data.playerId = pid;
                data.lastActive = Date.now();
                localStorage.setItem(key, JSON.stringify(data));
                localStorage.setItem('twentyeight_last_room', cleanRoom);
                return data;
            }
        }
        let newToken = 'tok_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
        let data = {
            token: newToken,
            playerId: pid,
            nickname: (typeof myNickname !== 'undefined' ? myNickname : ''),
            room: cleanRoom,
            lastActive: Date.now()
        };
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem('twentyeight_last_room', cleanRoom);
        try { sessionStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
        return data;
    } catch(e) {
        return { token: 'tok_' + Math.random().toString(36).substring(2, 11), playerId: 'pid_fb', nickname: '' };
    }
}

function saveActiveSeatSession(roomCode, seat) {
    try {
        let cleanRoom = (roomCode || 'default').toUpperCase();
        let key = 'twentyeight_session_' + cleanRoom;
        let sess = getOrCreateSessionToken(cleanRoom);
        sess.seat = seat;
        sess.lastActive = Date.now();
        localStorage.setItem(key, JSON.stringify(sess));
        localStorage.setItem('twentyeight_last_room', cleanRoom);
    } catch(e) {}
}

function clearActiveSeatSession(roomCode) {
    try {
        let cleanRoom = (roomCode || 'default').toUpperCase();
        localStorage.removeItem('twentyeight_session_' + cleanRoom);
        if (localStorage.getItem('twentyeight_last_room') === cleanRoom) {
            localStorage.removeItem('twentyeight_last_room');
        }
    } catch(e) {}
}

function checkSavedSessionOnLoad() {
    try {
        let lastRoom = localStorage.getItem('twentyeight_last_room');
        if (!lastRoom) return;
        let key = 'twentyeight_session_' + lastRoom;
        let stored = localStorage.getItem(key);
        if (!stored) return;
        let data = JSON.parse(stored);
        if (!data || !data.token) return;

        // Check if session is recent (< 4 hours)
        let age = Date.now() - (data.lastActive || 0);
        if (age > 4 * 60 * 60 * 1000) return;

        const banner = document.getElementById('reconnect-banner');
        const roomCodeEl = document.getElementById('reconnect-room-code');
        const nickInput = document.getElementById('player-name-input');
        const roomInput = document.getElementById('room-code-input');

        if (banner && roomCodeEl) {
            roomCodeEl.innerText = lastRoom;
            if (data.nickname && nickInput) nickInput.value = data.nickname;
            if (roomInput) roomInput.value = lastRoom;
            banner.style.display = 'block';
        }
    } catch(e) {}
}

function reconnectSavedSession() {
    let lastRoom = localStorage.getItem('twentyeight_last_room');
    if (!lastRoom) return;
    const roomInput = document.getElementById('room-code-input');
    if (roomInput) roomInput.value = lastRoom;
    joinNetworkGame('FULL', 'CLIENT');
}

function dismissSavedSession() {
    const banner = document.getElementById('reconnect-banner');
    if (banner) banner.style.display = 'none';
    let lastRoom = localStorage.getItem('twentyeight_last_room');
    if (lastRoom) clearActiveSeatSession(lastRoom);
}


function getCleanRoomId(room) {
    return (room || 'ROYAL28').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ROYAL28';
}

function generateRandomRoom() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

// Parse URL params
function parseUrlParams() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('room')) {
            const rIn = document.getElementById('room-code-input');
            if (rIn) rIn.value = urlParams.get('room').toUpperCase();
        }
        if (urlParams.get('name')) {
            const pIn = document.getElementById('player-name-input');
            if (pIn) pIn.value = urlParams.get('name');
        }
        if (urlParams.get('mode') && typeof window !== 'undefined') {
            window.viewMode = urlParams.get('mode').toUpperCase();
        }
    } catch(e) {}
}

function openShareModal() {
    const modal = document.getElementById('share-modal');
    const badge = document.getElementById('share-room-code-badge');
    const input = document.getElementById('share-link-input');
    const qrDiv = document.getElementById('qrcode-container');
    
    badge.innerText = currentRoom || "ROYAL28";
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
    input.value = shareUrl;
    
    qrDiv.innerHTML = "";
    if (window.QRCode) {
        new QRCode(qrDiv, {
            text: shareUrl,
            width: 150,
            height: 150,
            colorDark: "#09150d",
            colorLight: "#ffffff"
        });
    }
    modal.style.display = 'flex';
}

function closeShareModal() { document.getElementById('share-modal').style.display = 'none'; }

function copyInviteLink() {
    const input = document.getElementById('share-link-input');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        alert("Invite link copied to clipboard!");
    }).catch(() => {
        alert("Copied link: " + input.value);
    });
}



export {
    openHandoverModal,
    closeHandoverModal,
    copyHandoverLink,
    leaveSeatToAI,
    checkUrlTakeover,
    cancelTakeoverPrompt,
    getOrCreatePlayerId,
    getOrCreateSessionToken,
    saveActiveSeatSession,
    clearActiveSeatSession,
    checkSavedSessionOnLoad,
    reconnectSavedSession,
    dismissSavedSession,
    getCleanRoomId,
    generateRandomRoom,
    openShareModal,
    closeShareModal,
    copyInviteLink,
    parseUrlParams
};
