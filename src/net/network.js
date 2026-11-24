/**
 * network.js - WebRTC PeerJS Mesh & Host-Authoritative Messaging
 * Handles room creation, peer discovery, seat assignments, heartbeat, and reconnection.
 */
import { PeerManager } from './PeerManager.js';
import { 
    getOrCreatePlayerId, 
    getOrCreateSessionToken, 
    saveActiveSeatSession, 
    clearActiveSeatSession,
    getCleanRoomId, 
    generateRandomRoom 
} from './session.js';
import { playSound, triggerHaptic } from '../ui/AudioHaptics.js';
import { I18N, currentLang } from '../ui/i18n.js';

function getTeamDisplayName(teamNum) {
    let s1 = (teamNum === 1) ? 0 : 1;
    let s2 = (teamNum === 1) ? 2 : 3;
    let isDef1 = !playerCustomNames[s1] || COMPASS_FULL.includes(playerCustomNames[s1]);
    let isDef2 = !playerCustomNames[s2] || COMPASS_FULL.includes(playerCustomNames[s2]);
    let isHuman1 = (typeof humanSeats !== 'undefined') && humanSeats.includes(s1);
    let isHuman2 = (typeof humanSeats !== 'undefined') && humanSeats.includes(s2);
    
    let botLabel = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'बॉट' : 'Bot';
    let name1 = isHuman1 ? (isDef1 ? COMPASS_FULL[s1] : playerCustomNames[s1]) : `${COMPASS_SHORT[s1]} ${botLabel}`;
    let name2 = isHuman2 ? (isDef2 ? COMPASS_FULL[s2] : playerCustomNames[s2]) : `${COMPASS_SHORT[s2]} ${botLabel}`;

    let hasCustom = (!isDef1 && isHuman1) || (!isDef2 && isHuman2);
    if (hasCustom) {
        return (typeof currentLang !== 'undefined' && currentLang === 'hi') 
            ? `टीम "${name1} व ${name2}"` 
            : `Team "${name1} & ${name2}"`;
    }
    return (teamNum === 1) 
        ? ((typeof currentLang !== 'undefined' && currentLang === 'hi') ? "टीम 1 (द व उ)" : "Team 1 (S & N)")
        : ((typeof currentLang !== 'undefined' && currentLang === 'hi') ? "टीम 2 (पू व प)" : "Team 2 (E & W)");
}

function renderLobbyRoster() {
    const lobbyStatus = document.getElementById('lobby-status');
    if (!lobbyStatus) return;
    if (typeof gameMode === 'undefined' || gameMode !== 'multi') return;

    let t1Name = getTeamDisplayName(1);
    let t2Name = getTeamDisplayName(2);
    let hSeat = (typeof hostSeat !== 'undefined') ? hostSeat : 0;
    let hostName = playerCustomNames[hSeat] || COMPASS_FULL[hSeat];

    let myPartnerSeat = (mySeat === 0) ? 2 : (mySeat === 2 ? 0 : (mySeat === 1 ? 3 : 1));
    let partnerName = playerCustomNames[myPartnerSeat] || COMPASS_FULL[myPartnerSeat];
    let isPartnerHuman = humanSeats.includes(myPartnerSeat);

    // Swap options: other humans in the room who are NOT currently my partner and NOT myself
    let swapOptions = [];
    if (mySeat !== 99) {
        for (let s of [0, 1, 2, 3]) {
            if (s !== mySeat && s !== myPartnerSeat && humanSeats.includes(s)) {
                swapOptions.push({
                    seat: s,
                    name: playerCustomNames[s] || COMPASS_FULL[s],
                    dir: COMPASS_FULL[s],
                    isHost: (s === hSeat)
                });
            }
        }
    }

    let partnerStatusHtml = '';
    if (mySeat === 99) {
        partnerStatusHtml = `<div class="partner-selection-box">📺 <b>Spectator Mode:</b> Watching as Center Table Display.</div>`;
    } else {
        let partnerDesc = isPartnerHuman 
            ? `<b>${partnerName} (${COMPASS_FULL[myPartnerSeat]})</b>`
            : `<b>🤖 ${COMPASS_FULL[myPartnerSeat]} Bot</b>`;

        if (swapOptions.length > 0) {
            partnerStatusHtml = `
                <div class="partner-selection-box">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                        <div>
                            <div style="font-weight:800; color:var(--gold-bright);">🤝 Your Partner: ${partnerDesc}</div>
                            <div style="font-size:0.72rem; color:#cbd5e1; margin-top:2px;">Want to partner with someone else?</div>
                        </div>
                        <button class="partner-change-btn" onclick="openPartnerChangeModal()">🔄 Change Partner</button>
                    </div>
                </div>
            `;
        } else {
            let reasonNote = humanSeats.length <= 1 
                ? `(Waiting for friends to join... Share your Room Code!)`
                : `(You are already paired with the only other player in the room.)`;

            partnerStatusHtml = `
                <div class="partner-selection-box">
                    <div style="font-weight:800; color:var(--gold-bright);">🤝 Your Partner: ${partnerDesc}</div>
                    <div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">${reasonNote}</div>
                </div>
            `;
        }
    }

    function renderSlot(s) {
        let isHuman = humanSeats.includes(s);
        let isMe = (mySeat === s);
        let isHst = (s === hSeat);
        let dir = COMPASS_FULL[s];
        let pName = isHuman ? (playerCustomNames[s] || dir) : `${dir} Bot`;

        return `
            <div class="lobby-player-slot ${isMe ? 'me' : ''} ${isHst ? 'is-host' : ''}">
                <div class="slot-dir-badge dir-${dir.toLowerCase()}">🧭 ${dir}</div>
                <div class="slot-identity">
                    <span class="slot-avatar">${isHuman ? '👤' : '🤖'}</span>
                    <span class="slot-player-name">${pName}</span>
                </div>
                <div class="slot-tags">
                    ${isHst ? '<span class="slot-tag-host">👑 HOST</span>' : ''}
                    ${isMe ? '<span class="slot-tag-you">YOU</span>' : ''}
                </div>
            </div>
        `;
    }

    let roleBadge = isHost 
        ? `👑 You are Host (<span style="color:var(--gold-bright); font-weight:800;">${currentRoom}</span>)`
        : `Connected • 👑 Host: <b>${hostName}</b> (<span style="color:var(--gold-bright); font-weight:800;">${currentRoom}</span>)`;

    lobbyStatus.innerHTML = `
        <div class="lobby-roster-card">
            <div class="lobby-roster-header">
                <span>${roleBadge}</span>
                <span style="font-size:0.72rem; color:#94a3b8;">${humanSeats.length} / 4 Humans</span>
            </div>
            <div class="lobby-teams-grid">
                <div class="lobby-team-column team1">
                    <div class="lobby-team-title">${t1Name}</div>
                    ${renderSlot(0)}
                    ${renderSlot(2)}
                </div>
                <div class="lobby-team-column team2">
                    <div class="lobby-team-title">${t2Name}</div>
                    ${renderSlot(1)}
                    ${renderSlot(3)}
                </div>
            </div>
            ${partnerStatusHtml}
            <div id="partner-pending-notice" style="display:none;" class="partner-pending-banner"></div>
        </div>
    `;
}

function openPartnerChangeModal() {
    closePartnerRejectedModal();
    const modal = document.getElementById('partner-change-modal');
    const list = document.getElementById('partner-candidates-list');
    if (!modal || !list) return;

    let hSeat = (typeof hostSeat !== 'undefined') ? hostSeat : 0;
    let myPartnerSeat = (mySeat === 0) ? 2 : (mySeat === 2 ? 0 : (mySeat === 1 ? 3 : 1));
    let swapOptions = [];
    if (mySeat !== 99) {
        for (let s of [0, 1, 2, 3]) {
            if (s !== mySeat && s !== myPartnerSeat && humanSeats.includes(s)) {
                swapOptions.push({
                    seat: s,
                    name: playerCustomNames[s] || COMPASS_FULL[s],
                    dir: COMPASS_FULL[s],
                    isHost: (s === hSeat)
                });
            }
        }
    }

    if (swapOptions.length === 0) {
        if (typeof showGameToast === 'function') showGameToast("No other human players available to pair with.", 2500);
        return;
    }

    list.innerHTML = swapOptions.map(opt => `
        <div class="partner-candidate-btn" onclick="sendPartnerRequest(${opt.seat})">
            <div style="text-align:left;">
                <div style="font-weight:800; color:#fff; font-size:0.85rem;">👤 ${opt.name}</div>
                <div style="font-size:0.7rem; color:#94a3b8;">🧭 ${opt.dir} ${opt.isHost ? '• 👑 Host' : ''}</div>
            </div>
            <div style="font-size:0.72rem; color:var(--gold-bright); font-weight:800;">Request 🤝</div>
        </div>
    `).join('');

    modal.style.display = 'flex';
}

function closePartnerChangeModal() {
    const modal = document.getElementById('partner-change-modal');
    if (modal) modal.style.display = 'none';
}

function sendPartnerRequest(targetSeat) {
    closePartnerChangeModal();
    closePartnerRejectedModal();
    pendingPartnerRequestTarget = targetSeat;

    let targetName = playerCustomNames[targetSeat] || COMPASS_FULL[targetSeat];
    let notice = document.getElementById('partner-pending-notice');
    if (notice) {
        notice.innerHTML = `
            <span>⏳ Sent request to <b>${targetName}</b>. Waiting for response...</span>
            <button class="modal-pass-btn" style="padding:2px 8px; font-size:0.68rem;" onclick="cancelPartnerRequest()">Cancel</button>
        `;
        notice.style.display = 'flex';
    }

    triggerHaptic('turn');

    let msg = {
        type: 'PARTNER_REQUEST',
        fromSeat: mySeat,
        toSeat: targetSeat,
        fromName: playerCustomNames[mySeat] || (myNickname || ('Player ' + (mySeat + 1))),
        fromDir: COMPASS_FULL[mySeat]
    };

    if (isHost) {
        handleHostPartnerRequest(msg);
    } else {
        sendNetMessage(msg);
    }
}

function cancelPartnerRequest() {
    let target = pendingPartnerRequestTarget;
    pendingPartnerRequestTarget = -1;
    let notice = document.getElementById('partner-pending-notice');
    if (notice) notice.style.display = 'none';

    if (target !== -1) {
        let msg = { type: 'CANCEL_PARTNER_REQUEST', fromSeat: mySeat, toSeat: target };
        if (isHost) {
            handleHostCancelPartnerRequest(msg);
        } else {
            sendNetMessage(msg);
        }
    }
}

function showIncomingPartnerRequestModal(data) {
    const modal = document.getElementById('partner-request-incoming-modal');
    const textEl = document.getElementById('partner-request-incoming-text');
    const acceptBtn = document.getElementById('partner-accept-btn');
    const declineBtn = document.getElementById('partner-decline-btn');
    if (!modal || !textEl || !acceptBtn || !declineBtn) return;

    playSound('deal');
    triggerHaptic('turn');

    textEl.innerHTML = `<b>${data.fromName}</b> (${data.fromDir}) wants to pair up with you on the same team!`;

    acceptBtn.onclick = () => {
        modal.style.display = 'none';
        respondToPartnerRequest(data.fromSeat, true);
    };

    declineBtn.onclick = () => {
        modal.style.display = 'none';
        respondToPartnerRequest(data.fromSeat, false);
    };

    modal.style.display = 'flex';
}

function closeIncomingPartnerModalIfAny(fromSeat) {
    const modal = document.getElementById('partner-request-incoming-modal');
    if (modal) modal.style.display = 'none';
}

function respondToPartnerRequest(fromSeat, accepted) {
    let msg = {
        type: 'PARTNER_RESPONSE',
        fromSeat: fromSeat,
        responderSeat: mySeat,
        responderName: playerCustomNames[mySeat] || (myNickname || ('Player ' + (mySeat + 1))),
        accepted: accepted
    };
    if (isHost) {
        handleHostPartnerResponse(msg);
    } else {
        sendNetMessage(msg);
    }
}

function showPartnerRejectedModal(responderName, responderSeat) {
    pendingPartnerRequestTarget = -1;
    let notice = document.getElementById('partner-pending-notice');
    if (notice) notice.style.display = 'none';

    const modal = document.getElementById('partner-rejected-modal');
    const textEl = document.getElementById('partner-rejected-text');
    const retryBtn = document.getElementById('partner-retry-btn');
    const askOtherBtn = document.getElementById('partner-ask-other-btn');
    if (!modal || !textEl) return;

    textEl.innerHTML = `<b>${responderName}</b> declined the partner change request.<br>Would you like to ask again, choose someone else, or continue?`;

    if (retryBtn) {
        retryBtn.onclick = () => {
            modal.style.display = 'none';
            sendPartnerRequest(responderSeat);
        };
    }
    if (askOtherBtn) {
        askOtherBtn.onclick = () => {
            modal.style.display = 'none';
            openPartnerChangeModal();
        };
    }

    modal.style.display = 'flex';
}

function closePartnerRejectedModal() {
    const modal = document.getElementById('partner-rejected-modal');
    if (modal) modal.style.display = 'none';
}

function handlePartnerResolvedLocal(data) {
    pendingPartnerRequestTarget = -1;
    let notice = document.getElementById('partner-pending-notice');
    if (notice) notice.style.display = 'none';

    const incModal = document.getElementById('partner-request-incoming-modal');
    if (incModal) incModal.style.display = 'none';
    closePartnerChangeModal();
    closePartnerRejectedModal();

    if (mySeat === data.fromSeat || mySeat === data.responderSeat) {
        triggerHaptic('pair');
        if (typeof showGameToast === 'function') {
            showGameToast(`🎉 ${data.fromName} and ${data.responderName} are now teammates!`, 4000);
        }
    }
    renderLobbyRoster();
}

function handleHostPartnerRequest(data) {
    if (data.toSeat === mySeat) {
        showIncomingPartnerRequestModal(data);
    } else {
        for (let connId in clientConns) {
            let conn = clientConns[connId];
            if (conn && conn.seat === data.toSeat) {
                conn.send(JSON.stringify(data));
                break;
            }
        }
    }
}

function handleHostCancelPartnerRequest(data) {
    if (data.toSeat === mySeat) {
        closeIncomingPartnerModalIfAny(data.fromSeat);
    } else {
        for (let connId in clientConns) {
            let conn = clientConns[connId];
            if (conn && conn.seat === data.toSeat) {
                conn.send(JSON.stringify(data));
                break;
            }
        }
    }
}

function handleHostPartnerResponse(data) {
    let fromSeat = data.fromSeat;
    let responderSeat = data.responderSeat;
    let accepted = !!data.accepted;
    let responderName = data.responderName || playerCustomNames[responderSeat] || COMPASS_FULL[responderSeat];
    let fromName = playerCustomNames[fromSeat] || COMPASS_FULL[fromSeat];

    if (accepted) {
        // Swap requester's current partner seat with the responder's seat
        let reqPartnerSeat = (fromSeat === 0) ? 2 : (fromSeat === 2 ? 0 : (fromSeat === 1 ? 3 : 1));
        executeSeatSwap(reqPartnerSeat, responderSeat);

        let resolvedMsg = {
            type: 'PARTNER_RESOLVED',
            fromSeat: fromSeat,
            responderSeat: responderSeat,
            accepted: true,
            fromName: fromName,
            responderName: responderName
        };
        broadcastNetMessage(resolvedMsg);
        handlePartnerResolvedLocal(resolvedMsg);
    } else {
        let rejMsg = {
            type: 'PARTNER_REJECTED',
            fromSeat: fromSeat,
            responderSeat: responderSeat,
            responderName: responderName
        };
        if (fromSeat === mySeat) {
            showPartnerRejectedModal(responderName, responderSeat);
        } else {
            for (let connId in clientConns) {
                let conn = clientConns[connId];
                if (conn && conn.seat === fromSeat) {
                    conn.send(JSON.stringify(rejMsg));
                    break;
                }
            }
        }
    }
}

function executeSeatSwap(seatA, seatB) {
    if (seatA === seatB) return;
    // 1. Swap in playerCustomNames
    let tmpName = playerCustomNames[seatA];
    playerCustomNames[seatA] = playerCustomNames[seatB];
    playerCustomNames[seatB] = tmpName;

    // 2. Swap in seatSessionTokens & seatPlayerIds
    let tmpTok = seatSessionTokens[seatA];
    seatSessionTokens[seatA] = seatSessionTokens[seatB];
    seatSessionTokens[seatB] = tmpTok;

    let tmpPid = seatPlayerIds[seatA];
    seatPlayerIds[seatA] = seatPlayerIds[seatB];
    seatPlayerIds[seatB] = tmpPid;

    // 3. Swap in humanSeats
    let hasA = humanSeats.includes(seatA);
    let hasB = humanSeats.includes(seatB);
    humanSeats = humanSeats.filter(s => s !== seatA && s !== seatB);
    if (hasA) humanSeats.push(seatB);
    if (hasB) humanSeats.push(seatA);
    humanSeats.sort();

    // 4. Update hostSeat if either seat is hostSeat
    if (hostSeat === seatA) hostSeat = seatB;
    else if (hostSeat === seatB) hostSeat = seatA;

    // 5. Update client connections
    for (let connId in clientConns) {
        let conn = clientConns[connId];
        if (!conn) continue;
        if (conn.seat === seatA) {
            conn.seat = seatB;
            conn.send(JSON.stringify({ type: 'ASSIGN_SEAT', seat: seatB, playerNames: playerCustomNames, humanSeats: humanSeats, hostSeat: hostSeat }));
        } else if (conn.seat === seatB) {
            conn.seat = seatA;
            conn.send(JSON.stringify({ type: 'ASSIGN_SEAT', seat: seatA, playerNames: playerCustomNames, humanSeats: humanSeats, hostSeat: hostSeat }));
        }
    }

    if (mySeat === seatA) mySeat = seatB;
    else if (mySeat === seatB) mySeat = seatA;

    broadcastNetMessage({ type: 'SYNC_LOBBY', humanSeats: humanSeats, playerNames: playerCustomNames, hostSeat: hostSeat });
    updateTopCompassBar();
    renderLobbyRoster();
}


function updateTopCompassBar() {
    if (typeof document === 'undefined') return;
    const bar = document.getElementById('compass-bar');
    if (!bar) return;
    bar.style.display = 'flex';
    const roleEl = document.getElementById('my-compass-role');
    const shareBtn = document.getElementById('share-icon-btn');
    const handoverBtn = document.getElementById('handover-icon-btn');
    const rosterEl = document.querySelector('.compass-roster');
    let t = (typeof I18N !== 'undefined' && typeof currentLang !== 'undefined' && I18N[currentLang]) ? I18N[currentLang] : {};

    let seatIdx = (typeof mySeat !== 'undefined') ? mySeat : 0;
    let compassList = (typeof COMPASS_FULL !== 'undefined') ? COMPASS_FULL : ["SOUTH", "EAST", "NORTH", "WEST"];
    let compassShortList = (typeof COMPASS_SHORT !== 'undefined') ? COMPASS_SHORT : ["S", "E", "N", "W"];
    let dir = compassList[seatIdx] || 'SOUTH';
    let dirName = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? (t.dirs && t.dirs[dir] ? t.dirs[dir] : dir) : dir;
    let dirShort = compassShortList[seatIdx] || 'S';
    let teamNum = (seatIdx === 0 || seatIdx === 2) ? 1 : 2;
    let selfName = (typeof myNickname !== 'undefined' && myNickname) ? myNickname : ((typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'आप' : 'Player 1');

    if (handoverBtn) {
        if (typeof gameMode !== 'undefined' && gameMode === 'multi' && seatIdx !== 99 && seatIdx >= 0 && seatIdx < 4) {
            handoverBtn.style.display = 'inline-flex';
        } else {
            handoverBtn.style.display = 'none';
        }
    }

    if (typeof gameMode !== 'undefined' && gameMode === 'multi' && seatIdx !== 99 && typeof currentRoom !== 'undefined' && currentRoom) {
        saveActiveSeatSession(currentRoom, seatIdx);
    }

    if (roleEl) {
        if (typeof gameMode !== 'undefined' && gameMode !== 'multi') {
            if (shareBtn) shareBtn.style.display = 'none';
            let isMobile = (typeof window !== 'undefined' && window.innerWidth <= 600);
            let seatText = isMobile ? `${dirShort} (T${teamNum})` : `${dirName} • Team ${teamNum}`;
            roleEl.innerHTML = `<span>🧭</span> <span style="font-weight:800;">${selfName}</span> &bull; <span>${seatText}</span>`;
        } else {
            if (shareBtn) shareBtn.style.display = 'inline-flex';
            if (seatIdx === 99) {
                roleEl.innerHTML = `<span>📺</span> <span>${(typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'मुख्य टेबल' : 'SPECTATOR'}</span>`;
            } else {
                let isMobile = (typeof window !== 'undefined' && window.innerWidth <= 600);
                let seatText = isMobile ? `${dirShort} (T${teamNum})` : `${dirName} • Team ${teamNum}`;
                roleEl.innerHTML = `<span>🧭</span> <span style="font-weight:800;">${selfName}</span> &bull; <span>${seatText}</span>`;
            }
        }
    }

    if (rosterEl) {
        rosterEl.style.display = 'flex';
        let hSeats = (typeof humanSeats !== 'undefined') ? humanSeats : [0];
        let pNames = (typeof playerCustomNames !== 'undefined') ? playerCustomNames : compassList;
        for (let i = 0; i < 4; i++) {
            const seatEl = document.getElementById(`c-seat-${i}`);
            if (!seatEl) continue;
            let isHuman = hSeats.includes(i);
            let seatFull = compassList[i] || 'SOUTH';
            let seatDirName = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? (t.dirs && t.dirs[seatFull] ? t.dirs[seatFull] : seatFull) : seatFull;
            let customName = pNames[i];
            let isDefaultName = !customName || compassList.includes(customName);
            let botLabel = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'बॉट' : 'Bot';
            let youLabel = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'आप' : 'YOU';
            let name = isDefaultName ? seatDirName : customName;
            let shortDir = compassShortList[i] || 'S';
            let label = `${shortDir}: ${isHuman ? ('👤' + (i === seatIdx && seatIdx !== 99 ? youLabel : name)) : ('🤖' + botLabel)}`;
            seatEl.innerText = label;

            seatEl.className = 'c-seat';
            if (i === seatIdx && seatIdx !== 99) seatEl.classList.add('me');
            else if (isHuman) seatEl.classList.add('human');
            if (typeof game !== 'undefined' && game && game.phase && game.phase !== 'ROUND_OVER' && game.currentTurn === i) {
                seatEl.classList.add('turn');
            }
        }
    }
}

function resetServerLobby() {
    if (isHost) {
        broadcastNetMessage({type: 'RESET_LOBBY'});
    }
    location.reload();
}

function sendNetMessage(msgObj) {
    const payload = JSON.stringify(msgObj);
    if (!isHost && hostConn) {
        try { hostConn.send(payload); } catch(e) {}
    } else if (isHost) {
        handleIncomingNetworkMessage(null, msgObj);
    }
}

function broadcastNetMessage(msgObj) {
    const payload = JSON.stringify(msgObj);
    if (isHost) {
        for (let connId in clientConns) {
            let conn = clientConns[connId];
            if (conn) {
                try { conn.send(payload); } catch(e) {}
            }
        }
    }
}

function joinNetworkGame(selectedMode, forceRole = null) {
    gameMode = 'multi'; viewMode = 'FULL';
    
    myNickname = document.getElementById('player-name-input').value.trim() || ("Player" + Math.floor(Math.random()*90+10));
    let roomIn = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!roomIn) {
        roomIn = generateRandomRoom();
        document.getElementById('room-code-input').value = roomIn;
    }
    currentRoom = getCleanRoomId(roomIn);

    document.getElementById('menu-sections').style.display = 'none';
    const lobbyStatus = document.getElementById('lobby-status');
    lobbyStatus.style.display = 'block';
    lobbyStatus.innerHTML = `Connecting to Royal Room <b style="color:var(--gold-bright)">${currentRoom}</b>...`;
    document.getElementById('compass-bar').style.display = 'flex';

    if (forceRole === 'HOST') {
        becomeRoomHost();
    } else if (forceRole === 'CLIENT') {
        connectAsClient();
    } else {
        // Auto-detect role: If URL had a room query parameter, join as client; else try claiming host
        if (urlParams.get('room')) {
            connectAsClient();
        } else {
            tryClaimHostThenClient();
        }
    }
}

function tryClaimHostThenClient() {
    const hostPeerId = `royal28-room-${currentRoom}-host`;
    const lobbyStatus = document.getElementById('lobby-status');
    lobbyStatus.innerHTML = `Setting up Royal Room <b style="color:var(--gold-bright)">${currentRoom}</b>...`;

    peer = new Peer(hostPeerId, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478'}, { urls: 'stun:stun.services.mozilla.com:3478' }
            ]
        }
    });

    let claimedAsHost = false;

    peer.on('open', (id) => {
        claimedAsHost = true;
        setupHostRole();
    });

    peer.on('error', (err) => {
        if (!claimedAsHost) {
            try { peer.destroy(); } catch(e) {}
            connectAsClient();
        }
    });
}

function connectAsClient() {
    const hostPeerId = `royal28-room-${currentRoom}-host`;
    const myClientPeerId = `royal28-room-${currentRoom}-c-${myClientId}`;
    const lobbyStatus = document.getElementById('lobby-status');
    lobbyStatus.innerHTML = `Connecting to Host in Room <b style="color:var(--gold-bright)">${currentRoom}</b>...`;

    if (peer) {
        try { peer.destroy(); } catch(e) {}
    }

    peer = new Peer(myClientPeerId, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478'}, { urls: 'stun:stun.services.mozilla.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        hostConn = peer.connect(hostPeerId, { reliable: true });

        hostConn.on('open', () => {
            isHost = false;
            lobbyStatus.innerText = 'Connected to Host! Requesting seat...';
            if (viewMode === 'BOARD') {
                hostConn.send(JSON.stringify({ type: 'JOIN_BOARD', name: myNickname, clientId: myClientId }));
            } else {
                let takeover = window._pendingTakeover;
                if (takeover && takeover.token) {
                    hostConn.send(JSON.stringify({
                        type: 'JOIN_PLAYER',
                        name: myNickname,
                        clientId: myClientId,
                        token: takeover.token,
                        takeoverSeat: takeover.seat,
                        isHandover: true
                    }));
                    window._pendingTakeover = null;
                } else {
                    let sess = getOrCreateSessionToken(currentRoom);
                    hostConn.send(JSON.stringify({ 
                        type: 'JOIN_PLAYER', 
                        name: myNickname, 
                        clientId: myClientId, 
                        token: sess.token,
                        playerId: sess.playerId
                    }));
                }
            }
        });

        hostConn.on('data', (raw) => {
            try {
                let data = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                handleIncomingNetworkMessage(hostConn, data);
            } catch(e) {}
        });

        hostConn.on('close', () => {
            console.warn("Connection to host closed, attempting auto-reconnect...");
            if (game.phase && game.phase !== 'LOBBY') {
                if (typeof showGameToast === 'function') {
                    showGameToast("⚠️ Reconnecting to Host...", 3000);
                }
                setTimeout(() => {
                    if (gameMode === 'multi' && !isHost) {
                        connectAsClient();
                    }
                }, 1000);
            } else {
                const startScreen = document.getElementById('start-screen');
                if (startScreen) startScreen.style.display = 'flex';
                lobbyStatus.style.display = 'block';
                lobbyStatus.innerHTML = `⚠️ Connection to Host lost.<br><button class="menu-btn primary-gold" onclick="location.reload()" style="margin-top:8px; justify-content:center;">🔄 Reconnect</button>`;
            }
        });
    });

    peer.on('error', (err) => {
        lobbyStatus.innerHTML = `Room <b>${currentRoom}</b> Host is not online.<br><button class="menu-btn primary-gold" style="margin-top:10px; justify-content:center;" onclick="becomeRoomHost()">👑 Click Here to Host Room ${currentRoom}</button>`;
    });
}

function becomeRoomHost() {
    const hostPeerId = `royal28-room-${currentRoom}-host`;
    if (peer) {
        try { peer.destroy(); } catch(e) {}
    }

    peer = new Peer(hostPeerId, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478'}, { urls: 'stun:stun.services.mozilla.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        setupHostRole();
    });

    peer.on('error', (err) => {
        // If Host ID was just claimed by someone else, join as client
        connectAsClient();
    });
}

function setupHostRole() {
    isHost = true;
    mySeat = (viewMode === 'BOARD') ? 99 : 0;
    if (mySeat === 0) {
        humanSeats = [0];
        playerCustomNames[0] = myNickname;
    }

        let sess = getOrCreateSessionToken(currentRoom);
    seatSessionTokens[0] = sess.token;
    updateTopCompassBar();
    document.getElementById('host-controls').style.display = 'flex';
    renderLobbyRoster();

    // Heartbeat: continuously synchronizes active match state to all connected peers (including ROUND_OVER)
    if (stateHeartbeatTimer) clearInterval(stateHeartbeatTimer);
    stateHeartbeatTimer = setInterval(() => {
        if (isHost && game && game.phase && game.phase !== 'LOBBY') {
            ui.broadcastGameState();
        }
    }, 1000);

    peer.on('connection', (conn) => {
        clientConns[conn.peer] = conn;

        conn.on('data', (raw) => {
            try {
                let data = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                handleHostProcessMessage(conn, data);
            } catch(e) {}
        });

        conn.on('close', () => {
            if (conn.seat !== undefined && conn.seat !== 99) {
                if (!game.phase || game.phase === 'LOBBY') {
                    // Pre-game lobby: remove seat assignment
                    let idx = humanSeats.indexOf(conn.seat);
                    if (idx !== -1) humanSeats.splice(idx, 1);
                    playerCustomNames[conn.seat] = COMPASS_SHORT[conn.seat];
                    broadcastNetMessage({ type: 'SYNC_LOBBY', humanSeats: humanSeats, playerNames: playerCustomNames, hostSeat: hostSeat });
                    updateTopCompassBar();
                    renderLobbyRoster();
                } else {
                    // In-game: player temporarily disconnected or locked screen!
                    // Put them into AI Auto-Sub immediately so the match continues smoothly
                    autoPlaySeats[conn.seat] = true;
                    ui.renderLog(`⚠️ ${playerCustomNames[conn.seat]} disconnected. AI Auto-Sub active.`);
                    broadcastNetMessage({ type: 'SEAT_TAKEOVER', seat: conn.seat, autoPlay: true });
                    
                    // If it is currently their turn, trigger an immediate auto-move with local bot
                    if (game.currentTurn === conn.seat && !ui.animatingTrick) {
                        setTimeout(() => {
                            if (game.currentTurn === conn.seat && autoPlaySeats[conn.seat]) {
                                ui.executeAFKTimeoutMove(conn.seat);
                            }
                        }, 800);
                    }
                }
            }
            delete clientConns[conn.peer];
        });
    });
}

function handleHostProcessMessage(conn, data) {
    if (data.type === 'JOIN_PLAYER') {
        let seat = -1;
        let isReconnect = false;
        let isTakeover = !!data.isHandover;

        // 1. Handover Takeover via QR code
        if (isTakeover && data.takeoverSeat !== undefined && data.token) {
            let tSeat = parseInt(data.takeoverSeat);
            if (seatSessionTokens[tSeat] === data.token) {
                seat = tSeat;
                isReconnect = true;
                let oldName = playerCustomNames[seat];
                playerCustomNames[seat] = data.name || ("P" + (seat + 1));
                autoPlaySeats[seat] = false;

                // Notify previous connection if still open
                for (let cId in clientConns) {
                    let c = clientConns[cId];
                    if (c && c.seat === seat && c !== conn) {
                        try {
                            c.send(JSON.stringify({ type: 'HANDOVER_COMPLETE', newPlayerName: playerCustomNames[seat] }));
                            c.seat = 99; // Demote old connection to spectator
                        } catch(e) {}
                    }
                }
                ui.renderLog(`📲 ${playerCustomNames[seat]} took over seat ${COMPASS_FULL[seat]} from ${oldName}!`);
                if (typeof showGameToast === 'function') {
                    showGameToast(`📲 ${playerCustomNames[seat]} took over seat ${COMPASS_FULL[seat]}!`, 4000);
                }
            }
        }

        // 2. Check for reconnecting player with matching token or playerId
        if (seat === -1 && (data.token || data.playerId)) {
            for (let s = 0; s < 4; s++) {
                if ((data.token && seatSessionTokens[s] === data.token) || (data.playerId && seatPlayerIds[s] === data.playerId)) {
                    seat = s;
                    isReconnect = true;
                    autoPlaySeats[seat] = false;
                    if (data.name) playerCustomNames[seat] = data.name;
                    break;
                }
            }
        }

        // 3. Fresh joiner: find preferred seat
        if (seat === -1) {
            const preferred = [0, 2, 1, 3];
            for (let s of preferred) {
                if (!humanSeats.includes(s) && (s !== 0 || !isHost || mySeat === 99)) {
                    seat = s; break;
                }
            }
        }

        if (seat !== -1) {
            conn.seat = seat;
            conn.clientId = data.clientId;
            if (data.token) seatSessionTokens[seat] = data.token;
            if (data.playerId) seatPlayerIds[seat] = data.playerId;
            if (!humanSeats.includes(seat)) humanSeats.push(seat);
            if (!isTakeover) playerCustomNames[seat] = data.name || ("P" + (seat+1));

            conn.send(JSON.stringify({ 
                type: 'ASSIGN_SEAT', 
                seat: seat, 
                playerNames: playerCustomNames, 
                humanSeats: humanSeats, 
                isReconnect: isReconnect,
                hostSeat: hostSeat,
                autoPlaySeats: autoPlaySeats
            }));
            broadcastNetMessage({ type: 'SYNC_LOBBY', humanSeats: humanSeats, playerNames: playerCustomNames, hostSeat: hostSeat });
            updateTopCompassBar();
            renderLobbyRoster();

            if (game.phase && game.phase !== 'LOBBY') {
                conn.send(JSON.stringify({ 
                    type: 'START_GAME', 
                    humanSeats: humanSeats, 
                    playerNames: playerCustomNames, 
                    speedMultiplier: window.GAME_SPEED_MULTIPLIER || 1.0,
                    hostSeat: hostSeat
                }));
                conn.send(JSON.stringify({ 
                    type: 'STATE_UPDATE', 
                    target: seat, 
                    state: game.exportStateForClient(seat) 
                }));
                conn.send(JSON.stringify({
                    type: 'SEAT_TAKEOVER',
                    seat: seat,
                    autoPlay: !!autoPlaySeats[seat]
                }));
                ui.renderLog(`🔄 ${playerCustomNames[seat]} reconnected to seat ${COMPASS_FULL[seat]}!`);
            }
        } else {
            conn.send(JSON.stringify({ type: 'FULL_LOBBY' }));
        }
    }
    else if (data.type === 'LEAVE_TO_AI') {
        if (data.seat !== undefined && data.seat >= 0 && data.seat < 4) {
            autoPlaySeats[data.seat] = true;
            ui.renderLog(`🤖 ${playerCustomNames[data.seat]} left. AI Auto-Sub active.`);
            broadcastNetMessage({ type: 'SEAT_TAKEOVER', seat: data.seat, autoPlay: true });
            if (game.currentTurn === data.seat && !ui.animatingTrick) {
                setTimeout(() => {
                    if (game.currentTurn === data.seat && autoPlaySeats[data.seat]) {
                        ui.executeAFKTimeoutMove(data.seat);
                    }
                }, 800);
            }
        }
    }
    else if (data.type === 'PARTNER_REQUEST') {
        handleHostPartnerRequest(data);
    }
    else if (data.type === 'CANCEL_PARTNER_REQUEST') {
        handleHostCancelPartnerRequest(data);
    }
    else if (data.type === 'PARTNER_RESPONSE') {
        handleHostPartnerResponse(data);
    }
    else if (data.type === 'CHOOSE_PARTNER') {
        if (isHost && (!game.phase || game.phase === 'LOBBY')) {
            let fromSeat = data.fromSeat;
            let targetSeat = data.targetSeat;
            let fromPartnerSeat = (fromSeat === 0) ? 2 : (fromSeat === 2 ? 0 : (fromSeat === 1 ? 3 : 1));
            executeSeatSwap(fromPartnerSeat, targetSeat);
        }
    }
    else if (data.type === 'CLAIM_SEAT') {
        if (isHost && data.player !== undefined) {
            autoPlaySeats[data.player] = false;
            ui.renderLog(`👋 ${playerCustomNames[data.player]} resumed manual control!`);
        }
    }
    else if (data.type === 'JOIN_BOARD') {
        conn.seat = 99;
        conn.clientId = data.clientId;
        conn.send(JSON.stringify({ type: 'ASSIGN_BOARD', playerNames: playerCustomNames, humanSeats: humanSeats }));
        conn.send(JSON.stringify({ type: 'SYNC_LOBBY', humanSeats: humanSeats, playerNames: playerCustomNames }));
        if (game.phase && game.phase !== 'LOBBY') {
            conn.send(JSON.stringify({ type: 'START_GAME', humanSeats: humanSeats, playerNames: playerCustomNames }));
            conn.send(JSON.stringify({ type: 'STATE_UPDATE', target: 99, state: game.exportStateForClient(99) }));
        }
    }
    else if (data.type === 'REQUEST_STATE') {
        let s = conn.seat !== undefined ? conn.seat : data.seat;
        if (s !== undefined && s !== null) {
            try {
                conn.send(JSON.stringify({ type: 'STATE_UPDATE', target: s, state: game.exportStateForClient(s) }));
            } catch(e) {}
        }
    }
    else {
        handleIncomingNetworkMessage(conn, data);
    }
}

function handleIncomingNetworkMessage(sourceConn, data) {
    if (data.type === 'ASSIGN_SEAT') {
        mySeat = data.seat; isHost = (mySeat === 0);
        if (data.hostSeat !== undefined) hostSeat = data.hostSeat;
        if (!humanSeats.includes(mySeat)) humanSeats.push(mySeat);
        if (data.playerNames) playerCustomNames = data.playerNames;
        updateTopCompassBar();
        renderLobbyRoster();
        if (isHost) {
            document.getElementById('host-controls').style.display = 'flex';
        }
    }
    else if (data.type === 'ASSIGN_BOARD') {
        mySeat = 99; isHost = false;
        if (data.playerNames) playerCustomNames = data.playerNames;
        updateTopCompassBar();
        document.getElementById('lobby-status').innerHTML = `📺 <b>CENTER TABLE ACTIVE</b><br>Bottom: SOUTH | Right: EAST | Top: NORTH | Left: WEST`;
    }
    else if (data.type === 'FULL_LOBBY') {
        document.getElementById('lobby-status').innerText = `All 4 seats (S/E/N/W) are full! Spectating or ask Host to reset.`;
    }
    else if (data.type === 'SYNC_LOBBY') {
        humanSeats = data.humanSeats;
        if (data.hostSeat !== undefined) hostSeat = data.hostSeat;
        if (data.playerNames) playerCustomNames = data.playerNames;
        updateTopCompassBar();
        renderLobbyRoster();
    }
    else if (data.type === 'SPEED_SYNC') {
        if (data.speedMultiplier) {
            window.GAME_SPEED_MULTIPLIER = data.speedMultiplier;
            updateTableSpeedUI();
        }
    }
    else if (data.type === 'PARTNER_REQUEST') {
        if (data.toSeat === mySeat) {
            showIncomingPartnerRequestModal(data);
        }
    }
    else if (data.type === 'CANCEL_PARTNER_REQUEST') {
        if (data.toSeat === mySeat) {
            closeIncomingPartnerModalIfAny(data.fromSeat);
        }
    }
    else if (data.type === 'PARTNER_RESOLVED') {
        handlePartnerResolvedLocal(data);
    }
    else if (data.type === 'PARTNER_REJECTED') {
        if (data.fromSeat === mySeat) {
            showPartnerRejectedModal(data.responderName, data.responderSeat);
        }
    }
    else if (data.type === 'HANDOVER_COMPLETE') {
        const statusMsg = document.getElementById('handover-status-msg');
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.innerHTML = `✅ <b>${data.newPlayerName}</b> has taken over your seat! You can now safely close this window.`;
        }
        if (typeof showGameToast === 'function') {
            showGameToast(`✅ Handed over seat to ${data.newPlayerName}!`, 5000);
        }
        mySeat = 99; // Transition to spectator
        updateTopCompassBar();
    }
    else if (data.type === 'SEAT_TAKEOVER') {
        autoPlaySeats[data.seat] = !!data.autoPlay;
        if (data.seat === mySeat) {
            const banner = document.getElementById('afk-resume-banner');
            if (banner) banner.style.display = data.autoPlay ? 'flex' : 'none';
            if (data.autoPlay) triggerHaptic('turn');
        }
    }
    else if (data.type === 'START_GAME') {
        humanSeats = data.humanSeats;
        if (data.playerNames) playerCustomNames = data.playerNames;
        if (data.speedMultiplier) {
            window.GAME_SPEED_MULTIPLIER = data.speedMultiplier;
            updateTableSpeedUI();
        }
        document.getElementById('start-screen').style.display = 'none';
        ui.updatePlayerNames();
        updateTopCompassBar();
        ui.renderLog("🎮 Match Started!");
        if (!isHost) {
            sendNetMessage({ type: 'REQUEST_STATE', seat: mySeat });
        } else {
            game.startRound();
            ui.gameLoop();
        }
    }
    else if (data.type === 'NEW_ROUND_RESET') {
        document.getElementById('end-modal').style.display = 'none';
        document.getElementById('log-drawer').innerHTML = '';
        ui.uiTrumpRevealed = false;
        ui.animatingTrick = false;
        ui.clearTrickWinnerHalo();
        const vault = document.getElementById('secret-trump-vault'); if (vault) vault.style.display = 'none';
        const watermark = document.getElementById('lead-suit-watermark'); if (watermark) { watermark.className = ''; watermark.innerHTML = ''; }
    }
    else if (data.type === 'STATE_UPDATE') {
        if (!isHost && (data.target === mySeat || data.target === 'ALL' || mySeat === 99)) {
            if (data.state && typeof data.state === 'object' && data.state.phase) {
                try {
                    ui.lastStateUpdateTime = Date.now();
                    // Sequence Guard: Discard stale out-of-order packets for the same round
                    if (data.state.roundId !== undefined && data.state.roundId === game.roundId) {
                        if (data.state.stateSeq !== undefined && game.lastReceivedStateSeq !== undefined && data.state.stateSeq < game.lastReceivedStateSeq) {
                            return; // Stale update arrived out of order
                        }
                    }
                    if (data.state.stateSeq !== undefined) {
                        game.lastReceivedStateSeq = data.state.stateSeq;
                    }
                    if (data.state.speedMultiplier) {
                        window.GAME_SPEED_MULTIPLIER = data.state.speedMultiplier;
                        updateTableSpeedUI();
                    }
                    let isNewRound = (data.state.roundId !== undefined && data.state.roundId !== game.roundId);
                    let masterTricks = data.state.roundTricksCount !== undefined ? data.state.roundTricksCount : 0;
                    let localTricks = (game.roundTricks || []).length;
                    let isSeverelyBehind = (masterTricks > localTricks + 1);

                    // If a new round started or client is >1 trick behind, force clear any frozen animations immediately
                    if (isNewRound || isSeverelyBehind) {
                        ui.clearActiveTrickAnimation();
                        ui.clearActiveDealAnimation();
                        ui.animatingTrick = false;
                        ui.animatingReveal = false;
                        ui.dealingAnimationActive = false;
                        ui.isDealingState = false;
                        uiLocked = false;
                        ui.pendingMasterState = null;
                    }

                    if (ui.animatingTrick || ui.animatingReveal || ui.dealingAnimationActive) {
                        if (ui.animatingTrick && data.state.phase === 'TRICK_OVER') {
                            if (masterTricks <= localTricks && (!data.state.trickCards || data.state.trickCards.length === 0)) {
                                return; // Drop only stale TRICK_OVER for the trick already resolving
                            }
                        }
                        ui.pendingMasterState = data.state;
                        return;
                    }
                    ui.pendingMasterState = null;
                    game.syncFromMasterState(data.state);
                    ui.renderStaticBoard();
                    ui.syncTable();
                    ui.gameLoop();
                } catch (netSyncErr) {
                    console.warn("Failed to sync state from master:", netSyncErr);
                }
            }
        }
    }
    else if (data.type === 'UI_EVENT' && !isHost) {
        if (data.log) ui.renderLog(data.log);
        if (data.bidEvent) ui.handleRemoteBidUI(data.bidEvent.pIndex, data.bidEvent.val, data.bidEvent.won);
        if (data.pairEvent) {
            ui.playRoyalPairAnimation(data.pairEvent.player, () => {
                ui.syncTable();
                ui.renderStaticBoard();
            });
        }
    }
    else if (data.type === 'RESET_LOBBY') {
        location.reload();
    }
    else if (isHost) {
        if (data.type === 'SUBMIT_BID') { 
            consecutiveTimeouts[data.player] = 0;
            game.submitBid(data.player, data.val); 
            ui.gameLoop(); 
        }
        else if (data.type === 'SET_TRUMP') { 
            consecutiveTimeouts[data.player] = 0;
            game.setTrump(data.suit); 
            ui.gameLoop(); 
        }
        else if (data.type === 'DECLARE_PAIR') {
            consecutiveTimeouts[data.player] = 0;
            broadcastNetMessage({ type: 'UI_EVENT', pairEvent: { player: data.player } });
            ui.playRoyalPairAnimation(data.player, () => {
                game.declarePair(data.player);
                ui.broadcastGameState();
                ui.syncTable();
                ui.renderStaticBoard();
                ui.gameLoop();
            });
        }
        else if (data.type === 'PLAY_CARD') { 
            consecutiveTimeouts[data.player] = 0;
            game.playCard(data.player, data.cardIndex); 
            ui.gameLoop(); 
        }
        else if (data.type === 'REVEAL_TRUMP') { game.revealTrump(data.player); ui.gameLoop(); }
        else if (data.type === 'RESHUFFLE_REQUEST') { game.reshuffleRound(data.player); ui.gameLoop(); }
    }
}

// Client active sync watchdog: Checks if client is out of sync or hasn't received state
setInterval(() => {
    const isMulti = (typeof gameMode !== 'undefined' ? gameMode : (typeof window !== 'undefined' ? window.gameMode : 'ai')) === 'multi';
    const hostFlag = (typeof isHost !== 'undefined' ? isHost : (typeof window !== 'undefined' ? window.isHost : true));
    const startScr = (typeof document !== 'undefined') ? document.getElementById('start-screen') : null;
    if (isMulti && !hostFlag && startScr && startScr.style.display === 'none') {
        const myS = (typeof mySeat !== 'undefined' ? mySeat : (typeof window !== 'undefined' ? window.mySeat : 0));
        let hasNoCards = (typeof game !== 'undefined' && game && game.players && game.players[myS]) ? game.players[myS].length === 0 : true;
        let lastAge = (typeof ui !== 'undefined' && ui) ? (Date.now() - (ui.lastStateUpdateTime || 0)) : 0;
        let isStalled = (lastAge > 2800);

        // Stuck animation auto-recovery: if animation flags have been stuck for >3.5s, force clear them
        if (ui.animatingTrick || ui.dealingAnimationActive || ui.animatingReveal) {
            if (!ui._animStartTime) ui._animStartTime = Date.now();
            else if (Date.now() - ui._animStartTime > 3500) {
                console.warn("Watchdog: Animation stuck for >3.5s, force clearing!");
                ui.clearActiveTrickAnimation();
                ui.clearActiveDealAnimation();
                ui.animatingTrick = false;
                ui.animatingReveal = false;
                ui.dealingAnimationActive = false;
                ui.isDealingState = false;
                uiLocked = false;
                ui._animStartTime = null;
                if (ui.pendingMasterState) {
                    let pState = ui.pendingMasterState;
                    ui.pendingMasterState = null;
                    game.syncFromMasterState(pState);
                    ui.renderStaticBoard();
                    ui.syncTable();
                    ui.gameLoop();
                }
            }
        } else {
            ui._animStartTime = null;
        }

        if (hasNoCards || isStalled) {
            sendNetMessage({ type: 'REQUEST_STATE', seat: mySeat });
        }
    }
}, 1500);

// ==================== SCREEN WAKEUP & RE-SYNC HANDLER ====================
function handleDeviceWakeup() {
    if (document.visibilityState === 'hidden') return;

    // 1. Force unfreeze any stuck animations from sleep
    if (typeof ui !== 'undefined' && ui) {
        ui.clearActiveTrickAnimation();
        ui.clearActiveDealAnimation();
        ui.animatingTrick = false;
        ui.animatingReveal = false;
        ui.dealingAnimationActive = false;
        ui.isDealingState = false;
        uiLocked = false;
        const dealLayer = document.getElementById('deal-layer');
        if (dealLayer) dealLayer.innerHTML = '';

        if (ui.pendingMasterState && typeof game !== 'undefined' && game) {
            let pState = ui.pendingMasterState;
            ui.pendingMasterState = null;
            game.syncFromMasterState(pState);
            ui.renderStaticBoard();
            ui.syncTable();
            ui.gameLoop();
        }
    }

    // 2. Client reconnection and sync
    if (typeof gameMode !== 'undefined' && gameMode === 'multi' && !isHost) {
        let isConnActive = hostConn && hostConn.open;
        if (!isConnActive) {
            console.log("Device woke up with dead connection, auto-reconnecting to host...");
            connectAsClient();
        } else {
            console.log("Device woke up, requesting fresh state from host...");
            sendNetMessage({ type: 'REQUEST_STATE', seat: mySeat });
        }
    } else if (typeof gameMode !== 'undefined' && gameMode === 'multi' && isHost) {
        if (typeof ui !== 'undefined' && ui) {
            ui.broadcastGameState();
            ui.gameLoop();
        }
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleDeviceWakeup();
        }
    });
}
if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', handleDeviceWakeup);
    window.addEventListener('focus', handleDeviceWakeup);
}

function hostStartGame() {
    if (gameMode === 'ai') {
        document.getElementById('start-screen').style.display = 'none';
        ui.updatePlayerNames(); 
        ui.renderLog("🎮 Match Started!");
        ui.renderLog("🧠 <b>AI Intelligence:</b> OpenRouter (Nemotron 3.5 Super VL) Active");
        game.startRound(); ui.gameLoop();
    } else if (isHost) {
        broadcastNetMessage({ type: 'START_GAME', humanSeats: humanSeats, playerNames: playerCustomNames, speedMultiplier: window.GAME_SPEED_MULTIPLIER || 1.0 });
        document.getElementById('start-screen').style.display = 'none';
        ui.updatePlayerNames();
        updateTopCompassBar();
        ui.renderLog("🎮 Match Started!");
        game.startRound();
        ui.gameLoop();
    }
}



export {
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
};
