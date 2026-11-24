/**
 * UIController - DOM Bindings, POV Projection, HUD Orchestration & Input Controller
 * Bridges authoritative engine state to visual cards, felt table, and tactile animations.
 */
import { RenderQueue } from './RenderQueue.js';
import { playSound, triggerHaptic, getAudioContext } from './AudioHaptics.js';
import { BackendAPI } from '../net/BackendAPI.js';
import { toggleTacticalReportCard, renderTacticalReportCard } from './TacticalModal.js';

// Context-aware turn duration helper
export function getTurnDurationMs(engine, seat) {
    if (autoPlaySeats[seat]) return 3000; // Fast auto-sub for AFK players
    if (engine.phase === 'BIDDING' || engine.phase === 'SET_TRUMP') return 25000;
    const legal = (typeof engine.getValidPlayIndices === 'function') ? engine.getValidPlayIndices(seat) : [];
    if (legal && legal.length <= 1) return 10000; // Forced move doesn't need 60s
    const pace = Math.max(0.5, Math.min(1.5, window.GAME_SPEED_MULTIPLIER || 1.0));
    return Math.round(35000 * pace);
}

export class UIController {
    clearActiveDealAnimation() {
        this._dealAnimSeq = (this._dealAnimSeq || 0) + 1;
        if (this.dealFlyerTimers && this.dealFlyerTimers.length > 0) {
            for (let t of this.dealFlyerTimers) clearTimeout(t);
            this.dealFlyerTimers = [];
        }
        const dealLayer = document.getElementById('deal-layer');
        if (dealLayer) dealLayer.innerHTML = '';
        this.dealingAnimationActive = false;
        this.isDealingState = false;
    }

    applyPendingMasterState() {
        if (!isHost && this.pendingMasterState) {
            let pState = this.pendingMasterState;
            this.pendingMasterState = null;
            let localTricks = (this.engine.roundTricks || []).length;
            let masterTricks = pState.roundTricksCount !== undefined ? pState.roundTricksCount : localTricks;
            let isStaleTrickOver = (pState.phase === 'TRICK_OVER' && masterTricks <= localTricks && (!pState.trickCards || pState.trickCards.length === 0));
            if (!isStaleTrickOver) {
                this.engine.syncFromMasterState(pState);
                this.renderStaticBoard();
                this.syncTable();
            }
        }
    }

    constructor(engine) {
        this.engine = engine;
        this.engine.callbacks.onLog = (msg) => this.renderLog(msg);
        this.engine.callbacks.onBid = (pIndex, val) => this.handleRemoteBidUI(pIndex, val, false);
        this.engine.callbacks.onBidWon = (pIndex, val) => {
            if (pIndex === mySeat && mySeat !== 99) {
                // Human winner: Show sole dedicated Bid Won modal, suppress redundant background splash
                this.showBidWonModal(pIndex, val);
                this.showSeatFloatingBid(pIndex, val, true);
            } else {
                // Remote/Bot winner: Show bid splash banner
                this.handleRemoteBidUI(pIndex, val, true);
            }
        };
        this.playerNames = ["SOUTH", "EAST", "NORTH", "WEST"];
        this.isDealingState = false; this.uiTrumpRevealed = false; this.animatingReveal = false; 
        this.aiTimer = null; this.trickTimer = null;
        this._aiWatchdogTimer = null; this._trickAnimationWatchdog = null;
        this.animatingTrick = false; this.isAIThinking = false;
        this.isCardDragging = false;
        this.pendingMasterState = null;
        this.lastAnimatedDealKey = null;
        this._dealAnimSeq = 0;
        this.dealFlyerTimers = [];
        this.lastStateUpdateTime = Date.now();
        this.turnSecondsLeft = 60;
        this.turnCountdownTimer = null;
        this.turnTimerSeat = -1;
        this.animQueue = new AnimationQueue();
        this.activeTrickTimeline = null;
        this.trickBeat2Timer = null;
        this.trickBreathingTimer = null;
        this._trickAnimSeq = 0;
    }

    clearActiveTrickAnimation() {
        if (this._trickAnimationWatchdog) {
            clearTimeout(this._trickAnimationWatchdog);
            this._trickAnimationWatchdog = null;
        }
        if (this.trickTimer) {
            clearTimeout(this.trickTimer);
            this.trickTimer = null;
        }
        if (this.trickBeat2Timer) {
            clearTimeout(this.trickBeat2Timer);
            this.trickBeat2Timer = null;
        }
        if (this.trickBreathingTimer) {
            clearTimeout(this.trickBreathingTimer);
            this.trickBreathingTimer = null;
        }
        if (this.activeTrickTimeline) {
            try { this.activeTrickTimeline.kill(); } catch (e) {}
            this.activeTrickTimeline = null;
        }
        const table = document.getElementById('center-table');
        if (table && window.gsap) {
            try { gsap.killTweensOf(table.querySelectorAll('.trick-card')); } catch (e) {}
        }
        this._trickAnimSeq = (this._trickAnimSeq || 0) + 1;
    }

    handleRemoteBidUI(pIndex, val, won) {
        let t = I18N[currentLang];
        let partnerIdx = mySeat === 99 ? 2 : (mySeat + 2) % 4;
        let pDir = COMPASS_FULL[pIndex];
        let pDirName = currentLang === 'hi' ? (t.dirs && t.dirs[pDir] ? t.dirs[pDir] : pDir) : pDir;
        let isPartner = (pIndex === partnerIdx && mySeat !== 99);
        let isSelf = (pIndex === mySeat && mySeat !== 99);
        let name = this.playerNames[pIndex] || pDirName;

        let isPass = (val === 'Pass');
        let type = won ? 'won' : (isSelf ? 'self' : (isPartner ? 'partner' : 'opponent'));

        if (won) {
            let winPrefix = isPartner ? `🤝 ${t.partnerLabel.replace('{dir}', pDirName)}` : (isSelf ? `👑 ${myNickname || 'YOU'}` : `⚔️ ${name}`);
            let displayVal = `🎯 ${t.partnerWonBid} (${val})`;
            playSound('trump_select');
            if (!isSelf) {
                this.triggerBidSplash(pIndex, winPrefix, displayVal, 'won');
            }
            this.showSeatFloatingBid(pIndex, val, true);
        } else if (isPass) {
            playSound('pass');
            this.showSeatFloatingBid(pIndex, 'Pass', false);
        } else {
            playSound('bid');
            this.showSeatFloatingBid(pIndex, val, false);
        }

        if (this.engine.phase === 'BIDDING') {
            this.renderStaticBoard();
        }
    }

    updatePlayerNames() {
        let t = I18N[currentLang] || I18N.en;
        const botRoles = {
            1: { en: "East ⚔️ (Striker)", hi: "ईस्ट ⚔️ (हमलावर)" },
            2: { en: "Partner 🛡️ (Wingman)", hi: "साथी 🛡️ (वफादार)" },
            3: { en: "West ♟️ (Saboteur)", hi: "वेस्ट ♟️ (चालबाज़)" }
        };

        if(viewMode === 'BOARD') {
            for(let i=0; i<4; i++) {
                let isHuman = humanSeats.includes(i);
                let dir = COMPASS_FULL[i];
                let dirName = currentLang === 'hi' ? (t.dirs && t.dirs[dir] ? t.dirs[dir] : dir) : dir;
                let isDefault = !playerCustomNames[i] || COMPASS_FULL.includes(playerCustomNames[i]);
                if (isHuman) {
                    let pName = isDefault ? dirName : playerCustomNames[i];
                    this.playerNames[i] = `👤 ${pName}`;
                } else {
                    let role = botRoles[i] ? (currentLang === 'hi' ? botRoles[i].hi : botRoles[i].en) : `🤖 ${dirName}`;
                    this.playerNames[i] = role;
                }
            }
            document.getElementById('t1-header').innerText = currentLang === 'hi' ? "टीम 1 (द व उ)" : "Team 1 (S & N)";
            document.getElementById('t2-header').innerText = currentLang === 'hi' ? "टीम 2 (पू व प)" : "Team 2 (E & W)";
            return;
        }

        for(let i=0; i<4; i++) {
            let isHuman = humanSeats.includes(i);
            let dir = COMPASS_FULL[i];
            let dirName = currentLang === 'hi' ? (t.dirs && t.dirs[dir] ? t.dirs[dir] : dir) : dir;
            let isDefaultName = !playerCustomNames[i] || COMPASS_FULL.includes(playerCustomNames[i]);
            let displayName = isDefaultName ? dirName : playerCustomNames[i];

            if (i === mySeat) { 
                let youLabel = myNickname || (currentLang === 'hi' ? 'आप' : 'You');
                this.playerNames[i] = `👤 ${youLabel} (${dirName})`; 
            } else if (isHuman) {
                this.playerNames[i] = `👤 ${displayName}`;
            } else {
                // Distinctive AI Personalities
                if (i === (mySeat + 2) % 4) {
                    this.playerNames[i] = currentLang === 'hi' ? "🛡️ साथी (वफादार विंगमैन)" : "🛡️ Partner (Wingman)";
                } else if (i === 1) {
                    this.playerNames[i] = currentLang === 'hi' ? "⚔️ ईस्ट (आक्रामक हमलावर)" : "⚔️ East (Striker)";
                } else if (i === 3) {
                    this.playerNames[i] = currentLang === 'hi' ? "♟️ वेस्ट (शातिर चालबाज़)" : "♟️ West (Saboteur)";
                } else {
                    this.playerNames[i] = `🤖 ${displayName}`;
                }
            }
        }
        let myTeamNum = (mySeat === 0 || mySeat === 2) ? 1 : 2;
        let isHi = (currentLang === 'hi');
        let t1Header = document.getElementById('t1-header');
        let t2Header = document.getElementById('t2-header');
        if (mySeat === 99) {
            if (t1Header) t1Header.innerText = isHi ? "टीम 1 (द व उ)" : "Team 1 (S & N)";
            if (t2Header) t2Header.innerText = isHi ? "टीम 2 (पू व प)" : "Team 2 (E & W)";
        } else {
            let isT1Mine = (myTeamNum === 1);
            if (t1Header) t1Header.innerText = isT1Mine ? (isHi ? "आप (T1)" : "YOU (T1)") : (isHi ? "विरोधी" : "OPPONENTS");
            if (t2Header) t2Header.innerText = !isT1Mine ? (isHi ? "आप (T2)" : "YOU (T2)") : (isHi ? "विरोधी" : "OPPONENTS");
        }
    }

    triggerBidSplash(pIndex, title, value, type = 'partner') {
        const splash = document.getElementById('partner-bid-splash');
        if (!splash) return;
        const titleEl = document.getElementById('partner-splash-title');
        const valEl = document.getElementById('partner-splash-val');
        
        splash.className = `type-${type}`;
        titleEl.innerHTML = title;
        valEl.innerHTML = value;
        splash.classList.add('show');
        if (window.gsap) {
            gsap.fromTo(splash, 
                { scale: 0.65, y: -20, opacity: 0 },
                { scale: 1, y: 0, opacity: 1, duration: 0.32, ease: "back.out(1.6)" }
            );
        }
        if (this.splashTimer) clearTimeout(this.splashTimer);
        this.splashTimer = setTimeout(() => {
            if (window.gsap) {
                gsap.to(splash, {
                    scale: 0.85,
                    opacity: 0,
                    duration: 0.22,
                    ease: "power2.in",
                    onComplete: () => splash.classList.remove('show')
                });
            } else {
                splash.classList.remove('show');
            }
        }, 2600);
    }

    triggerPartnerBidSplash(title, value) {
        this.triggerBidSplash(2, title, value, 'partner');
    }

    showSeatFloatingBid(pIndex, val, won) {
        const positions = ['bottom', 'right', 'top', 'left'];
        let visualPos = getVisualPosition(pIndex);
        const seatEl = document.getElementById(`player-${positions[visualPos]}`);
        if (!seatEl) return;
        const badgeEl = seatEl.querySelector('.player-badge');
        if (!badgeEl) return;

        // Remove any previous floating bid on this seat
        const prev = badgeEl.querySelector('.floating-seat-bid');
        if (prev) prev.remove();

        let t = I18N[currentLang] || I18N.en;
        let isPass = (val === 'Pass');
        let type = won ? 'won' : (isPass ? 'pass' : 'bid');

        const floatEl = document.createElement('div');
        floatEl.className = `floating-seat-bid pos-${positions[visualPos]} type-${type}`;

        if (won) {
            floatEl.innerHTML = `
                <div class="float-bid-sub">🎯 ${t.partnerWonBid || 'WON BID'}</div>
                <div class="float-bid-main">${val}</div>
            `;
        } else if (isPass) {
            floatEl.innerHTML = `
                <div class="float-bid-main">⏭️ ${t.partnerPassed || 'PASSED'}</div>
            `;
        } else {
            floatEl.innerHTML = `
                <div class="float-bid-sub">💰 ${t.bidding || 'BIDS'}</div>
                <div class="float-bid-main">${val}</div>
            `;
        }

        badgeEl.appendChild(floatEl);

        let pos = positions[visualPos];
        let startY = (pos === 'bottom') ? 12 : (pos === 'top' ? -12 : 0);
        let startX = (pos === 'right') ? -12 : (pos === 'left' ? 12 : 0);

        if (window.gsap) {
            gsap.fromTo(floatEl,
                { scale: 0.45, opacity: 0, x: startX, y: startY },
                { 
                    scale: 1, 
                    opacity: 1, 
                    x: 0, 
                    y: 0, 
                    duration: 0.38, 
                    ease: "back.out(2)"
                }
            );
            setTimeout(() => {
                if (floatEl.parentNode) {
                    gsap.to(floatEl, {
                        scale: 0.8,
                        opacity: 0,
                        y: (pos === 'bottom' ? -12 : (pos === 'top' ? 12 : 0)),
                        x: (pos === 'right' ? -12 : (pos === 'left' ? 12 : 0)),
                        duration: 0.35,
                        ease: "power2.in",
                        onComplete: () => floatEl.remove()
                    });
                }
            }, 2600);
        } else {
            setTimeout(() => floatEl.remove(), 2600);
        }
    }

    renderLog(msg) {
        let formattedMsg = msg.replace(/Player (\d)/g, (match, p1) => {
            return `<span class='log-highlight'>${this.playerNames[parseInt(p1)]}</span>`;
        });
        const l = document.getElementById('log-drawer');
        const div = document.createElement('div'); div.className = 'log-entry';
        div.innerHTML = formattedMsg;
        l.insertBefore(div, l.firstChild);
    }

    showSpeechBubble(pIndex, text, emote = '') {
        // In-game bot dialogue comments disabled for clean, distraction-free gameplay
        const bubbles = document.querySelectorAll('.speech-bubble');
        bubbles.forEach(b => b.remove());
        return;
    }


    async animateBotPrePlayTell(pIndex, isSaboteurBluff = false) {
        const positions = ['bottom', 'right', 'top', 'left'];
        let visualPos = getVisualPosition(pIndex);
        const seatEl = document.getElementById(`player-${positions[visualPos]}`);
        if (!seatEl || !window.gsap) return;

        const cards = seatEl.querySelectorAll('.card, .card-back');
        if (!cards || cards.length === 0) return;

        let targetIdx = Math.floor(Math.random() * cards.length);
        let targetCard = cards[targetIdx];
        let pos = positions[visualPos];

        let moveOffset = (pos === 'top') ? { y: 12 } : (pos === 'left' ? { x: 12 } : (pos === 'right' ? { x: -12 } : { y: -12 }));

        if (isSaboteurBluff && cards.length > 1) {
            // Saboteur hesitation bluff: lifts one card halfway, slides it back, then pulls a different card!
            let altIdx = (targetIdx + 1) % cards.length;
            let altCard = cards[altIdx];

            playSound('rustle');
            await gsap.to(targetCard, { ...moveOffset, duration: 0.2, ease: "power2.out" });
            await new Promise(r => setTimeout(r, 220));
            await gsap.to(targetCard, { x: 0, y: 0, duration: 0.16, ease: "power2.in" });
            await new Promise(r => setTimeout(r, 160));

            playSound('rustle');
            await gsap.to(altCard, { ...moveOffset, duration: 0.22, ease: "power2.out" });
            this._currentlyLiftedCard = altCard;
        } else {
            playSound('rustle');
            await gsap.to(targetCard, { ...moveOffset, duration: 0.22, ease: "power2.out" });
            this._currentlyLiftedCard = targetCard;
        }
    }

    resetBotPrePlayTell() {
        if (this._currentlyLiftedCard && window.gsap) {
            gsap.set(this._currentlyLiftedCard, { x: 0, y: 0 });
            this._currentlyLiftedCard = null;
        }
    }

    async animateCardHoverFakeout(pIndex, cardRaw) {
        const positions = ['bottom', 'right', 'top', 'left'];
        let visualPos = getVisualPosition(pIndex);
        const seatEl = document.getElementById(`player-${positions[visualPos]}`);
        if (!seatEl) return;

        const cards = seatEl.querySelectorAll('.card, .player-card-item, .card-item');
        if (!cards || cards.length === 0) return;

        const targetCard = cards[Math.floor(Math.random() * cards.length)];
        if (window.gsap && targetCard) {
            let pos = positions[visualPos];
            let move = (pos === 'top') ? { y: 14 } : (pos === 'left' ? { x: 14 } : (pos === 'right' ? { x: -14 } : { y: -14 }));
            await gsap.to(targetCard, { ...move, duration: 0.22, ease: "power2.out" });
            await new Promise(r => setTimeout(r, 360));
            await gsap.to(targetCard, { x: 0, y: 0, duration: 0.18, ease: "power2.in" });
        }
    }

    generateGamePointsHTML(pts) {
        if (pts === 0) return `<span style="color:#64748b;">0</span>`;
        if (pts > 0) return Array(pts).fill(`<span class="score-heart" style="color:#ef4444;">♥</span>`).join('');
        return Array(Math.abs(pts)).fill(`<span class="score-spade" style="color:#38bdf8;">♠</span>`).join('');
    }
    
    updateNumberAnim(elementId, newValue) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (el.innerText !== String(newValue)) {
            el.innerText = newValue;
            if (window.gsap) {
                gsap.fromTo(el,
                    { scale: 1.45, color: '#fef08a' },
                    { scale: 1, color: 'inherit', duration: 0.35, ease: 'back.out(2)' }
                );
            } else {
                el.classList.remove('anim-bump');
                void el.offsetWidth;
                el.classList.add('anim-bump');
            }
        }
    }

    playRiffleShuffleAnimation(dealLayer, callback) {
        if (!dealLayer || !window.gsap) { callback(); return; }

        const packetL = document.createElement('div');
        packetL.className = 'shuffle-packet packet-left';
        const packetR = document.createElement('div');
        packetR.className = 'shuffle-packet packet-right';

        dealLayer.appendChild(packetL);
        dealLayer.appendChild(packetR);

        gsap.set([packetL, packetR], { xPercent: -50, yPercent: -50, x: 0, y: 0, scale: 0.92 });
        const tl = gsap.timeline({
            onComplete: () => {
                packetL.remove();
                packetR.remove();
                callback();
            }
        });

        // 1. Packets split left and right with inwards tilt
        tl.to(packetL, { x: -48, rotation: -12, scale: 1, duration: 0.22, ease: "power2.out" }, 0)
          .to(packetR, { x: 48, rotation: 12, scale: 1, duration: 0.22, ease: "power2.out" }, 0);

        // 2. Sound effect: rapid paper riffle
        tl.add(() => { playSound('shuffle'); }, 0.18);

        // 3. Interlace inwards
        tl.to(packetL, { x: -6, rotation: -2, duration: 0.38, ease: "power1.inOut" }, 0.22)
          .to(packetR, { x: 6, rotation: 2, duration: 0.38, ease: "power1.inOut" }, 0.22);

        // 4. Square up
        tl.to([packetL, packetR], { x: 0, rotation: 0, duration: 0.12, ease: "power2.out" }, 0.60);

        // 5. Deck cut
        tl.to(packetL, { y: -26, x: 30, rotation: 5, duration: 0.16, ease: "power1.out" }, 0.72)
          .to(packetL, { y: 0, x: 0, rotation: 0, duration: 0.14, ease: "power2.in" }, 0.88);
    }

    attachDragAndFlick(cardEl, cardIndex, playerIndex) {
        let startX = 0, startY = 0, startTime = 0;
        let isDragging = false, hasMoved = false;
        let baseRot = parseFloat(cardEl.style.getPropertyValue('--rot')) || 0;
        const centerTable = document.getElementById('center-table');

        const onPointerDown = (e) => {
            if (uiLocked || this.animatingTrick || this.engine.currentTurn !== mySeat || this.engine.phase !== 'PLAYING') return;
            startX = e.clientX;
            startY = e.clientY;
            startTime = performance.now();
            isDragging = true;
            hasMoved = false;
            this.isCardDragging = true;
            try { cardEl.setPointerCapture(e.pointerId); } catch(err) {}
            cardEl.classList.add('dragging-card');
            cardEl.style.zIndex = '300';
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            if (!hasMoved && Math.hypot(dx, dy) > 8) {
                hasMoved = true;
            }
            if (hasMoved) {
                dy = Math.min(dy, 12);
                let dragRot = baseRot + dx * 0.12;
                cardEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${dragRot}deg) scale(1.12)`;
                if (dy < -55) {
                    if (centerTable) centerTable.classList.add('drag-target-active');
                } else {
                    if (centerTable) centerTable.classList.remove('drag-target-active');
                }
            }
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            this.isCardDragging = false;
            try { cardEl.releasePointerCapture(e.pointerId); } catch(err) {}
            cardEl.classList.remove('dragging-card');
            if (centerTable) centerTable.classList.remove('drag-target-active');

            if (uiLocked || this.animatingTrick || this.engine.currentTurn !== mySeat || this.engine.phase !== 'PLAYING') {
                if (window.gsap) gsap.to(cardEl, { x: 0, y: 0, scale: 1, duration: 0.2, clearProps: "x,y" });
                return;
            }

            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            let dt = Math.max(1, performance.now() - startTime);
            let vy = (dy / dt) * 1000;

            clearTimeout(window._uiLockSafetyTimer);
            window._uiLockSafetyTimer = setTimeout(() => { uiLocked = false; }, 1500);

            if (hasMoved && (dy < -55 || vy < -220)) {
                // Flick to play onto table
                uiLocked = true;
                if (window.gsap) {
                    gsap.to(cardEl, {
                        y: dy - 90,
                        opacity: 0.4,
                        scale: 0.95,
                        duration: 0.15,
                        ease: "power2.in",
                        onComplete: () => {
                            if (autoPlaySeats[mySeat]) { this.resumeManualControl(); }
                            if (typeof mySeat !== 'undefined' && mySeat >= 0 && mySeat < 4) consecutiveTimeouts[mySeat] = 0;
                            if (gameMode === 'multi') sendNetMessage({type:'PLAY_CARD', player: mySeat, cardIndex: cardIndex});
                            else { this.engine.playCard(mySeat, cardIndex); this.gameLoop(); }
                        }
                    });
                } else {
                    if (autoPlaySeats[mySeat]) { this.resumeManualControl(); }
                            if (gameMode === 'multi') sendNetMessage({type:'PLAY_CARD', player: mySeat, cardIndex: cardIndex});
                    else { this.engine.playCard(mySeat, cardIndex); this.gameLoop(); }
                }
            } else if (!hasMoved) {
                // Click/tap to play
                if (typeof mySeat !== 'undefined' && mySeat >= 0 && mySeat < 4) consecutiveTimeouts[mySeat] = 0;
                uiLocked = true;
                if (window.gsap) {
                    gsap.to(cardEl, {
                        y: -70,
                        opacity: 0.5,
                        scale: 0.95,
                        duration: 0.18,
                        ease: "power2.in",
                        onComplete: () => {
                            if (gameMode === 'multi') sendNetMessage({type:'PLAY_CARD', player: mySeat, cardIndex: cardIndex});
                            else { this.engine.playCard(mySeat, cardIndex); this.gameLoop(); }
                        }
                    });
                } else {
                    if (gameMode === 'multi') sendNetMessage({type:'PLAY_CARD', player: mySeat, cardIndex: cardIndex});
                    else { this.engine.playCard(mySeat, cardIndex); this.gameLoop(); }
                }
            } else {
                // Snap back into hand
                if (window.gsap) {
                    gsap.to(cardEl, {
                        x: 0,
                        y: 0,
                        scale: 1,
                        rotation: baseRot,
                        duration: 0.28,
                        ease: "back.out(2)",
                        clearProps: "x,y",
                        onComplete: () => {
                            cardEl.style.transform = 'rotate(var(--rot)) translateY(var(--y-lift))';
                            cardEl.style.zIndex = (cardIndex + 10).toString();
                        }
                    });
                } else {
                    cardEl.style.transform = 'rotate(var(--rot)) translateY(var(--y-lift))';
                    cardEl.style.zIndex = (cardIndex + 10).toString();
                }
            }
        };

        cardEl.addEventListener('pointerdown', onPointerDown);
        cardEl.addEventListener('pointermove', onPointerMove);
        cardEl.addEventListener('pointerup', onPointerUp);
        cardEl.addEventListener('pointercancel', onPointerUp);
    }

    attachMagneticScrub(row) {
        if (!row) return;
        row.addEventListener('pointermove', (e) => {
            if (this.isCardDragging) return;
            const cards = Array.from(row.querySelectorAll('.card:not(.dragging-card)'));
            cards.forEach((c) => {
                const r = c.getBoundingClientRect();
                const cardCenter = r.left + r.width / 2;
                const dist = e.clientX - cardCenter;
                const maxDist = 65;
                if (Math.abs(dist) < maxDist) {
                    const factor = 1 - Math.abs(dist) / maxDist;
                    const shiftX = dist < 0 ? -factor * 10 : factor * 10;
                    const liftY = factor * 16;
                    c.style.setProperty('--scrub-x', `${shiftX}px`);
                    c.style.setProperty('--scrub-y', `-${liftY}px`);
                } else {
                    c.style.setProperty('--scrub-x', '0px');
                    c.style.setProperty('--scrub-y', '0px');
                }
            });
        });
        row.addEventListener('pointerleave', () => {
            const cards = Array.from(row.querySelectorAll('.card'));
            cards.forEach((c) => {
                c.style.setProperty('--scrub-x', '0px');
                c.style.setProperty('--scrub-y', '0px');
            });
        });
    }

    toggleTrackerDrawer() {
        const drawer = document.getElementById('tracker-drawer');
        if (!drawer) return;
        drawer.classList.toggle('open');
        if (drawer.classList.contains('open')) {
            this.updateTrackerUI();
        }
    }

    updateTrackerUI() {
        const grid = document.getElementById('tracker-cards-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const suits = ['♠', '♥', '♣', '♦'];
        const ranks = [
            { r: 'J', pts: 3 },
            { r: '9', pts: 2 },
            { r: 'A', pts: 1 },
            { r: '10', pts: 1 }
        ];

        let pointsRemaining = 28;
        let jacksRemaining = 4;
        let ninesRemaining = 4;

        suits.forEach(s => {
            const isRed = (s === '♥' || s === '♦');
            const col = document.createElement('div');
            col.className = 'tracker-suit-col';
            col.innerHTML = `<div class="tracker-suit-header ${isRed ? 'red' : 'black'}">${s}</div>`;

            ranks.forEach(item => {
                const played = (this.engine.playedCardsHistory || []).some(c => c && c.suit === s && c.rank === item.r);
                if (played) {
                    pointsRemaining -= item.pts;
                    if (item.r === 'J') jacksRemaining--;
                    if (item.r === '9') ninesRemaining--;
                }
                const cardDiv = document.createElement('div');
                cardDiv.className = `tracker-card-item ${isRed ? 'red' : 'black'} ${played ? 'played' : ''}`;
                cardDiv.innerHTML = `
                    <span class="t-rank">${item.r}</span>
                    <span class="t-pts">+${item.pts}</span>
                `;
                col.appendChild(cardDiv);
            });
            grid.appendChild(col);
        });

        const ptsRemEl = document.getElementById('tracker-pts-rem');
        if (ptsRemEl) ptsRemEl.innerText = Math.max(0, pointsRemaining);
        const jRemEl = document.getElementById('tracker-jacks-rem');
        if (jRemEl) jRemEl.innerText = `Jacks: ${jacksRemaining}/4`;
        const nRemEl = document.getElementById('tracker-nines-rem');
        if (nRemEl) nRemEl.innerText = `Nines: ${ninesRemaining}/4`;
    }

    updateSecretTrumpVault() {
        const vault = document.getElementById('secret-trump-vault');
        if (vault) vault.style.display = 'none';

        const headerPill = document.getElementById('trump-status') || document.getElementById('header-trump-status') || document.getElementById('trump-badge');
        if (!headerPill) return;

        const isActive = !(this.engine.phase === 'LOBBY' || this.engine.phase === 'BIDDING' || this.engine.phase === 'DEALING_1' || this.engine.highestBidder === -1);
        const isBidderMe = (this.engine.highestBidder === mySeat && mySeat !== 99);
        const canPeek = isActive && !this.engine.trumpRevealed && isBidderMe;
        const canAskReveal = isActive && !this.engine.trumpRevealed && !isBidderMe && this.engine.canRevealTrump(mySeat);

        headerPill.style.cursor = (canPeek || canAskReveal) ? 'pointer' : 'default';
        headerPill.title = canPeek ? 'Tap to peek secret trump' : (canAskReveal ? 'Tap to reveal trump' : '');
        if (!headerPill.dataset.vaultBound) {
            headerPill.dataset.vaultBound = '1';
            headerPill.addEventListener('click', () => this.onVaultTokenClick());
        }
    }

    onVaultTokenClick() {
        if (this.engine.trumpRevealed) return;
        if (this.engine.highestBidder !== mySeat) {
            if (this.engine.canRevealTrump(mySeat)) {
                this.onAskRevealClick();
                return;
            }
            this.renderLog(currentLang === 'hi' ? "🔒 हुकुम गुप्त है! जब आपके पास चाल का रंग न हो, तब 'हुकुम खोलें' बटन दबाएं।" : "🔒 Secret Trump is locked! Click 'Reveal Trump' when you have no cards of the led suit.");
            return;
        }
        playSound('trump_select');
        const suit = this.engine.trumpSuit || '♠';
        const isRed = (suit === '♥' || suit === '♦');
        const color = isRed ? '#ef4444' : '#38bdf8';
        const headerPill = document.getElementById('trump-status') || document.getElementById('header-trump-status') || document.getElementById('trump-badge');
        if (headerPill) {
            if (this._peekTimer) clearTimeout(this._peekTimer);
            const prevHtml = headerPill.dataset.lockedHtml || headerPill.innerHTML;
            headerPill.dataset.lockedHtml = prevHtml;
            headerPill.innerHTML = `👁️ <span style="color:${color}; font-weight:bold;">${suit}</span> (Secret)`;
            this._peekTimer = setTimeout(() => {
                if (!this.engine.trumpRevealed && headerPill.dataset.lockedHtml) {
                    headerPill.innerHTML = headerPill.dataset.lockedHtml;
                }
                delete headerPill.dataset.lockedHtml;
            }, 1800);
        }
    }

    async fetchMathPriorsInFlight(nextPlayer) {
        // Zero Perceived Lag Pipeline: Pre-fetch OpenRouter Nemotron math priors during card animation flight
        try {
            if (nextPlayer === mySeat || this.engine.phase !== 'PLAYING') return;
            let hand = this.engine.players[nextPlayer] || [];
            let valids = this.engine.getValidPlayIndices(nextPlayer);
            let legalCards = valids.map(i => `${hand[i].rank}${hand[i].suit}`);
            let excluded = Array.from(this.engine.bidderExcludedTrumps || []);

            let stateSnapshot = {
                bidTarget: this.engine.currentBid,
                highestBidder: COMPASS_FULL[this.engine.highestBidder],
                trumpRevealed: this.engine.trumpRevealed,
                trumpSuit: this.engine.trumpSuit,
                excludedTrumps: excluded,
                legalCards: legalCards,
                currentTrick: (this.engine.trickCards || []).map(tc => ({ seat: COMPASS_FULL[tc.player], card: `${tc.card.rank}${tc.card.suit}` })),
                teamPoints: { NS: this.engine.t1TrickPts, EW: this.engine.t2TrickPts },
                opponentProfile: this.engine.getOpponentProfile()
            };

            this.cachedMathPriors = await BackendAPI.getBotMath(stateSnapshot);
            if (this.cachedMathPriors && this.cachedMathPriors.trumpSuitPriors && this.engine.inference) {
                this.engine.inference.setTrumpSuitPriors(this.cachedMathPriors.trumpSuitPriors);
            }
        } catch(e) {}
    }

    animateVaultUnlock(suit) {
        const vault = document.getElementById('secret-trump-vault');
        const inner = vault?.querySelector('.vault-card-inner');
        if (inner && window.gsap) {
            gsap.to(inner, {
                rotationY: 180,
                scale: 1.25,
                duration: 0.5,
                ease: "back.out(2)",
                onComplete: () => {
                    gsap.to(inner, { scale: 1.0, duration: 0.25 });
                }
            });
        }
    }

    updateTurnUrgencyRing(badgeEl, isCurrent, actualPlayerIndex) {
        if (!badgeEl) return;
        let existingSvg = badgeEl.querySelector('.turn-urgency-svg');
        if (!isCurrent) {
            if (existingSvg) existingSvg.remove();
            return;
        }

        if (!existingSvg) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'turn-urgency-svg');
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'turn-urgency-rect');
            rect.setAttribute('x', '2');
            rect.setAttribute('y', '2');
            rect.setAttribute('width', 'calc(100% - 4px)');
            rect.setAttribute('height', 'calc(100% - 4px)');
            svg.appendChild(rect);
            badgeEl.appendChild(svg);
            existingSvg = svg;
        }

        const rect = existingSvg.querySelector('.turn-urgency-rect');
        if (!rect) return;

        let isHuman = (actualPlayerIndex === mySeat && mySeat !== 99);
        if (isHuman && (this.engine.phase === 'BIDDING' || this.engine.phase === 'PLAYING')) {
            if (window.gsap) {
                gsap.killTweensOf(rect);
                rect.setAttribute('class', 'turn-urgency-rect');
                gsap.fromTo(rect, 
                    { strokeDashoffset: 0 },
                    { 
                        strokeDashoffset: 260, 
                        duration: 30, 
                        ease: "linear",
                        onUpdate: function() {
                            let prog = this.progress();
                            if (prog > 0.8) rect.setAttribute('class', 'turn-urgency-rect critical');
                            else if (prog > 0.6) rect.setAttribute('class', 'turn-urgency-rect warning');
                        }
                    }
                );
            }
        } else {
            if (window.gsap) {
                gsap.killTweensOf(rect);
                rect.setAttribute('class', 'turn-urgency-rect');
                gsap.fromTo(rect,
                    { strokeDashoffset: 0, opacity: 0.6 },
                    { strokeDashoffset: 120, opacity: 1, duration: 1.2, repeat: -1, yoyo: true, ease: "sine.inOut" }
                );
            }
        }
    }

    clearTrickWinnerHalo() {
        const positions = ['bottom', 'right', 'top', 'left'];
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`player-${positions[i]}`);
            if (!el) continue;
            const badge = el.querySelector('.player-badge');
            if (badge) {
                badge.classList.remove('trick-winner-halo-friend', 'trick-winner-halo-enemy');
            }
            const crown = el.querySelector('.seat-winner-crown');
            if (crown) crown.remove();
        }
        const winPill = document.getElementById('trick-winner-pill');
        if (winPill) winPill.style.display = 'none';
    }

    updateTrickWinnerHalo(winner) {
        if (!winner || !this.engine.trickCards || this.engine.trickCards.length === 0 || (this.engine.phase !== 'PLAYING' && this.engine.phase !== 'TRICK_OVER')) {
            this.clearTrickWinnerHalo();
            return;
        }

        const positions = ['bottom', 'right', 'top', 'left'];
        let visualPos = getVisualPosition(winner.player);
        let myTeam = (mySeat === 0 || mySeat === 2 || mySeat === 99) ? 1 : 2;
        let winTeam = (winner.player === 0 || winner.player === 2) ? 1 : 2;
        let isFriend = (winTeam === myTeam);
        let haloClass = isFriend ? 'trick-winner-halo-friend' : 'trick-winner-halo-enemy';

        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`player-${positions[i]}`);
            if (!el) continue;
            const badge = el.querySelector('.player-badge');
            if (!badge) continue;
            const existingCrown = badge.querySelector('.seat-winner-crown');
            if (existingCrown) existingCrown.remove();

            if (i === visualPos) {
                if (!badge.classList.contains(haloClass)) {
                    badge.classList.remove('trick-winner-halo-friend', 'trick-winner-halo-enemy');
                    badge.classList.add(haloClass);
                    if (window.gsap) {
                        gsap.fromTo(badge, { scale: 1.12 }, { scale: 1.04, duration: 0.28, ease: "back.out(1.8)" });
                    }
                }
            } else {
                badge.classList.remove('trick-winner-halo-friend', 'trick-winner-halo-enemy');
            }
        }
    }

    updateTrickHUD() {
        const pill = document.getElementById('trick-hud-pill');
        const ptsPill = document.getElementById('trick-pts-pill');
        const winPill = document.getElementById('trick-winner-pill');
        let t = I18N[currentLang];

        if (this.engine.phase === 'DEALING_1' || this.engine.phase === 'DEALING_2') {
            this.clearTrickWinnerHalo();
            if (winPill) winPill.style.display = 'none';
            let isRound2 = (this.engine.phase === 'DEALING_2');
            let dealText = isRound2 
                ? (currentLang === 'hi' ? '🎴 राउंड 2 के पत्ते बांटे जा रहे हैं...' : '🎴 Dealing Round 2 (4 Cards)...')
                : (currentLang === 'hi' ? '🎴 पहले 4 पत्ते बांटे जा रहे हैं...' : '🎴 Dealing 4 Cards...');
            if (pill) { pill.className = ''; pill.innerHTML = `<span>${dealText}</span>`; }
            if (ptsPill) ptsPill.innerHTML = `<span>💰 ${isRound2 ? (currentLang === 'hi' ? 'अंतिम राउंड' : 'Final Round') : (currentLang === 'hi' ? 'न्यूनतम बोली: 16' : 'Min Bid: 16')}</span>`;
            return;
        }

        if (this.engine.phase === 'BIDDING') {
            this.clearTrickWinnerHalo();
            if (winPill) winPill.style.display = 'none';
            let currentTurnName = this.playerNames[this.engine.currentTurn] || COMPASS_FULL[this.engine.currentTurn];
            let partnerIdx = mySeat === 99 ? 2 : (mySeat + 2) % 4;
            let isPartnerTurn = (this.engine.currentTurn === partnerIdx && mySeat !== 99);
            let isMyTurn = (this.engine.currentTurn === mySeat && mySeat !== 99);
            
            if (isMyTurn) {
                if (typeof showYourTurnBanner === 'function') showYourTurnBanner('🎯 YOUR TURN — Place Your Bid', 0);
            } else {
                if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner();
            }
            
            let highStr = this.engine.highestBidder === -1 ? t.minBid : `🎯 High: ${this.engine.currentBid} (${COMPASS_SHORT[this.engine.highestBidder]})`;
            if (ptsPill) ptsPill.innerHTML = `<span>${highStr}</span>`;
            return;
        }

        let ptsWord = (t && t.pts) ? t.pts : (currentLang === 'hi' ? 'अंक' : 'pts');
        let potLabel = (t && t.trickPot) ? t.trickPot : (currentLang === 'hi' ? 'चाल के अंक' : 'Trick Pot');

        if (this.engine.trickCards.length === 0) {
            this.clearTrickWinnerHalo();
            if (winPill) winPill.style.display = 'none';
            let leaderName = this.playerNames[this.engine.currentTurn];
            if (ptsPill) ptsPill.innerHTML = `<span>💰 ${potLabel}: 0 ${ptsWord}</span>`;
            // Show your-turn banner if it's human's lead
            if (this.engine.currentTurn === mySeat && mySeat !== 99) {
                if (typeof showYourTurnBanner === 'function') showYourTurnBanner('✨ YOUR TURN — Lead a Card', 0);
                if (typeof showKbdHintBar === 'function') showKbdHintBar();
            } else {
                if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner();
            }
        } else {
            let winner = this.engine._getCurrentTrickWinner();
            this.updateTrickWinnerHalo(winner);
            let pts = this.engine._countPointsInTrick();
            let myTeam = (mySeat === 0 || mySeat === 2 || mySeat === 99) ? 1 : 2;
            let winTeam = (winner.player === 0 || winner.player === 2) ? 1 : 2;
            let isUserTeam = (winTeam === myTeam);

            // Render Center Trick Winner Pill
            if (winPill && winner && winner.card) {
                let seatLabel = '';
                let dirFull = COMPASS_FULL[winner.player] || 'West';
                let dirLetter = COMPASS_SHORT[winner.player] || 'W';
                if (winner.player === mySeat && mySeat !== 99) {
                    seatLabel = currentLang === 'hi' ? `आप (${dirLetter})` : `You (${dirLetter})`;
                } else if (winner.player === (mySeat + 2) % 4 && mySeat !== 99) {
                    seatLabel = currentLang === 'hi' ? `साथी (${dirLetter})` : `Partner (${dirLetter})`;
                } else {
                    seatLabel = `${dirFull} (${dirLetter})`;
                }

                let isCardRed = (winner.card.suit === '♥' || winner.card.suit === '♦');
                let cardBadgeHTML = `<span class="trick-winner-card-badge" style="color:${isCardRed ? '#f87171' : '#fff'};">${winner.card.rank}${winner.card.suit}</span>`;

                winPill.className = `trick-winner-pill ${isUserTeam ? 'winner-user-team' : 'winner-opp-team'}`;
                winPill.innerHTML = `
                    <span>${isUserTeam ? '👑' : '⚔️'}</span>
                    <span>Winning: ${seatLabel}</span>
                    ${cardBadgeHTML}
                `;
                winPill.style.display = 'flex';
            }

            // Render Trick Pot & Led Suit pill
            let ledSuit = this.engine.leadSuit || (this.engine.trickCards[0] && this.engine.trickCards[0].card ? this.engine.trickCards[0].card.suit : '');
            let ledColor = (ledSuit === '♥' || ledSuit === '♦') ? '#f87171' : '#f8fafc';
            if (ptsPill) {
                ptsPill.innerHTML = `
                    <span>Led: <b style="color:${ledColor}; font-weight:800;">${ledSuit}</b></span>
                    <span style="opacity:0.4;">•</span>
                    <span>${potLabel}: <b>${pts}</b> ${ptsWord}</span>
                `;
            }

            // Show/hide banner based on whose turn it is mid-trick with context-aware void guidance
            if (this.engine.currentTurn === mySeat && mySeat !== 99) {
                let myHand = this.engine.players[mySeat] || [];
                let leadSuit = this.engine.leadSuit || (this.engine.trickCards[0] && this.engine.trickCards[0].card ? this.engine.trickCards[0].card.suit : null);
                let hasLead = leadSuit ? myHand.some(c => c && c.suit === leadSuit) : true;
                let canReveal = this.engine.canRevealTrump(mySeat);

                let turnMsg = '';
                if (!hasLead && leadSuit) {
                    turnMsg = (currentLang === 'hi')
                        ? `✨ आपकी बारी • ${leadSuit} नहीं है`
                        : `✨ YOUR TURN • Void in ${leadSuit}`;
                } else {
                    turnMsg = (currentLang === 'hi') ? '✨ आपकी बारी • चाल का रंग' : '✨ YOUR TURN • Follow Suit';
                }
                if (typeof showYourTurnBanner === 'function') showYourTurnBanner(turnMsg, 0);
            } else {
                if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner();
            }
        }

        // Update Lead Suit Watermark on center felt
        const watermark = document.getElementById('lead-suit-watermark');
        if (watermark) {
            if (this.engine.trickCards.length > 0 && this.engine.leadSuit) {
                let s = this.engine.leadSuit;
                let isRed = (s === '♥' || s === '♦');
                let hasTrumpCut = this.engine.trumpRevealed && this.engine.trickCards.some(tc => tc.card && tc.card.suit === this.engine.trumpSuit && tc.card.suit !== this.engine.leadSuit);
                watermark.className = `visible ${hasTrumpCut ? 'trump-cut-active' : ''}`;
                watermark.innerHTML = `
                    <div class="lead-watermark-symbol ${isRed ? 'red' : 'black'}">${s}</div>
                `;
            } else {
                watermark.className = '';
                watermark.innerHTML = '';
            }
        }
    }

    renderStaticBoard() {
        if(this.animatingTrick) return; 
        if (typeof updateScreenMetrics === 'function') updateScreenMetrics();
        updateTopCompassBar();

        // Dismiss lingering bid popups and splashes on turn change
        if (this.engine.phase === 'BIDDING') {
            document.querySelectorAll('.floating-seat-bid').forEach(el => {
                let badge = el.closest('.player-badge');
                if (badge && badge.classList.contains('active-turn')) {
                    el.remove();
                }
            });
            const splash = document.getElementById('partner-bid-splash');
            if (splash && this.engine.currentTurn !== 2) {
                splash.classList.remove('show');
            }
        }

        let showT1First = (mySeat === 0 || mySeat === 2 || mySeat === 99);
        document.getElementById('t1-game-pts').innerHTML = this.generateGamePointsHTML(showT1First ? this.engine.t1GamePts : this.engine.t2GamePts);
        document.getElementById('t2-game-pts').innerHTML = this.generateGamePointsHTML(showT1First ? this.engine.t2GamePts : this.engine.t1GamePts);

        this.updateNumberAnim('t1-trick-pts', showT1First ? this.engine.t1TrickPts : this.engine.t2TrickPts);
        this.updateNumberAnim('t2-trick-pts', showT1First ? this.engine.t2TrickPts : this.engine.t1TrickPts);
        
        const t1Target = document.getElementById('t1-bid-target');
        const t2Target = document.getElementById('t2-bid-target');
        document.getElementById('pair-badge').style.display = this.engine.pairDeclared ? 'inline-block' : 'none';
        
        if (this.engine.highestBidder !== -1) {
            let bidTeam = (this.engine.highestBidder === mySeat || this.engine.highestBidder === (mySeat+2)%4) ? 1 : 2;
            if(mySeat === 99) bidTeam = (this.engine.highestBidder === 0 || this.engine.highestBidder === 2) ? 1 : 2;
            
            if (bidTeam === 1) { t1Target.style.display = 'inline-block'; t1Target.innerText = `🎯 ${this.engine.currentBid}`; t2Target.style.display = 'none'; } 
            else { t2Target.style.display = 'inline-block'; t2Target.innerText = `🎯 ${this.engine.currentBid}`; t1Target.style.display = 'none'; }
        } else {
            t1Target.style.display = 'none'; t2Target.style.display = 'none';
        }

        let t = I18N[currentLang];
        if (this.engine.phase === 'DEALING_1' || this.engine.phase === 'DEALING_2') {
            let isRound2 = (this.engine.phase === 'DEALING_2');
            document.getElementById('bid-status').innerText = isRound2 
                ? (currentLang === 'hi' ? 'अंतिम राउंड' : 'Final Round') 
                : (currentLang === 'hi' ? 'न्यूनतम बोली: 16' : 'Min Bid: 16');
            document.getElementById('trump-status').innerText = isRound2
                ? (currentLang === 'hi' ? 'चरण 2 • 4 पत्ते' : 'Phase 2 • Dealing 4 Cards')
                : (currentLang === 'hi' ? 'चरण 1 • 4 पत्ते' : 'Phase 1 • Dealing 4 Cards');
        } else if (this.engine.phase === 'BIDDING') {
            document.getElementById('bid-status').innerText = this.engine.highestBidder === -1 ? t.bidding : `BID: ${this.engine.currentBid} (${COMPASS_SHORT[this.engine.highestBidder]})`;
            document.getElementById('trump-status').innerText = t.phase1;
        } else if (this.engine.highestBidder !== -1) {
            document.getElementById('bid-status').innerText = `${this.engine.currentBid} (${COMPASS_SHORT[this.engine.highestBidder]})`;
            if (this.engine.trumpRevealed) {
                const tpEl = document.getElementById('trump-status');
                if (tpEl) {
                    const suit = this.engine.trumpSuit || '♠';
                    const suitColor = (suit === '♥' || suit === '♦') ? '#ef4444' : '#38bdf8';
                    tpEl.style.display = 'inline-block';
                    tpEl.innerHTML = `${t.trump}: <span style="color:${suitColor}; font-size:0.95rem; font-weight:bold;">${suit}</span>`;
                }
            } else if (mySeat === this.engine.highestBidder && this.engine.trumpSuit) {
                const suit = this.engine.trumpSuit; const suitColor = (suit === '♥' || suit === '♦') ? '#ef4444' : '#38bdf8';
                const tpEl = document.getElementById('trump-status');
                if (tpEl) {
                    tpEl.style.display = 'inline-block';
                    tpEl.innerHTML = `${t.trump}: <span style="color:${suitColor}; font-size:0.95rem; font-weight:bold;">${suit}</span> (${currentLang === 'hi' ? 'गुप्त' : 'Secret'})`;
                }
            } else {
                const tpEl = document.getElementById('trump-status');
                if (tpEl) {
                    tpEl.style.display = 'inline-block';
                    tpEl.innerText = t.secretTrump;
                }
            }
        }

        const positions = ['bottom', 'right', 'top', 'left'];
        let userValidPlays = (this.engine.phase === 'PLAYING' && this.engine.currentTurn === mySeat && mySeat !== 99) ? this.engine.getValidPlayIndices(mySeat) : [];

        for (let i = 0; i < 4; i++) {
            let actualPlayerIndex = getPlayerAtVisualPosition(i);
            const el = document.getElementById(`player-${positions[i]}`);
            if (!el) continue;
            
            let isMe = (actualPlayerIndex === mySeat && mySeat !== 99);
            let isPartner = (actualPlayerIndex === (mySeat + 2) % 4 && mySeat !== 99);
            let badgeClass = isPartner ? 'player-badge partner' : (isMe ? 'player-badge' : 'player-badge enemy');
            let isDealing = (this.engine.phase === 'DEALING_1' || this.engine.phase === 'DEALING_2');
            let isCurrent = (actualPlayerIndex === this.engine.currentTurn && this.engine.phase !== 'ROUND_OVER' && !isDealing);
            if (isCurrent) badgeClass += ' active-turn'; 

            let bidderCrown = (actualPlayerIndex === this.engine.highestBidder) ? ' 🎯' : '';
            let cardCount = (this.engine.players[actualPlayerIndex] || []).length;
            let partnerIdx = (mySeat === 99) ? 2 : (mySeat + 2) % 4;

            // Partner or player bid badge during bidding phase
            let bidBadge = '';
            if (this.engine.phase === 'BIDDING' && this.engine.playerBids && this.engine.playerBids[actualPlayerIndex] !== null && this.engine.playerBids[actualPlayerIndex] !== undefined) {
                let bVal = this.engine.playerBids[actualPlayerIndex];
                let isPass = bVal === 'Pass';
                let isP = (actualPlayerIndex === partnerIdx);
                let badgeText = isPass ? t.partnerPassed : `${t.bidding} ${bVal}`;
                bidBadge = `<div class="seat-bid-pill ${isP ? 'partner' : ''}">${isP ? '🤝 ' : ''}${badgeText}</div>`;
            }

            let cardStartIndex = (this.engine.phase === 'DEALING_2') ? 4 : 0;
            let displayedCount = this.isDealingState ? cardStartIndex : cardCount;

            const activeBubble = el.querySelector('.speech-bubble');
            const activeFloatBid = el.querySelector('.floating-seat-bid');
            el.innerHTML = `<div class="${badgeClass}">${this.playerNames[actualPlayerIndex]}${bidderCrown} <span class="card-cnt" id="badge-cnt-${actualPlayerIndex}">${displayedCount}</span></div>${bidBadge}`; 
            const badgeEl = el.querySelector('.player-badge');
            if (activeBubble) el.appendChild(activeBubble);
            if (activeFloatBid && badgeEl) badgeEl.appendChild(activeFloatBid);
            if (badgeEl) this.updateTurnUrgencyRing(badgeEl, isCurrent, actualPlayerIndex);
            
            if (actualPlayerIndex === mySeat && mySeat !== 99) {
                const row = document.createElement('div');
                row.className = 'my-cards-row';
                let total = (this.engine.players[mySeat] || []).length;
                if (total >= 5) row.classList.add('dense-hand');
                let mid = (total - 1) / 2;
                let isMobile = window.innerWidth <= 680 || (window.innerWidth / window.innerHeight < 1.05 && window.innerWidth <= 820);
                let isShort = window.innerHeight < 600;
                let degMultiplier = isMobile ? (isShort ? 1.6 : 2.2) : 2.8;
                let yLiftMultiplier = isMobile ? (isShort ? 0.8 : 1.3) : 1.8;

                (this.engine.players[mySeat] || []).forEach((card, index) => {
                    const isMyTurnToPlay = (this.engine.phase === 'PLAYING' && this.engine.currentTurn === mySeat && !uiLocked);
                    const isPlayable = isMyTurnToPlay && userValidPlays.includes(index);
                    const div = document.createElement('div');
                    div.className = `card ${card.suit === '♥' || card.suit === '♦' ? 'red' : 'black'}`;
                    div.dataset.seat = actualPlayerIndex;
                    div.dataset.cardIdx = index;

                    let offset = index - mid;
                    let deg = offset * degMultiplier;
                    let yLift = Math.abs(offset) * yLiftMultiplier;
                    div.style.setProperty('--rot', `${deg}deg`);
                    div.style.setProperty('--y-lift', `${yLift}px`);
                    div.style.transform = `rotate(var(--rot)) translateY(var(--y-lift))`;
                    div.style.zIndex = index + 10;

                    if (this.isDealingState && index >= cardStartIndex) {
                        // Keep incoming round 2 cards invisible until their specific flyer arrives
                        div.style.visibility = 'hidden';
                        div.style.opacity = '0';
                    }

                    let ptBadge = card.value > 0 ? `<div class="card-pt-badge">+${card.value}</div>` : '';

                    div.innerHTML = `
                        ${ptBadge}
                        <div class="card-corner"><span>${card.rank}</span><span class="corner-suit">${card.suit}</span></div>
                        <div class="card-center-suit">${card.suit}</div>
                        <div class="card-corner bottom"><span>${card.rank}</span><span class="corner-suit">${card.suit}</span></div>
                    `;

                    if (isMyTurnToPlay && !isPlayable) div.classList.add('unplayable');
                    if (isPlayable) {
                        div.classList.add('playable');
                        this.attachDragAndFlick(div, index, actualPlayerIndex);
                        // Keyboard index hint overlay
                        const kbdHint = document.createElement('div');
                        kbdHint.className = 'card-kbd-hint';
                        kbdHint.textContent = String(index + 1);
                        div.appendChild(kbdHint);
                    }
                    // Trump glow after reveal
                    if (this.engine.trumpRevealed && card.suit === this.engine.trumpSuit) {
                        div.classList.add('is-trump-card');
                    }
                    row.appendChild(div);
                });
                this.attachMagneticScrub(row);
                el.appendChild(row);
            } else {
                const row = document.createElement('div');
                row.className = 'opp-cards-row';
                for(let c=0; c<cardCount; c++) {
                    const div = document.createElement('div');
                    div.className = `card card-back`; 
                    div.dataset.seat = actualPlayerIndex;
                    div.dataset.cardIdx = c;
                    if (this.isDealingState && c >= cardStartIndex) {
                        div.style.visibility = 'hidden';
                        div.style.opacity = '0';
                    }
                    row.appendChild(div);
                }
                el.appendChild(row);
            }
        }

        // Initialize 3D tilt sheen on player cards
        setTimeout(() => {
            initVanillaTilt();
        }, 50);

        this.updateTrickHUD();
        this.updateSecretTrumpVault();
        if (document.getElementById('tracker-drawer')?.classList.contains('open')) {
            this.updateTrackerUI();
        }
    }

    playHumanDealAnimation(onComplete) {
        const board = document.getElementById('board');
        if (!board) { if (onComplete) onComplete(); return; }

        this.clearActiveDealAnimation();
        const dealToken = this._dealAnimSeq;
        this.dealFlyerTimers = [];

        let dealLayer = document.getElementById('deal-layer');
        if (!dealLayer) {
            dealLayer = document.createElement('div');
            dealLayer.id = 'deal-layer';
            dealLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none; z-index:125; overflow:hidden;';
            board.appendChild(dealLayer);
        }
        dealLayer.innerHTML = '';

        const startDealingFlyers = () => {
            if (dealToken !== this._dealAnimSeq) return;
        // 1. Spawn 3D Center Dealer Deck (anchored with xPercent/yPercent)
        const deckEl = document.createElement('div');
        deckEl.className = 'dealer-deck';
        let badgeText = this.engine.phase === 'DEALING_2' ? (currentLang === 'hi' ? 'अंतिम राउंड' : 'Final Round') : (currentLang === 'hi' ? 'न्यूनतम बोली: 16' : 'Min Bid: 16');
        deckEl.innerHTML = `<div class="dealer-deck-badge">${badgeText}</div>`;
        dealLayer.appendChild(deckEl);

        if (window.gsap) {
            gsap.fromTo(deckEl, 
                { xPercent: -50, yPercent: -50, scale: 0.6, opacity: 0, rotation: -8 },
                { xPercent: -50, yPercent: -50, scale: 1, opacity: 1, rotation: 0, duration: 0.28, ease: "back.out(1.5)" }
            );
        }

        // 2. Identify seat positions relative to board
        const positions = ['bottom', 'right', 'top', 'left'];
        const boardRect = board.getBoundingClientRect();
        const centerOriginX = boardRect.width * 0.5;
        const tableCenterRatio = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--table-center-y')) / 100) || (window.innerWidth <= 680 ? 0.48 : 0.42);
        const centerOriginY = boardRect.height * tableCenterRatio;

        const seatTargets = [];
        for (let i = 0; i < 4; i++) {
            let actualPlayerIndex = getPlayerAtVisualPosition(i);
            const el = document.getElementById(`player-${positions[i]}`);
            let destX = 0, destY = 0;
            if (el) {
                const r = el.getBoundingClientRect();
                destX = (r.left + r.width / 2) - boardRect.left - centerOriginX;
                destY = (r.top + r.height / 2) - boardRect.top - centerOriginY;
            } else {
                if (i === 0) destY = boardRect.height * 0.45;
                else if (i === 1) destX = boardRect.width * 0.42;
                else if (i === 2) destY = -boardRect.height * 0.35;
                else if (i === 3) destX = -boardRect.width * 0.42;
            }
            seatTargets.push({ visualPos: i, actualPlayerIndex, destX, destY });
        }

        // 3. Build human clockwise dealing sequence (4 rounds x 4 seats = 16 cards)
        let cardStartIndex = (this.engine.phase === 'DEALING_2') ? 4 : 0;
        let cardInterval = 0.08;
        let cardFlightDuration = 0.32;
        let isMobile = window.innerWidth <= 680;
        let totalCardsInHand = (this.engine.phase === 'DEALING_2') ? 8 : 4;
        let mid = (totalCardsInHand - 1) / 2;

        for (let round = 0; round < 4; round++) {
            for (let s = 0; s < 4; s++) {
                let seatInfo = seatTargets[s];
                let cardIndex = cardStartIndex + round;
                let dealDelay = (round * 4 + s) * cardInterval + 0.15;

                let fTimer = setTimeout(() => {
                    if (dealToken !== this._dealAnimSeq) return;
                    const flyer = document.createElement('div');
                    let isMe = (seatInfo.actualPlayerIndex === mySeat && mySeat !== 99);

                    // Locate destination card slot in the seat's DOM hand
                    const targetCardEl = document.querySelector(`[data-seat="${seatInfo.actualPlayerIndex}"][data-card-idx="${cardIndex}"]`);
                    let destX = seatInfo.destX;
                    let destY = seatInfo.destY;
                    let endRot = 0;

                    if (targetCardEl) {
                        const targetRect = targetCardEl.getBoundingClientRect();
                        destX = (targetRect.left + targetRect.width / 2) - boardRect.left - centerOriginX;
                        destY = (targetRect.top + targetRect.height / 2) - boardRect.top - centerOriginY;
                    }

                    if (isMe) {
                        let myCards = this.engine.players[mySeat] || [];
                        let cardData = myCards[cardIndex] || { rank: '?', suit: '♠', value: 0 };
                        let isRed = (cardData.suit === '♥' || cardData.suit === '♦' || cardData.suit === 'hearts' || cardData.suit === 'diamonds');
                        let ptBadge = cardData.value > 0 ? `<div class="card-pt-badge">+${cardData.value}</div>` : '';
                        flyer.className = `card dealing-card-flyer ${isRed ? 'red' : 'black'}`;
                        flyer.innerHTML = `
                            ${ptBadge}
                            <div class="card-corner"><span>${cardData.rank}</span><span class="corner-suit">${cardData.suit}</span></div>
                            <div class="card-center-suit">${cardData.suit}</div>
                            <div class="card-corner bottom"><span>${cardData.rank}</span><span class="corner-suit">${cardData.suit}</span></div>
                        `;
                        let offset = cardIndex - mid;
                        let isShortScreen = window.innerHeight < 600;
                        endRot = offset * (isMobile ? (isShortScreen ? 1.6 : 2.2) : 2.8);
                    } else {
                        flyer.className = 'card card-back dealing-card-flyer opp-flyer';
                        endRot = (seatInfo.visualPos === 1 ? 6 : (seatInfo.visualPos === 3 ? -6 : 0)) + (Math.random() - 0.5) * 4;
                    }

                    dealLayer.appendChild(flyer);

                    // Soft deal slide audio & dealer deck recoil
                    playSound('deal');
                    if (window.gsap) {
                        gsap.fromTo(deckEl, 
                            { xPercent: -50, yPercent: -50, scale: 0.96 }, 
                            { xPercent: -50, yPercent: -50, scale: 1, duration: 0.08, ease: "power1.out" }
                        );
                    }

                    // Seamless transition: reveal card in hand the instant flyer lands
                    const onCardLanded = () => {
                        if (targetCardEl) {
                            targetCardEl.style.visibility = 'visible';
                            targetCardEl.style.opacity = '1';
                            targetCardEl.style.transform = 'translate3d(0, 0, 0)';
                            if (window.gsap) {
                                gsap.fromTo(targetCardEl,
                                    { scale: 1.08 },
                                    { scale: 1, duration: 0.18, ease: "power2.out", onComplete: () => {
                                        targetCardEl.style.transform = 'translate3d(0, 0, 0)';
                                    }}
                                );
                            }
                        }
                        const badgeCnt = document.getElementById(`badge-cnt-${seatInfo.actualPlayerIndex}`);
                        if (badgeCnt) badgeCnt.textContent = cardIndex + 1;
                        flyer.remove();
                    };

                    if (window.gsap) {
                        gsap.fromTo(flyer,
                            { 
                                xPercent: -50, 
                                yPercent: -50, 
                                x: 0, 
                                y: 0, 
                                scale: 0.85, 
                                rotation: (Math.random() - 0.5) * 8, 
                                opacity: 0.95 
                            },
                            { 
                                xPercent: -50, 
                                yPercent: -50, 
                                x: destX, 
                                y: destY, 
                                scale: 1, 
                                rotation: endRot, 
                                opacity: 1, 
                                duration: cardFlightDuration, 
                                ease: "power2.out",
                                onComplete: onCardLanded
                            }
                        );
                    } else {
                        setTimeout(onCardLanded, 350);
                    }
                }, dealDelay * 1000);
                this.dealFlyerTimers.push(fTimer);
            }
        }

        // 4. Wrap up: Fade out dealer deck and settle cards in hand
        let totalDuration = (16 * cardInterval + cardFlightDuration + 0.25) * 1000;
        let wrapTimer = setTimeout(() => {
            if (dealToken !== this._dealAnimSeq) return;
            if (window.gsap) {
                gsap.to(deckEl, {
                    xPercent: -50,
                    yPercent: -50,
                    scale: 0.7,
                    opacity: 0,
                    duration: 0.22,
                    ease: "power2.in",
                    onComplete: () => {
                        if (dealToken !== this._dealAnimSeq) return;
                        dealLayer.innerHTML = '';
                        document.querySelectorAll('[data-seat]').forEach(c => {
                            c.style.visibility = 'visible';
                            c.style.opacity = '1';
                            if (c.classList.contains('card-back')) {
                                c.style.transform = 'translate3d(0, 0, 0)';
                            }
                        });
                        for (let i = 0; i < 4; i++) {
                            const b = document.getElementById(`badge-cnt-${i}`);
                            if (b) b.textContent = (this.engine.players[i] || []).length;
                        }
                        if (onComplete) onComplete();
                    }
                });
            } else {
                if (dealToken !== this._dealAnimSeq) return;
                dealLayer.innerHTML = '';
                document.querySelectorAll('[data-seat]').forEach(c => {
                    c.style.visibility = 'visible';
                    c.style.opacity = '1';
                });
                for (let i = 0; i < 4; i++) {
                    const b = document.getElementById(`badge-cnt-${i}`);
                    if (b) b.textContent = (this.engine.players[i] || []).length;
                }
                if (onComplete) onComplete();
            }
        }, totalDuration);
        this.dealFlyerTimers.push(wrapTimer);
        };

        if (this.engine.phase === 'DEALING_1') {
            this.playRiffleShuffleAnimation(dealLayer, () => {
                if (dealToken !== this._dealAnimSeq) return;
                startDealingFlyers();
            });
        } else {
            startDealingFlyers();
        }
    }

    renderPlayedCard(card, pIndex, delaySec = 0) {
        const table = document.getElementById('center-table');
        if (!table) return;
        const div = document.createElement('div');
        let visualPos = getVisualPosition(pIndex);
        let partnerClass = (pIndex === (mySeat + 2) % 4 && mySeat !== 99) ? 'partner-card' : '';
        let ptBadge = card.value > 0 ? `<div class="card-pt-badge">+${card.value}</div>` : '';
        let isRed = (card.suit === '♥' || card.suit === '♦' || card.suit === 'hearts' || card.suit === 'diamonds');
        
        const seatKeys = ['S', 'E', 'N', 'W'];
        div.className = `card trick-card pos-${visualPos} ${partnerClass} ${isRed ? 'red' : 'black'}`;
        div.setAttribute('data-seat', seatKeys[visualPos]);
        let baseZ = visualPos === 2 ? 10 : (visualPos === 1 ? 20 : (visualPos === 0 ? 30 : 15));
        div.style.zIndex = baseZ;
        div.style.opacity = '1';
        div.style.visibility = 'visible';
        div.innerHTML = `
            ${ptBadge}
            <div class="card-corner"><span>${card.rank}</span><span class="corner-suit">${card.suit}</span></div>
            <div class="card-center-suit">${card.suit}</div>
            <div class="card-corner bottom"><span>${card.rank}</span><span class="corner-suit">${card.suit}</span></div>
        `;
        table.appendChild(div);

        // 4-Point Directional Cross Fan: Wide non-overlapping diamond offset
        // East starts at +40px, clear of North's card, keeping all top-left corner indices 100% visible
        if (window.gsap) {
            gsap.set(div, { xPercent: -50, yPercent: -50 });

            const rect = div.getBoundingClientRect();
            const cardW = rect.width || 68;
            const cardH = rect.height || 96;
            const offsetX = Math.round(cardW * 0.55);
            const offsetY = Math.round(cardH * 0.42);

            let startX = 0, startY = 0;
            let endX = 0, endY = 0, endRot = 0;

            if (visualPos === 0) {
                // South (Bottom / You): (0, +0.42 * cardHeight), zIndex 30
                startX = (Math.random() - 0.5) * 4;
                startY = offsetY + 14;
                endX = 0;
                endY = offsetY;
                endRot = (Math.random() - 0.5) * 2;
            } else if (visualPos === 1) {
                // East (Right): (+0.55 * cardWidth, 0), zIndex 20
                startX = offsetX + 12;
                startY = (Math.random() - 0.5) * 4;
                endX = offsetX;
                endY = 0;
                endRot = 4 + (Math.random() - 0.5) * 2;
            } else if (visualPos === 2) {
                // North (Top / Partner): (0, -0.42 * cardHeight), zIndex 10
                startX = (Math.random() - 0.5) * 4;
                startY = -(offsetY + 14);
                endX = 0;
                endY = -offsetY;
                endRot = -1 + (Math.random() - 0.5) * 2;
            } else if (visualPos === 3) {
                // West (Left): (-0.55 * cardWidth, 0), zIndex 15
                startX = -(offsetX + 12);
                startY = (Math.random() - 0.5) * 4;
                endX = -offsetX;
                endY = 0;
                endRot = -4 + (Math.random() - 0.5) * 2;
            }

            let startRot = endRot + (Math.random() - 0.5) * 4;

            gsap.fromTo(div, 
                { 
                    xPercent: -50,
                    yPercent: -50,
                    x: startX, 
                    y: startY, 
                    scale: 1.06, 
                    rotation: startRot, 
                    opacity: 0.85,
                    boxShadow: "0 10px 22px rgba(0,0,0,0.5)"
                },
                { 
                    xPercent: -50,
                    yPercent: -50,
                    x: endX, 
                    y: endY, 
                    scale: 1, 
                    rotation: endRot, 
                    opacity: 1, 
                    duration: 0.45, 
                    delay: delaySec, 
                    ease: "power2.out", 
                    boxShadow: "0 4px 10px rgba(0,0,0,0.6)",
                    onComplete: () => {
                        div.style.opacity = '1';
                        div.style.visibility = 'visible';
                    }
                }
            );

            // Subtle gold sheen when placing high-point master honors (Jack=3, 9=2)
            if (card.value >= 2) {
                gsap.to(div, {
                    boxShadow: "0 0 16px rgba(229, 193, 88, 0.7), 0 4px 12px rgba(0,0,0,0.6)",
                    duration: 0.35,
                    yoyo: true,
                    repeat: 1,
                    delay: 0.15
                });
            }

            // Dramatic luminous flare when cutting with Trump (GPU filter)
            let isTrump = (this.engine.trumpRevealed && card.suit === this.engine.trumpSuit);
            if (isTrump) {
                let trumpGlow = (card.suit === '♥' || card.suit === '♦') ? 'rgba(239, 68, 68, 0.9)' : 'rgba(56, 189, 248, 0.9)';
                gsap.fromTo(div,
                    { filter: `drop-shadow(0 0 16px ${trumpGlow})` },
                    { filter: 'drop-shadow(0 0 0px transparent)', duration: 0.85, ease: "power1.out", delay: 0.1 }
                );
            }
        }
        if (card.value > 0 && window.gsap) {
            const board = document.getElementById('board');
            const potPill = document.getElementById('trick-pts-pill');
            if (board && potPill) {
                const floatCoin = document.createElement('div');
                floatCoin.className = 'pot-coin-float';
                floatCoin.innerText = `+${card.value}`;
                board.appendChild(floatCoin);

                const cardRect = div.getBoundingClientRect();
                const boardRect = board.getBoundingClientRect();
                const potRect = potPill.getBoundingClientRect();

                const startX = cardRect.left + cardRect.width / 2 - boardRect.left;
                const startY = cardRect.top + cardRect.height / 2 - boardRect.top;
                const endX = potRect.left + potRect.width / 2 - boardRect.left;
                const endY = potRect.top + potRect.height / 2 - boardRect.top;

                gsap.fromTo(floatCoin,
                    { left: startX, top: startY, scale: 1.35, opacity: 1, xPercent: -50, yPercent: -50 },
                    {
                        left: endX,
                        top: endY,
                        scale: 0.75,
                        opacity: 0,
                        duration: 0.52,
                        ease: "power2.in",
                        delay: 0.22 + delaySec,
                        onComplete: () => {
                            floatCoin.remove();
                            potPill.classList.add('pot-punch');
                            setTimeout(() => potPill.classList.remove('pot-punch'), 300);
                            this.updateTrickHUD();
                        }
                    }
                );
            }
        }
        playSound('play');
        this.updateTrickHUD();
        if (document.getElementById('tracker-drawer')?.classList.contains('open')) {
            this.updateTrackerUI();
        }
    }

    syncTable() {
        if(this.animatingTrick) return;
        const table = document.getElementById('center-table'); 
        if (!table) return;
        if (this.engine.trickCards.length === 0) {
            table.innerHTML = '';
            return;
        }
        while (table.children.length > this.engine.trickCards.length) {
            table.removeChild(table.lastChild);
        }
        let staggerCount = 0;
        while (table.children.length < this.engine.trickCards.length) {
            let indexToRender = table.children.length;
            let play = this.engine.trickCards[indexToRender];
            if (play) {
                this.renderPlayedCard(play.card, play.player, staggerCount * 0.28);
                staggerCount++;
            }
        }
    }

    playRoyalPairAnimation(pIndex, onComplete) {
        triggerHaptic('pair');
        const splash = document.getElementById('royal-pair-splash');
        if (!splash) {
            if (onComplete) onComplete();
            return;
        }

        let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;
        let pName = (pIndex === mySeat && mySeat !== 99) 
            ? (currentLang === 'hi' ? 'आपने' : 'You')
            : (this.playerNames[pIndex] || COMPASS_FULL[pIndex] || `Player ${pIndex}`);

        let team = (pIndex === 0 || pIndex === 2) ? 1 : 2;
        let biddingTeam = (this.engine.highestBidder === 0 || this.engine.highestBidder === 2) ? 1 : 2;
        let isBiddingTeam = (team === biddingTeam);

        let suit = this.engine.trumpSuit || '♥';
        let isRed = (suit === '♥' || suit === '♦');
        let suitColor = isRed ? '#ef4444' : '#38bdf8';

        let oldBid = this.engine.currentBid;
        // Rule: Contract cannot drop below 16
        let newBid = isBiddingTeam ? Math.max(16, oldBid - 4) : Math.min(28, oldBid + 4);
        let diff = Math.abs(newBid - oldBid);

        let deltaText = '';
        if (isBiddingTeam) {
            if (diff > 0) {
                deltaText = (currentLang === 'hi') 
                    ? `🎯 लक्ष्य घटाया: ${oldBid} ➔ ${newBid} (-${diff} अंक)`
                    : `🎯 Target Reduced: ${oldBid} ➔ ${newBid} (-${diff} pts)`;
            } else {
                deltaText = (currentLang === 'hi')
                    ? `🎯 न्यूनतम सीमा: लक्ष्य 16 अंक पर बरकरार`
                    : `🎯 Minimum Ceiling: Target remains 16 pts`;
            }
        } else {
            deltaText = (currentLang === 'hi')
                ? `🛡️ डिफेंडर बोनस! लक्ष्य बढ़ा: ${oldBid} ➔ ${newBid} (+${diff} अंक)`
                : `🛡️ Defense Bonus! Target Raised: ${oldBid} ➔ ${newBid} (+${diff} pts)`;
        }

        let titleText = (currentLang === 'hi') ? '👑 रॉयल K-Q जोड़ी घोषित!' : '👑 ROYAL K-Q PAIR DECLARED!';
        let subText = (currentLang === 'hi') 
            ? `${pName} ने हुकुम (${suit}) की राजा-रानी जोड़ी घोषित की!` 
            : `${pName} declared King & Queen of Trumps (${suit})!`;

        splash.innerHTML = `
            <div style="font-size:2.4rem; filter:drop-shadow(0 0 12px rgba(229,193,88,0.8)); margin-bottom:2px;">👑</div>
            <div style="font-family:'Cinzel',serif; font-size:clamp(1.1rem, 2.4vh, 1.35rem); font-weight:900; color:var(--gold-bright); letter-spacing:1px; text-shadow:0 0 16px var(--gold-glow); margin-bottom:4px;">
                ${titleText}
            </div>
            <div style="font-size:clamp(0.74rem, 1.6vh, 0.85rem); color:#cbd5e1; font-weight:700; margin-bottom:12px;">
                ${subText}
            </div>

            <!-- Two Cards: King and Queen of Trumps side-by-side -->
            <div style="display:flex; justify-content:center; gap:14px; margin-bottom:14px;">
                <div class="pair-card-preview ${isRed ? 'red' : 'black'}">
                    <div style="font-size:0.75rem; font-weight:900; line-height:1;">K<br>${suit}</div>
                    <div style="font-size:1.7rem; line-height:1; color:${suitColor};">👑</div>
                    <div style="font-size:0.75rem; font-weight:900; line-height:1; transform:rotate(180deg);">K<br>${suit}</div>
                </div>
                <div class="pair-card-preview ${isRed ? 'red' : 'black'}">
                    <div style="font-size:0.75rem; font-weight:900; line-height:1;">Q<br>${suit}</div>
                    <div style="font-size:1.7rem; line-height:1; color:${suitColor};">👸</div>
                    <div style="font-size:0.75rem; font-weight:900; line-height:1; transform:rotate(180deg);">Q<br>${suit}</div>
                </div>
            </div>

            <div style="display:inline-block; padding:6px 16px; border-radius:20px; font-weight:800; font-size:clamp(0.76rem, 1.6vh, 0.88rem); background:rgba(229,193,88,0.18); border:1.5px solid var(--gold-primary); color:var(--gold-bright); box-shadow:0 0 16px rgba(229,193,88,0.3);">
                ${deltaText}
            </div>
        `;

        splash.style.display = 'flex';
        playSound('pair');

        if (typeof showGameToast === 'function') {
            showGameToast(`👑 ${pName} declared Royal K-Q Pair! (${deltaText})`, 3400);
        }

        if (window.confetti) {
            confetti({
                particleCount: 50,
                spread: 70,
                origin: { y: 0.5 },
                colors: ['#e5c158', '#f59e0b', '#ffffff', '#38bdf8']
            });
        }

        if (window.gsap) {
            gsap.killTweensOf(splash);
            gsap.fromTo(splash,
                { scale: 0.3, opacity: 0, xPercent: -50, yPercent: -50 },
                { scale: 1, opacity: 1, xPercent: -50, yPercent: -50, duration: 0.38, ease: "back.out(1.5)" }
            );

            let holdDuration = Math.round(1900 * speedMult);
            setTimeout(() => {
                gsap.to(splash, {
                    scale: 0.85,
                    opacity: 0,
                    duration: 0.25,
                    ease: "power2.in",
                    onComplete: () => {
                        splash.style.display = 'none';
                        if (onComplete) onComplete();
                    }
                });
            }, holdDuration);
        } else {
            setTimeout(() => {
                splash.style.display = 'none';
                if (onComplete) onComplete();
            }, Math.round(1900 * speedMult));
        }
    }

    playTrumpRevealAnimation(suit) {
        triggerHaptic('reveal');
        this.animatingReveal = true;
        const blast = document.getElementById('dramatic-reveal');
        if (!blast) {
            this.animatingReveal = false;
            this.gameLoop();
            return;
        }

        try {
            let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;
            let caller = (this.engine.justRevealedBy >= 0) ? this.engine.justRevealedBy : (this.engine.justRevealedByPlayer >= 0 ? this.engine.justRevealedByPlayer : 0);
            let callerName = (caller === 0) ? (currentLang === 'hi' ? 'आपने' : 'You') : (this.playerNames[caller] || COMPASS_FULL[caller] || 'Opponent');
            if (typeof showGameToast === 'function') {
                showGameToast(`🚨 ${callerName} revealed Trump: ${suit}!`, 3000);
            }
            let isRed = (suit === '♥' || suit === '♦' || suit === 'hearts' || suit === 'diamonds');
            let suitColor = isRed ? '#ef4444' : '#38bdf8';
            let suitName = suit;
            if (typeof SUIT_FULL_NAMES !== 'undefined' && SUIT_FULL_NAMES[suit]) {
                suitName = SUIT_FULL_NAMES[suit][currentLang] || SUIT_FULL_NAMES[suit].en || suit;
            } else if (typeof I18N !== 'undefined' && I18N[currentLang] && I18N[currentLang].suits && I18N[currentLang].suits[suit]) {
                suitName = I18N[currentLang].suits[suit];
            }

            let callerText = (currentLang === 'hi') ? `${callerName} ने हुकुम खोलने की मांग की!` : `${callerName} calls for Secret Trump!`;
            let bannerText = (currentLang === 'hi') ? `गुप्त हुकुम खुला: ${suitName}` : `SECRET TRUMP REVEALED: ${suitName}`;

            blast.innerHTML = `
                <div id="trump-reveal-caller-tag" style="font-size:clamp(0.68rem, 1.6vh, 0.78rem); color:#94a3b8; font-weight:700; margin-bottom:4px; letter-spacing:1px; text-transform:uppercase;">${callerText}</div>
                <div style="font-size:clamp(1.05rem, 2.2vh, 1.25rem); color:var(--gold-bright); font-family:'Cinzel',serif; text-align:center; letter-spacing:1.5px; text-shadow:0 0 16px var(--gold-glow); margin-bottom:6px;">${bannerText}</div>
                <div class="trump-3d-card" id="trump-reveal-3d-card">
                    <div class="trump-3d-front">
                        <div style="font-size:1.8rem; color:var(--gold-bright);">🔒</div>
                        <div style="font-size:0.65rem; color:#94a3b8; font-weight:800; margin-top:4px; text-transform:uppercase;">TRUMP</div>
                    </div>
                    <div class="trump-3d-back">
                        <div style="font-size:0.75rem; font-weight:900; color:${suitColor}; position:absolute; top:6px; left:8px;">${suit}</div>
                        <div class="trump-big-icon" style="font-size:clamp(2.8rem, 8vmin, 3.6rem); line-height:1; color:${suitColor}; filter:drop-shadow(0 0 16px ${suitColor});">${suit}</div>
                        <div style="font-size:0.75rem; font-weight:900; color:${suitColor}; position:absolute; bottom:6px; right:8px;">${suit}</div>
                    </div>
                </div>
            `;
            blast.style.display = 'flex';
            blast.style.pointerEvents = 'auto';
            if (window.gsap) {
                gsap.killTweensOf(blast);
                gsap.fromTo(blast,
                    { scale: 0.2, opacity: 0, xPercent: -50, yPercent: -50 },
                    { scale: 1, opacity: 1, xPercent: -50, yPercent: -50, duration: 0.32, ease: "back.out(1.4)" }
                );
            }

            // Step 1: Pause table for 400ms * speedMult before dramatic 3D card flip
            let pause1 = Math.round(400 * speedMult);
            setTimeout(() => {
                const cardEl = document.getElementById('trump-reveal-3d-card');
                playSound('reveal');

                // Directional spark shockwave burst in trump suit's royal colors
                if (typeof confetti === 'function') {
                    let sparkColors = isRed ? ['#ef4444', '#fca5a5', '#ffd700', '#ffffff'] : ['#38bdf8', '#bae6fd', '#e5c158', '#ffffff'];
                    confetti({
                        particleCount: 50,
                        spread: 360,
                        startVelocity: 24,
                        origin: { x: 0.5, y: 0.44 },
                        colors: sparkColors,
                        ticks: 80
                    });
                }

                this.animateVaultUnlock(suit);

                // Dramatic 3D Y-axis flip
                if (cardEl && window.gsap) {
                    gsap.to(cardEl, {
                        rotationY: 180,
                        scale: 1.25,
                        duration: 0.65,
                        ease: "back.out(1.4)"
                    });
                } else if (cardEl) {
                    cardEl.style.transform = 'rotateY(180deg) scale(1.25)';
                }

                const trumpPill = document.getElementById('trump-status');
                if (trumpPill && window.gsap) {
                    gsap.fromTo(trumpPill,
                        { scale: 1.35, color: 'var(--gold-bright)' },
                        { scale: 1, color: 'inherit', duration: 0.5, ease: "back.out(2)", delay: 0.3 }
                    );
                }

                // Step 2: Hold revealed card for 850ms * speedMult
                let holdDuration = Math.round(850 * speedMult);
                setTimeout(() => {
                    // Step 3: Card slides smoothly back and blast fades
                    if (cardEl && window.gsap) {
                        gsap.to(cardEl, {
                            scale: 0.35,
                            opacity: 0,
                            y: -50,
                            duration: 0.4,
                            ease: "power2.in"
                        });
                    }
                    if (window.gsap) {
                        gsap.to(blast, {
                            scale: 0.85,
                            opacity: 0,
                            duration: 0.35,
                            ease: "power2.in",
                            onComplete: () => {
                                blast.style.display = 'none';
                                blast.style.pointerEvents = 'none';
                                this.animatingReveal = false;
                                if (!isHost && this.pendingMasterState) {
                                    let pState = this.pendingMasterState;
                                    this.pendingMasterState = null;
                                    this.engine.syncFromMasterState(pState);
                                    this.renderStaticBoard();
                                    this.syncTable();
                                }
                                this.gameLoop();
                            }
                        });
                    } else {
                        setTimeout(() => {
                            blast.style.display = 'none';
                            blast.style.pointerEvents = 'none';
                            this.animatingReveal = false;
                            if (!isHost && this.pendingMasterState) {
                                let pState = this.pendingMasterState;
                                this.pendingMasterState = null;
                                this.engine.syncFromMasterState(pState);
                                this.renderStaticBoard();
                                this.syncTable();
                            }
                            this.gameLoop();
                        }, Math.round(350 * speedMult));
                    }
                }, holdDuration);
            }, pause1);
        } catch (err) {
            console.error("Trump reveal animation error:", err);
            blast.style.display = 'none';
            blast.style.pointerEvents = 'none';
            this.animatingReveal = false;
            if (!isHost && this.pendingMasterState) {
                let pState = this.pendingMasterState;
                this.pendingMasterState = null;
                this.engine.syncFromMasterState(pState);
                this.renderStaticBoard();
                this.syncTable();
            }
            this.gameLoop();
        }
    }

    animateTrickWinnerAndResolve(winnerIndex) {
        if (!this.engine.trickCards || this.engine.trickCards.length < 4) {
            this.animatingTrick = false;
            let totalRemaining = this.engine.players.reduce((sum, p) => sum + (p ? p.length : 0), 0);
            this.engine.phase = (totalRemaining === 0 && this.engine.roundTricks.length >= 8) ? 'ROUND_OVER' : 'PLAYING';
            this.gameLoop();
            return;
        }
        this.clearActiveTrickAnimation();
        this.animatingTrick = true;
        const animToken = this._trickAnimSeq;
        let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;

        // Watchdog Safety (5s): Guarantees table cards NEVER stay frozen
        this._trickAnimationWatchdog = setTimeout(() => {
            if (this.animatingTrick && animToken === this._trickAnimSeq) {
                console.warn("Watchdog: Trick animation exceeded timeout, forcing resolution!");
                this.clearActiveTrickAnimation();
                const tEl = document.getElementById('center-table');
                if (tEl) tEl.innerHTML = '';
                this.clearTrickWinnerHalo();
                if (this.engine.trickCards && this.engine.trickCards.length === 4) {
                    this.engine.resolveTrick();
                // Update in-table docked trick history
                const dock = document.getElementById('recent-trick-dock');
                const dockText = document.getElementById('recent-trick-dock-text');
                if (dock && dockText && this.engine.roundTricks && this.engine.roundTricks.length > 0) {
                    let lastTrk = this.engine.roundTricks[this.engine.roundTricks.length - 1];
                    let wName = (typeof getCompassShort === 'function' ? getCompassShort(lastTrk.winningPlayer) : COMPASS_SHORT[lastTrk.winningPlayer]) || `P${lastTrk.winningPlayer}`;
                    let isMine = (lastTrk.winningPlayer === mySeat);
                    let prefix = isMine ? '🏆 You won trick' : `🃏 ${wName} won trick`;
                    dockText.innerHTML = `${prefix} (+${lastTrk.points} pts) &bull; <span style="opacity:0.7;">History ▾</span>`;
                    dock.style.display = 'inline-flex';
                }
                    if (typeof flashTrickHUD === 'function') flashTrickHUD();
                }
                if (isHost) this.broadcastGameState();
                this.animatingTrick = false;
                this.applyPendingMasterState();
                this.gameLoop();
            }
        }, Math.round(5000 * speedMult));

        const table = document.getElementById('center-table');
        if (!table) {
            if (isHost) this.engine.resolveTrick();
            this.animatingTrick = false;
            this.gameLoop();
            return;
        }

        try {
            const cards = table.querySelectorAll('.trick-card');
            let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;
            let visualPos = getVisualPosition(winnerIndex);
            let isTeam1Winner = (winnerIndex === 0 || winnerIndex === 2);
            let glowColor = isTeam1Winner ? 'rgba(56, 189, 248, 0.95)' : 'rgba(251, 113, 133, 0.95)';

            // Beat 2: Winner Highlight & Point Pop
            let winCardPlay = this.engine._getCurrentTrickWinner();
            let winningCardEl = null;
            if (winCardPlay) {
                let winnerCardPos = getVisualPosition(winCardPlay.player);
                winningCardEl = table.querySelector(`.trick-card.pos-${winnerCardPos}`);
            }
            if (!winningCardEl && winCardPlay && winCardPlay.card) {
                cards.forEach(cEl => {
                    let r = cEl.querySelector('.card-corner span');
                    let s = cEl.querySelector('.card-corner .corner-suit');
                    if (r && s && r.textContent.trim() === winCardPlay.card.rank && s.textContent.trim() === winCardPlay.card.suit) {
                        winningCardEl = cEl;
                    }
                });
            }
            if (!winningCardEl && cards.length > 0) winningCardEl = cards[cards.length - 1];

            if (winningCardEl && window.gsap) {
                winningCardEl.style.zIndex = '80';
                gsap.to(winningCardEl, {
                    scale: 1.08,
                    filter: `drop-shadow(0 0 14px ${glowColor})`,
                    duration: 0.35,
                    ease: "back.out(1.5)"
                });
            }
            playSound('trick');

            const positions = ['bottom', 'right', 'top', 'left'];
            const winnerSeatEl = document.getElementById(`player-${positions[visualPos]}`);
            const badgeEl = winnerSeatEl ? winnerSeatEl.querySelector('.player-badge') : null;
            const isBadgeVisible = badgeEl && badgeEl.offsetWidth > 0 && badgeEl.offsetHeight > 0;
            const isLocalWinner = (typeof mySeat !== 'undefined' && winnerIndex === mySeat) || (visualPos === 0);
            const winnerBadge = isLocalWinner
                ? (document.getElementById('player-bottom') || winnerSeatEl)
                : (isBadgeVisible ? badgeEl : winnerSeatEl);

            let trickPts = Number(this.engine._countPointsInTrick()) || 0;
            if (trickPts > 0 && winnerBadge) {
                const floatBadge = document.createElement('div');
                floatBadge.innerText = `+${trickPts} pts`;
                let topOffset = (visualPos === 0) ? '-24px' : '-16px';
                floatBadge.style.cssText = `
                    position: absolute; top: ${topOffset}; left: 50%;
                    transform: translateX(-50%);
                    font-size: 0.76rem; font-weight: 800; font-family: 'Cinzel', serif;
                    color: ${isTeam1Winner ? '#38bdf8' : '#fb7185'};
                    background: rgba(4, 18, 12, 0.95);
                    border: 1.5px solid ${isTeam1Winner ? 'var(--team1-blue)' : 'var(--team2-coral)'};
                    border-radius: 12px; padding: 2px 8px;
                    box-shadow: 0 0 16px ${glowColor};
                    pointer-events: none; z-index: 100; white-space: nowrap;
                `;
                winnerBadge.appendChild(floatBadge);
                if (window.gsap) {
                    gsap.fromTo(floatBadge,
                        { y: 0, opacity: 1, scale: 0.8 },
                        { y: -28, opacity: 0, scale: 1.15, duration: 0.85, ease: "power2.out", onComplete: () => floatBadge.remove() }
                    );
                } else {
                    setTimeout(() => floatBadge.remove(), 800);
                }
            }

            let beat2Duration = Math.round(550 * speedMult);

            this.trickBeat2Timer = setTimeout(() => {
                this.trickBeat2Timer = null;
                if (animToken !== this._trickAnimSeq) return;
                try {
                    // Beat 3: Gather & Sweep
                    playSound('rustle');

                    if (window.gsap && cards.length > 0) {
                        const tl = gsap.timeline({
                            onComplete: () => {
                                if (animToken !== this._trickAnimSeq) return;
                                clearTimeout(this._trickAnimationWatchdog);
                                this._trickAnimationWatchdog = null;
                                this.activeTrickTimeline = null;
                                table.innerHTML = '';
                                this.clearTrickWinnerHalo();
                                if (this.engine.trickCards && this.engine.trickCards.length === 4) {
                                    this.engine.resolveTrick();
                                    if (typeof flashTrickHUD === 'function') flashTrickHUD();
                                }
                                if (isHost) {
                                    this.broadcastGameState();
                                }

                                // Breathing gap before next trick with host multiplayer headroom
                                let extraNetBuffer = (gameMode === 'multi' && isHost) ? 350 : 0;
                                let breathingGap = Math.round((400 + extraNetBuffer) * speedMult);
                                this.trickBreathingTimer = setTimeout(() => {
                                    this.trickBreathingTimer = null;
                                    if (animToken !== this._trickAnimSeq) return;
                                    this.animatingTrick = false;
                                    this.applyPendingMasterState();
                                    this.gameLoop();
                                }, breathingGap);
                            }
                        });
                        this.activeTrickTimeline = tl;

                        // Stack cards together in center
                        tl.to(cards, {
                            xPercent: -50,
                            yPercent: -50,
                            x: 0,
                            y: 0,
                            rotation: (i) => (i - 1.5) * 4,
                            scale: 1.04,
                            filter: `drop-shadow(0 0 10px ${glowColor})`,
                            duration: 0.22,
                            ease: "power2.out"
                        });

                        let destX = 0, destY = 0;
                        let targetEl = isLocalWinner
                            ? (document.getElementById('player-bottom') || winnerSeatEl)
                            : (winnerBadge || winnerSeatEl);
                        let hasValidRect = false;
                        if (targetEl && table) {
                            const tableRect = table.getBoundingClientRect();
                            const bRect = targetEl.getBoundingClientRect();
                            if (bRect.width > 0 || bRect.height > 0) {
                                destX = (bRect.left + bRect.width / 2) - (tableRect.left + tableRect.width / 2);
                                destY = (bRect.top + bRect.height / 2) - (tableRect.top + tableRect.height / 2);
                                hasValidRect = true;
                            }
                        }
                        if (!hasValidRect) {
                            if (isLocalWinner) destY = Math.round(window.innerHeight * 0.42 || 280);
                            else if (visualPos === 1) destX = 260;
                            else if (visualPos === 2) destY = -260;
                            else if (visualPos === 3) destX = -260;
                        }

                        // Sweep stack into winner's seat
                        tl.to(cards, {
                            xPercent: -50,
                            yPercent: -50,
                            x: destX,
                            y: destY,
                            scale: 0.16,
                            opacity: 0,
                            rotation: "+=45",
                            duration: 0.42,
                            ease: "power3.in",
                            stagger: 0.02
                        });

                        // Tactile bounce on winner badge
                        tl.add(() => {
                            if (targetEl && window.gsap) {
                                gsap.fromTo(targetEl,
                                    { scale: 1.25 },
                                    { scale: 1, duration: 0.32, ease: "back.out(2)" }
                                );
                            }
                        });
                    } else {
                        if (animToken !== this._trickAnimSeq) return;
                        clearTimeout(this._trickAnimationWatchdog);
                        this._trickAnimationWatchdog = null;
                        table.innerHTML = '';
                        this.clearTrickWinnerHalo();
                        if (this.engine.trickCards && this.engine.trickCards.length === 4) {
                            this.engine.resolveTrick();
                            if (typeof flashTrickHUD === 'function') flashTrickHUD();
                        }
                        if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner();
                        if (isHost) {
                            this.broadcastGameState();
                        }
                        let extraNetBuffer = (gameMode === 'multi' && isHost) ? 350 : 0;
                        this.trickBreathingTimer = setTimeout(() => {
                            this.trickBreathingTimer = null;
                            if (animToken !== this._trickAnimSeq) return;
                            this.animatingTrick = false;
                            this.applyPendingMasterState();
                            this.gameLoop();
                        }, Math.round((400 + extraNetBuffer) * speedMult));
                    }
                } catch (innerErr) {
                    console.error("Trick sweep animation error:", innerErr);
                    this.clearActiveTrickAnimation();
                    table.innerHTML = '';
                    this.clearTrickWinnerHalo();
                    if (this.engine.trickCards && this.engine.trickCards.length === 4) {
                        this.engine.resolveTrick();
                        if (typeof flashTrickHUD === 'function') flashTrickHUD();
                    }
                    if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner();
                    if (isHost) this.broadcastGameState();
                    this.animatingTrick = false;
                    this.applyPendingMasterState();
                    this.gameLoop();
                }
            }, beat2Duration);
        } catch (outerErr) {
            console.error("animateTrickWinnerAndResolve error:", outerErr);
            this.clearActiveTrickAnimation();
            const table = document.getElementById('center-table');
            if (table) table.innerHTML = '';
            this.clearTrickWinnerHalo();
            if (this.engine.trickCards && this.engine.trickCards.length === 4) {
                this.engine.resolveTrick();
            }
            if (isHost) this.broadcastGameState();
            this.animatingTrick = false;
            this.applyPendingMasterState();
            this.gameLoop();
        }
    }

    executeTrickWinnerSequence(winnerIndex) {
        this.animateTrickWinnerAndResolve(winnerIndex);
    }

    broadcastGameState() {
        if(gameMode === 'multi' && isHost) {
            for (let connId in clientConns) {
                let conn = clientConns[connId];
                if (!conn) continue;
                let s = conn.seat;
                if (s !== undefined && s !== null) {
                    try {
                        conn.send(JSON.stringify({
                            type: 'STATE_UPDATE',
                            target: s,
                            state: game.exportStateForClient(s)
                        }));
                    } catch(e) {}
                }
            }
        }
    }

    manageTurnCountdown(turnPlayer, isHumanTurn) {
        if (!isHumanTurn || this.engine.phase === 'ROUND_OVER' || this.engine.phase === 'TRICK_OVER' || this.engine.phase === 'LOBBY' || this.animatingTrick) {
            this.stopTurnTimer();
            return;
        }

        if (this.turnTimerSeat === turnPlayer && this.turnCountdownTimer) {
            return; // Timer already active for this turn
        }

        // If seat has been taken over by AI Auto-Sub (due to 2 consecutive timeouts), play after short realistic delay
        if (autoPlaySeats[turnPlayer]) {
            this.stopTurnTimer();
            if (isHost || gameMode === 'ai') {
                setTimeout(() => {
                    if (this.engine.currentTurn === turnPlayer && !this.animatingTrick) {
                        this.executeAFKTimeoutMove(turnPlayer);
                    }
                }, 800);
            }
            return;
        }

        // If it's my turn, trigger crisp turn haptics
        if (turnPlayer === mySeat && mySeat !== 99) {
            triggerHaptic('turn');
        }

        let durationMs = (this.engine.turnDurationMs && !isHost)
            ? this.engine.turnDurationMs
            : getTurnDurationMs(this.engine, turnPlayer);

        this.startTurnTimer(turnPlayer, durationMs);
    }

    startTurnTimer(seat, durationMs) {
        this.stopTurnTimer();
        this.turnTimerSeat = seat;
        const deadline = (this.engine.turnDeadline && !isHost)
            ? this.engine.turnDeadline
            : Date.now() + durationMs;
        if (isHost || gameMode === 'ai') {
            this.engine.turnDeadline = deadline;
            this.engine.turnDurationMs = durationMs;
        }

        let lastWholeSec = Math.ceil(durationMs / 1000);
        const circumference = 100; // 2 * Math.PI * 15.9155

        this.turnCountdownTimer = setInterval(() => {
            const remainingMs = Math.max(0, deadline - Date.now());
            const secLeft = Math.ceil(remainingMs / 1000);
            const ratio = Math.max(0, Math.min(1, remainingMs / durationMs));

            // Update SVG ring & state classes (normal -> warning <= 10s -> critical <= 5s)
            this.updateTurnRingUI(seat, secLeft, ratio, circumference);

            if (secLeft !== lastWholeSec) {
                lastWholeSec = secLeft;
                if (seat === mySeat && secLeft > 0 && secLeft <= 5) {
                    this.playTimerTickSound(secLeft === 1);
                    if (navigator.vibrate) navigator.vibrate(25);
                }
            }

            if (remainingMs <= 0) {
                this.stopTurnTimer();
                if (isHost || gameMode === 'ai') {
                    this.handleTurnTimeout(seat);
                }
            }
        }, 200);
    }

    updateTurnRingUI(seat, secLeft, ratio, circumference) {
        const isMe = (seat === mySeat && mySeat !== 99);
        const actionRow = isMe ? document.querySelector('.bottom-action-row') : null;

        let container = actionRow;
        if (!container) {
            let visualPos = getVisualPosition(seat);
            const posNames = ['bottom', 'right', 'top', 'left'];
            const pBox = document.getElementById(`player-${posNames[visualPos]}`);
            if (!pBox) return;
            container = pBox.querySelector('.player-badge') || pBox;
        }

        // Remove stale docked ring from actionRow when turn moves to an opponent
        if (!isMe) {
            const staleInline = document.querySelector('.bottom-action-row .turn-ring-container.docked-inline');
            if (staleInline) staleInline.style.display = 'none';
        }

        let ring = container.querySelector('.turn-ring-container');
        if (!ring) {
            ring = document.createElement('div');
            ring.className = isMe ? 'turn-ring-container docked-inline' : 'turn-ring-container';
            ring.innerHTML = `
                <svg class="turn-ring-svg" viewBox="0 0 36 36">
                    <path class="turn-ring-circle-bg"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path class="turn-ring-circle-progress"
                        stroke-dasharray="100, 100"
                        stroke-dashoffset="0"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                </svg>
                <div class="turn-ring-label">${secLeft}</div>
            `;
            if (isMe) {
                container.prepend(ring);
            } else {
                container.appendChild(ring);
            }
        } else if (isMe) {
            ring.classList.add('docked-inline');
        }
        const progressPath = ring.querySelector('.turn-ring-circle-progress');
        const label = ring.querySelector('.turn-ring-label');
        let dashOffset = (1 - ratio) * 100;
        if (progressPath) progressPath.setAttribute('stroke-dashoffset', dashOffset);
        if (label) label.innerText = secLeft;

        ring.style.display = 'flex';
        if (secLeft <= 5) {
            ring.classList.add('critical');
            ring.classList.remove('warning');
        } else if (secLeft <= 10) {
            ring.classList.add('warning');
            ring.classList.remove('critical');
        } else {
            ring.classList.remove('warning', 'critical');
        }
    }

    playTimerTickSound(isFinal) {
        if (typeof playSound === 'function') {
            playSound(isFinal ? 'tick_urgent' : 'tick');
        }
    }

    stopTurnTimer() {
        if (this.turnCountdownTimer) {
            clearInterval(this.turnCountdownTimer);
            this.turnCountdownTimer = null;
        }
        this.turnTimerSeat = -1;
        document.querySelectorAll('.turn-ring-container').forEach(r => r.style.display = 'none');
    }

    stopTurnCountdown() {
        this.stopTurnTimer();
    }

    handleTurnTimeout(player) {
        if (!isHost && gameMode !== 'ai') return;
        consecutiveTimeouts[player] = (consecutiveTimeouts[player] || 0) + 1;
        let pName = playerCustomNames[player] || COMPASS_FULL[player];

        if (consecutiveTimeouts[player] >= 2) {
            // 2nd Consecutive Timeout: Enable full AI Auto-Sub & show persistent resume banner
            autoPlaySeats[player] = true;
            this.renderLog(`🤖 ${pName} missed 2 consecutive turns. AI Auto-Sub taking over.`);
            if (typeof showGameToast === 'function') {
                showGameToast(`🤖 ${pName} is AFK — AI Auto-Sub active`, 3500);
            }
            if (gameMode === 'multi') {
                sendNetMessage({ type: 'SEAT_TAKEOVER', seat: player, autoPlay: true });
            }
        } else {
            // 1st Timeout: Execute single fallback move, keeping manual control for next turn
            this.renderLog(`⏱️ Auto-played turn for ${pName} (Turn timed out: 1/2)`);
            if (typeof showGameToast === 'function') {
                showGameToast("⏱️ Time expired — auto-played 1 card", 3000);
            }
        }

        this.executeAFKTimeoutMove(player);
    }

    executeAFKTimeoutMove(player) {
        if (this.engine.phase === 'BIDDING') {
            this.engine.submitBid(player, 'Pass');
            this.gameLoop();
        } else if (this.engine.phase === 'SET_TRUMP') {
            let suit = this.engine.getAITrump();
            this.engine.setTrump(suit);
            this.gameLoop();
        } else if (this.engine.phase === 'PLAYING') {
            const aiMove = this.engine.getAIPlay();
            let moveIdx = aiMove ? aiMove.index : 0;
            if (aiMove && aiMove.reveal) {
                this.engine.revealTrump(player);
            }
            const legalMoves = (typeof this.engine.getValidPlayIndices === 'function')
                ? this.engine.getValidPlayIndices(player)
                : [];
            if (legalMoves && legalMoves.length > 0 && !legalMoves.includes(moveIdx)) {
                moveIdx = legalMoves[0];
            }
            this.engine.playCard(player, moveIdx);
            this.gameLoop();
        }
    }

    resumeManualControl() {
        if (mySeat !== 99 && mySeat >= 0 && mySeat < 4) {
            autoPlaySeats[mySeat] = false;
            consecutiveTimeouts[mySeat] = 0;
            const banner = document.getElementById('afk-resume-banner');
            if (banner) banner.style.display = 'none';
            if (isHost) {
                this.renderLog(`👋 You resumed manual control!`);
                sendNetMessage({ type: 'SEAT_TAKEOVER', seat: mySeat, autoPlay: false });
            } else {
                sendNetMessage({ type: 'CLAIM_SEAT', player: mySeat });
                sendNetMessage({ type: 'SEAT_TAKEOVER', seat: mySeat, autoPlay: false });
            }
            triggerHaptic('turn');
            this.gameLoop();
        }
    }

    gameLoop() {
        uiLocked = false;

        // Check if current human user is in auto-play
        if (mySeat !== 99 && autoPlaySeats[mySeat]) {
            const banner = document.getElementById('afk-resume-banner');
            if (banner) banner.style.display = 'flex';
        } else {
            const banner = document.getElementById('afk-resume-banner');
            if (banner) banner.style.display = 'none';
        }
        
        // Animations in progress: lock gameLoop completely
        if (this.animatingTrick || this.animatingReveal) return;

        if (!this.engine.trumpRevealed) {
            this.uiTrumpRevealed = false;
        }

        if (this.engine.trumpRevealed && !this.uiTrumpRevealed && this.engine.trumpSuit) {
            this.uiTrumpRevealed = true; 
            this.renderStaticBoard(); 
            this.syncTable(); 
            this.playTrumpRevealAnimation(this.engine.trumpSuit);
            return; 
        }

        this.renderStaticBoard();
        this.syncTable();
        
        if (isHost) this.broadcastGameState();

        // 1. TRICK OVER: High-priority immediate handling before any moves
        if (this.engine.phase === 'TRICK_OVER') {
            if (this.animatingTrick) return; // Mutex guard: prevent duplicate concurrent trick sweeps
            let winningPlay = this.engine._getCurrentTrickWinner();
            if (winningPlay && this.engine.trickCards && this.engine.trickCards.length === 4) {
                this.animatingTrick = true;
                let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;
                let extraNetBuffer = (gameMode === 'multi' && isHost) ? 350 : 0;
                let freezeDuration = Math.round((850 + extraNetBuffer) * speedMult);
                if (this.trickTimer) clearTimeout(this.trickTimer);
                this.trickTimer = setTimeout(() => {
                    this.trickTimer = null;
                    this.animateTrickWinnerAndResolve(winningPlay.player);
                }, freezeDuration);
            } else {
                let totalRemaining = this.engine.players.reduce((sum, p) => sum + (p ? p.length : 0), 0);
                this.engine.phase = (totalRemaining === 0 && this.engine.roundTricks.length >= 8) ? 'ROUND_OVER' : 'PLAYING';
                this.gameLoop();
            }
            return;
        }

        // 2. ROUND OVER: Immediate modal display
        if (this.engine.phase === 'ROUND_OVER') {
            let totalRemaining = this.engine.players.reduce((sum, p) => sum + (p ? p.length : 0), 0);
            if (totalRemaining > 0) {
                console.warn(`[gameLoop] Premature ROUND_OVER blocked: ${totalRemaining} cards still in players' hands!`);
                this.engine.phase = 'PLAYING';
                this.renderStaticBoard();
                this.syncTable();
            } else {
                this.showEndModal();
                return;
            }
        }

        // 3. DEALING PHASES
        if (this.engine.phase === 'DEALING_1' || this.engine.phase === 'DEALING_2') {
            let dealKey = `${this.engine.roundId || 1}_${this.engine.phase}`;
            if (this.lastAnimatedDealKey === dealKey) {
                // Already animated this deal phase for this round: skip animation and transition immediately
                if (isHost) {
                    this.engine.finishDealAnimation();
                    if (gameMode === 'multi') this.broadcastGameState();
                } else {
                    if (this.engine.phase === 'DEALING_1') this.engine.phase = 'BIDDING';
                    if (this.engine.phase === 'DEALING_2') this.engine.phase = 'PLAYING';
                    this.applyPendingMasterState();
                }
                this.renderStaticBoard();
                this.gameLoop();
                return;
            }

            if (this.dealingAnimationActive) return;
            this.dealingAnimationActive = true;
            this.isDealingState = true;
            this.lastAnimatedDealKey = dealKey;
            this.renderStaticBoard();

            this.playHumanDealAnimation(() => {
                this.isDealingState = false;
                this.dealingAnimationActive = false;
                for (let i = 0; i < 4; i++) this.engine.sortHand(i);
                if (isHost) {
                    this.engine.finishDealAnimation();
                    if (gameMode === 'multi') this.broadcastGameState();
                } else {
                    if (this.engine.phase === 'DEALING_1') this.engine.phase = 'BIDDING';
                    if (this.engine.phase === 'DEALING_2') this.engine.phase = 'PLAYING';
                    this.applyPendingMasterState();
                }
                this.renderStaticBoard();
                if (window.gsap) {
                    gsap.from('.my-cards-row .card', {
                        y: 12,
                        scale: 0.96,
                        stagger: 0.025,
                        duration: 0.28,
                        ease: "power2.out"
                    });
                }
                this.gameLoop();
            });
            return; 
        }

        let isAITurn = !humanSeats.includes(this.engine.currentTurn);
        this.manageTurnCountdown(this.engine.currentTurn, !isAITurn);
        
        // Safety timeout for remote human players during bidding: auto-pass after 32s to prevent match freezes
        if (isHost && gameMode === 'multi' && !isAITurn && this.engine.phase === 'BIDDING') {
            if (this.humanBidTimeout) { clearTimeout(this.humanBidTimeout); this.humanBidTimeout = null; }
            this.humanBidTimeout = setTimeout(() => {
                if (this.engine.phase === 'BIDDING' && !humanSeats.includes(this.engine.currentTurn)) return;
                if (this.engine.phase === 'BIDDING' && this.engine.currentTurn !== mySeat) {
                    this.renderLog(`⚠️ Turn timeout: Auto-passed for seat ${COMPASS_FULL[this.engine.currentTurn]}`);
                    this.engine.submitBid(this.engine.currentTurn, 'Pass');
                    this.gameLoop();
                }
            }, 32000);
        } else if (this.humanBidTimeout) {
            clearTimeout(this.humanBidTimeout); this.humanBidTimeout = null;
        }

        // 4. AI BOT TURNS (Single-player or Host in multi)
        if (isAITurn && (gameMode === 'ai' || (gameMode === 'multi' && isHost))) {
            let turnPlayer = this.engine.currentTurn;

            // Prevent re-entrant double worker calls
            if (this.isAIThinking) return;

            if (this.engine.phase === 'BIDDING') {
                this.isAIThinking = true;
                (async () => {
                    try {
                        let val = await this.engine.getAIBidAsync();
                        let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;
                        let delay;
                        if (val === 'Pass') {
                            delay = Math.round((480 + (Math.floor(Math.random() * 140) - 70)) * speedMult);
                        } else {
                            let bidNum = parseInt(val) || 16;
                            let baseDelay = 700 + Math.max(0, (bidNum - 14)) * 180;
                            let jitter = Math.floor(Math.random() * 200) - 100;
                            delay = Math.round(Math.max(650, baseDelay + jitter) * speedMult);
                        }

                        this.aiTimer = setTimeout(() => {
                            this.isAIThinking = false;
                            this.aiTimer = null;
                            if (this.engine.phase !== 'BIDDING' || this.engine.currentTurn !== turnPlayer) {
                                this.gameLoop();
                                return;
                            }
                            if (gameMode === 'multi') broadcastNetMessage({ type: 'UI_EVENT', bidEvent: { pIndex: turnPlayer, val: val, won: false } });
                            this.engine.submitBid(turnPlayer, val);
                            this.gameLoop();
                        }, delay);
                    } catch (err) {
                        console.warn("AI Bid error, using pass:", err);
                        this.isAIThinking = false;
                        this.aiTimer = null;
                        this.engine.submitBid(turnPlayer, 'Pass');
                        this.gameLoop();
                    }
                })();
            } 
            else if (this.engine.phase === 'SET_TRUMP') {
                this.isAIThinking = true;
                (async () => {
                    try {
                        let suit = await this.engine.getAITrumpAsync();
                        let beh = this.engine.lastBotBehavior;
                        let delay = (beh && beh.preThinkDelayMs) ? beh.preThinkDelayMs : (1400 + Math.floor(Math.random() * 400));
                        delay = Math.round(delay * (window.GAME_SPEED_MULTIPLIER || 1.0));

                        this.aiTimer = setTimeout(() => {
                            this.isAIThinking = false;
                            this.aiTimer = null;
                            if (this.engine.phase !== 'SET_TRUMP' || this.engine.currentTurn !== turnPlayer) {
                                this.gameLoop();
                                return;
                            }
                            this.engine.setTrump(suit);
                            this.gameLoop();
                        }, delay);
                    } catch (err) {
                        console.warn("AI Trump error, picking fallback:", err);
                        this.isAIThinking = false;
                        this.aiTimer = null;
                        let suit = this.engine.getAITrump();
                        this.engine.setTrump(suit);
                        this.gameLoop();
                    }
                })();
            }
            else if (this.engine.phase === 'PLAYING') {
                this.isAIThinking = true;

                if (this.engine.canDeclarePair(turnPlayer)) {
                    this.isAIThinking = false;
                    if (gameMode === 'multi' && isHost) {
                        broadcastNetMessage({ type: 'UI_EVENT', pairEvent: { player: turnPlayer } });
                    }
                    this.playRoyalPairAnimation(turnPlayer, () => {
                        this.engine.declarePair(turnPlayer);
                        if (gameMode === 'multi' && isHost) this.broadcastGameState();
                        this.syncTable();
                        this.renderStaticBoard();
                        this.gameLoop();
                    });
                    return;
                }

                // AI Watchdog Timer (4.5s): Guarantees the bot will NEVER freeze the table
                clearTimeout(this._aiWatchdogTimer);
                this._aiWatchdogTimer = setTimeout(() => {
                    if (this.isAIThinking && this.engine.phase === 'PLAYING' && this.engine.currentTurn === turnPlayer && !humanSeats.includes(turnPlayer) && turnPlayer !== mySeat) {
                        console.warn(`Watchdog: Bot ${turnPlayer} took too long, forcing move!`);
                        this.resetBotPrePlayTell();
                        this.isAIThinking = false;
                        clearTimeout(this.aiTimer);
                        this.aiTimer = null;
                        let valids = this.engine.getValidPlayIndices(turnPlayer);
                        let moveIdx = (valids && valids.length > 0) ? valids[0] : 0;
                        this.engine.playCard(turnPlayer, moveIdx);
                        this.gameLoop();
                    }
                }, Math.round(4500 * (window.GAME_SPEED_MULTIPLIER || 1.0)));

                (async () => {
                    try {
                        let legalIndices = this.engine.getValidPlayIndices(turnPlayer);
                        let thinkTimeMs = getBotThinkTimeMs(this.engine, turnPlayer, legalIndices);
                        let speedMult = window.GAME_SPEED_MULTIPLIER || 1.0;

                        // Stage 1: Tell animation
                        let stage1Delay = Math.max(120, Math.round(thinkTimeMs * 0.48));
                        let isSaboteurBluff = (turnPlayer === 3 && thinkTimeMs >= 1300 * speedMult);

                        setTimeout(() => {
                            if (this.isAIThinking) this.animateBotPrePlayTell(turnPlayer, isSaboteurBluff);
                        }, stage1Delay);

                        // Concurrent calculation
                        let startTime = Date.now();
                        let aiDecision = null;
                        try {
                            aiDecision = await this.engine.getAIPlayAsync();
                        } catch (aiErr) {
                            console.warn("AI calculation error, using local fallback:", aiErr);
                            aiDecision = this.engine.getAIPlay();
                        }

                        if (!aiDecision) aiDecision = this.engine.getAIPlay();

                        // Match organic human delay with elapsed calculation
                        let elapsed = Date.now() - startTime;
                        let remainingWait = Math.max(60, thinkTimeMs - elapsed);

                        // Stage 2: Execute card play
                        this.aiTimer = setTimeout(() => {
                            clearTimeout(this._aiWatchdogTimer);
                            this._aiWatchdogTimer = null;
                            this.resetBotPrePlayTell();
                            this.isAIThinking = false;
                            this.aiTimer = null;

                            if (this.engine.currentTurn !== turnPlayer || this.engine.phase !== 'PLAYING') {
                                this.gameLoop();
                                return;
                            }

                            if (aiDecision.reveal && this.engine.canRevealTrump(turnPlayer)) {
                                this.engine.revealTrump(turnPlayer);
                                this.engine.playCard(turnPlayer, aiDecision.index);
                            } else {
                                this.engine.playCard(turnPlayer, aiDecision.index);
                            }
                            this.gameLoop();
                        }, remainingWait);
                    } catch (fatalAiErr) {
                        console.error("Fatal bot turn error:", fatalAiErr);
                        clearTimeout(this._aiWatchdogTimer);
                        this._aiWatchdogTimer = null;
                        this.resetBotPrePlayTell();
                        this.isAIThinking = false;
                        this.aiTimer = null;
                        let valids = this.engine.getValidPlayIndices(turnPlayer);
                        let moveIdx = (valids && valids.length > 0) ? valids[0] : 0;
                        this.engine.playCard(turnPlayer, moveIdx);
                        this.gameLoop();
                    }
                })();
            }
        }

        // 5. HUMAN PLAYER CONTROLS (Modals & Buttons)
        if (this.engine.currentTurn === mySeat && mySeat !== 99) {
            if (this.engine.phase === 'BIDDING') this.showBidModal();
            else if (this.engine.phase === 'SET_TRUMP') this.showTrumpModal();
            else { document.getElementById('bid-modal').style.display = 'none'; document.getElementById('trump-modal').style.display = 'none'; }

            if (this.engine.phase === 'PLAYING') {
                const btn = document.getElementById('reveal-btn');
                let canReveal = this.engine.canRevealTrump(mySeat);
                btn.style.display = canReveal ? 'block' : 'none';

                const pairBtn = document.getElementById('pair-btn');
                if (this.engine.canDeclarePair(mySeat)) {
                    pairBtn.style.display = 'block';
                } else {
                    pairBtn.style.display = 'none';
                }
            }
        } else {
            document.getElementById('bid-modal').style.display = 'none';
            document.getElementById('trump-modal').style.display = 'none';
            document.getElementById('reveal-btn').style.display = 'none';
            document.getElementById('pair-btn').style.display = 'none';
        }

        // Check 0-point hand reshuffle availability for human player
        let myHand = this.engine.players[mySeat] || [];
        let myHandPts = myHand.reduce((s, c) => s + ((c && typeof c.value === 'number') ? c.value : 0), 0);
        let canReshuffle = (mySeat !== 99 && myHand.length === 4 && myHandPts === 0 && this.engine.phase === 'BIDDING');
        const reshuffleBtn = document.getElementById('reshuffle-btn');
        if (reshuffleBtn) {
            let t = I18N[currentLang] || I18N.en;
            reshuffleBtn.innerText = t.reshuffleZeroPts || '🔄 0 Pts Reshuffle';
            reshuffleBtn.style.display = canReshuffle ? 'block' : 'none';
        }
    }

    onReshuffleClick() {
        if (uiLocked) return;
        let hand = this.engine.players[mySeat] || [];
        let handPts = hand.reduce((s, c) => s + ((c && typeof c.value === 'number') ? c.value : 0), 0);
        if (hand.length !== 4 || handPts > 0 || this.engine.phase !== 'BIDDING') return;

        uiLocked = true;
        if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
        document.getElementById('bid-modal').style.display = 'none';
        const reshuffleBtn = document.getElementById('reshuffle-btn');
        if (reshuffleBtn) reshuffleBtn.style.display = 'none';

        let t = I18N[currentLang] || I18N.en;
        let name = this.playerNames[mySeat] || (COMPASS_FULL[mySeat] || 'You');
        let msg = (t.reshufflePrompt || '⚠️ 0 Points in hand! Reshuffle requested by {name}.').replace('{name}', name);
        this.renderLog(msg);
        this.showSpeechBubble(mySeat, currentLang === 'hi' ? '🔄 0 अंक! री-शफल' : '🔄 0 Points! Redeal');

        if (gameMode === 'multi') {
            sendNetMessage({ type: 'RESHUFFLE_REQUEST', player: mySeat });
        } else {
            setTimeout(() => {
                this.engine.reshuffleRound(mySeat);
                this.gameLoop();
            }, 800);
        }
    }

    onBidSubmit(val) {
        if (typeof mySeat !== 'undefined' && mySeat >= 0 && mySeat < 4) consecutiveTimeouts[mySeat] = 0;
        uiLocked = true;
        clearTimeout(window._uiLockSafetyTimer);
        window._uiLockSafetyTimer = setTimeout(() => { uiLocked = false; }, 2000);
        document.getElementById('bid-modal').style.display = 'none';
        if(gameMode === 'multi') sendNetMessage({type:'SUBMIT_BID', player: mySeat, val: val});
        else { this.engine.submitBid(mySeat, val); this.gameLoop(); }
    }

    showBidModal() {
        triggerHaptic('turn');
        if (this.engine.hasPassed && this.engine.hasPassed[mySeat]) {
            document.getElementById('bid-modal').style.display = 'none';
            return;
        }
        let hand = this.engine.players[mySeat] || [];
        let handPts = hand.reduce((s, c) => s + ((c && typeof c.value === 'number') ? c.value : 0), 0);
        let t = I18N[currentLang] || I18N.en;
        let evalTemplate = (t && t.handPoints) ? t.handPoints : (currentLang === 'hi' ? 'आपके 4 पत्तों के अंक: {pts} अंक' : 'Your 4-Card Hand Points: {pts} pts');
        
        if (document.getElementById('bid-modal-title')) document.getElementById('bid-modal-title').innerText = t.placeBid || 'Place Your Bid';
        if (document.getElementById('bid-high-label')) document.getElementById('bid-high-label').innerText = t.currentHighBid || 'Current High Bid:';
        if (hand.length === 4 && handPts === 0) {
            let zeroNotice = currentLang === 'hi' ? ' (री-शफल उपलब्ध)' : ' (Reshuffle Available)';
            document.getElementById('bid-hand-eval').innerHTML = `<span style="color:#fca5a5; font-weight:800;">⚠️ ${evalTemplate.replace('{pts}', 0)}${zeroNotice}</span>`;
        } else {
            document.getElementById('bid-hand-eval').innerText = evalTemplate.replace('{pts}', handPts);
        }

        const modalReshuffleBtn = document.getElementById('modal-reshuffle-btn');
        if (modalReshuffleBtn) {
            modalReshuffleBtn.innerText = t.reshuffleZeroPts || '🔄 Reshuffle Deck (0 Pts Hand)';
            modalReshuffleBtn.style.display = (hand.length === 4 && handPts === 0) ? 'block' : 'none';
        }
        document.getElementById('current-high-bid').innerText = this.engine.currentBid === 15 ? t.noneMin16 : this.engine.currentBid;
        if (document.getElementById('modal-pass-btn')) document.getElementById('modal-pass-btn').innerText = t.passTurn;

        // Partner bid indicator inside modal
        let partnerIndex = mySeat === 99 ? 2 : (mySeat + 2) % 4;
        let pBid = (this.engine.playerBids && this.engine.playerBids[partnerIndex] !== undefined) ? this.engine.playerBids[partnerIndex] : null;
        let pDir = COMPASS_FULL[partnerIndex];
        let pDirName = currentLang === 'hi' ? (t.dirs && t.dirs[pDir] ? t.dirs[pDir] : pDir) : pDir;
        let pText = document.getElementById('modal-partner-text');
        if (pText) {
            let pLabel = t.partnerLabel.replace('{dir}', pDirName);
            if (pBid === 'Pass') {
                pText.innerHTML = `🤝 ${pLabel}: <span style="color:#94a3b8; font-weight:800;">${t.passedSkipped || t.partnerPassed}</span>`;
            } else if (typeof pBid === 'number') {
                pText.innerHTML = `🤝 ${pLabel}: <span style="color:var(--gold-bright); font-weight:900;">${t.partnerBid.replace('{val}', pBid)}</span>`;
            } else {
                pText.innerHTML = `🤝 ${pLabel}: <span style="color:#cbd5e1;">${t.partnerWaiting}</span>`;
            }
        }

        // Live 4-seat Auction Status Grid
        const historyRow = document.getElementById('modal-bid-history-row');
        if (historyRow) {
            historyRow.innerHTML = '';
            for (let i = 0; i < 4; i++) {
                let badge = document.createElement('div');
                let isP = (i === partnerIndex && mySeat !== 99);
                let isMe = (i === mySeat && mySeat !== 99);
                let sBid = this.engine.playerBids ? this.engine.playerBids[i] : null;
                badge.className = `bid-seat-badge ${isP ? 'partner' : ''}`;
                if (this.engine.currentTurn === i) badge.classList.add('active-turn');
                
                let sLabel = isMe ? 'YOU' : (isP ? 'PARTNER' : COMPASS_SHORT[i]);
                let actionText = '...';
                if (sBid === 'Pass') {
                    badge.classList.add('passed');
                    actionText = 'Pass';
                } else if (typeof sBid === 'number') {
                    badge.classList.add('bid-placed');
                    actionText = `Bid ${sBid}`;
                } else if (this.engine.currentTurn === i) {
                    actionText = 'Turn';
                }
                badge.innerHTML = `<span>${sLabel}</span><span class="seat-action">${actionText}</span>`;
                historyRow.appendChild(badge);
            }
        }

        const opts = document.getElementById('bid-options'); opts.innerHTML = '';
        for(let b = this.engine.currentBid + 1; b <= Math.min(this.engine.currentBid + 8, 28); b++) {
            const chip = document.createElement('div'); chip.className = 'bid-chip'; chip.innerText = b;
            chip.onclick = () => this.onBidSubmit(b); opts.appendChild(chip);
        }
        uiLocked = false;
        document.getElementById('bid-modal').style.display = 'block';
    }

    showBidWonModal(winnerIndex, bidValue) {
        const modal = document.getElementById('bid-won-modal');
        if (!modal) return;
        let t = I18N[currentLang] || I18N.en;
        let partnerIdx = mySeat === 99 ? 2 : (mySeat + 2) % 4;
        let pDir = COMPASS_FULL[winnerIndex];
        let pDirName = currentLang === 'hi' ? (t.dirs && t.dirs[pDir] ? t.dirs[pDir] : pDir) : pDir;
        let isPartner = (winnerIndex === partnerIdx && mySeat !== 99);
        let isSelf = (winnerIndex === mySeat && mySeat !== 99);

        const iconEl = document.getElementById('bid-won-icon');
        const titleEl = document.getElementById('bid-won-title');
        const badgeEl = document.getElementById('bid-won-badge');
        const descEl = document.getElementById('bid-won-desc');

        if (isSelf) {
            iconEl.innerText = '👑';
            titleEl.innerHTML = currentLang === 'hi' ? '👑 आपने बोली जीती!' : '👑 YOU WON THE BID!';
            titleEl.style.color = 'var(--gold-bright)';
            badgeEl.innerText = `🎯 ${currentLang === 'hi' ? 'लक्ष्य' : 'Contract'}: ${bidValue} ${currentLang === 'hi' ? 'अंक' : 'pts'}`;
            descEl.innerHTML = currentLang === 'hi' ? 'अब इस राउंड के लिए अपना गुप्त हुकुम (Trump) चुनें।' : 'Now choose your Secret Trump suit for this round.';
        } else if (isPartner) {
            iconEl.innerText = '🤝';
            titleEl.innerHTML = currentLang === 'hi' ? `🤝 आपके साथी (${pDirName}) ने बोली जीती!` : `🤝 PARTNER (${pDirName}) WON THE BID!`;
            titleEl.style.color = '#38bdf8';
            badgeEl.innerText = `🎯 ${currentLang === 'hi' ? 'लक्ष्य' : 'Contract'}: ${bidValue} ${currentLang === 'hi' ? 'अंक' : 'pts'}`;
            descEl.innerHTML = currentLang === 'hi' ? 'आपका साथी गुप्त हुकुम चुन रहा है...' : 'Your partner is selecting Secret Trump...';
        } else {
            iconEl.innerText = '⚔️';
            titleEl.innerHTML = currentLang === 'hi' ? `⚔️ विरोधी (${pDirName}) ने बोली जीती!` : `⚔️ OPPONENT (${pDirName}) WON THE BID!`;
            titleEl.style.color = '#f87171';
            badgeEl.innerText = `🎯 ${currentLang === 'hi' ? 'लक्ष्य' : 'Contract'}: ${bidValue} ${currentLang === 'hi' ? 'अंक' : 'pts'}`;
            descEl.innerHTML = currentLang === 'hi' ? 'विरोधी खिलाड़ी गुप्त हुकुम चुन रहा है...' : 'Opponent is selecting Secret Trump...';
        }

        modal.style.display = 'block';
        if (this.bidWonTimer) clearTimeout(this.bidWonTimer);
        this.bidWonTimer = setTimeout(() => {
            this.dismissBidWonModal();
        }, 2500);
    }

    dismissBidWonModal() {
        const modal = document.getElementById('bid-won-modal');
        if (modal) {
            if (window.gsap && modal.style.display !== 'none') {
                gsap.to(modal, {
                    scale: 0.88,
                    opacity: 0,
                    duration: 0.22,
                    ease: "power2.in",
                    onComplete: () => {
                        modal.style.display = 'none';
                        gsap.set(modal, { scale: 1, opacity: 1 });
                        if (this.engine.phase === 'SET_TRUMP' && this.engine.currentTurn === mySeat && mySeat !== 99) {
                            this.showTrumpModal();
                        }
                    }
                });
                return;
            }
            modal.style.display = 'none';
        }
        if (this.engine.phase === 'SET_TRUMP' && this.engine.currentTurn === mySeat && mySeat !== 99) {
            this.showTrumpModal();
        }
    }

    showTrumpModal() {
        triggerHaptic('turn');
        const container = document.getElementById('trump-suit-options'); container.innerHTML = '';
        let t = I18N[currentLang];
        if (document.getElementById('trump-modal-title')) document.getElementById('trump-modal-title').innerText = t.selectTrump;
        if (document.getElementById('trump-modal-sub')) document.getElementById('trump-modal-sub').innerText = t.selectTrumpSub;
        this.engine.getAvailableSuits(mySeat).forEach(suit => {
            let btn = document.createElement('button');
            btn.className = 'suit-picker-btn';
            let suitName = t.suits[suit] || suit;
            btn.innerHTML = `<span style="font-size:1.4rem;">${suit}</span><span style="font-size:0.75rem; margin-top:2px;">${suitName.replace(suit, '').trim()}</span>`;
            btn.style.color = (suit === '♥' || suit === '♦') ? '#dc2626' : '#0f172a';
            btn.onclick = () => { 
                if (typeof mySeat !== 'undefined' && mySeat >= 0 && mySeat < 4) consecutiveTimeouts[mySeat] = 0;
                if(uiLocked) return; uiLocked = true;
                document.getElementById('trump-modal').style.display = 'none';
                if(gameMode === 'multi') sendNetMessage({type:'SET_TRUMP', suit: suit});
                else { this.engine.setTrump(suit); this.gameLoop(); }
            }; container.appendChild(btn);
        });
        uiLocked = false;
        document.getElementById('trump-modal').style.display = 'block';
    }

    onAskRevealClick() {
        clearTimeout(window._uiLockSafetyTimer);
        window._uiLockSafetyTimer = setTimeout(() => { uiLocked = false; }, 2000);
        document.getElementById('reveal-btn').style.display = 'none';
        if(gameMode === 'multi') sendNetMessage({type:'REVEAL_TRUMP', player: mySeat});
        else { this.engine.revealTrump(mySeat); this.gameLoop(); }
    }

    onDeclarePairClick() {
        const pBtn = document.getElementById('pair-btn');
        if (pBtn) pBtn.style.display = 'none';
        if (gameMode === 'multi') sendNetMessage({type:'DECLARE_PAIR', player: mySeat});
        this.playRoyalPairAnimation(mySeat, () => {
            this.engine.declarePair(mySeat);
            if (gameMode === 'multi' && isHost) {
                broadcastNetMessage({ type: 'UI_EVENT', pairEvent: { player: mySeat } });
                this.broadcastGameState();
            }
            this.syncTable();
            this.renderStaticBoard();
            this.gameLoop();
        });
    }

    startNewRound() {
        if (this.trickTimer) { clearTimeout(this.trickTimer); this.trickTimer = null; }
        if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
        if (this._aiWatchdogTimer) { clearTimeout(this._aiWatchdogTimer); this._aiWatchdogTimer = null; }
        if (this._trickAnimationWatchdog) { clearTimeout(this._trickAnimationWatchdog); this._trickAnimationWatchdog = null; }
        this.isAIThinking = false;
        this.animatingTrick = false;
        this.animatingReveal = false;
        this._lastEndedRoundId = null;
        uiLocked = false;
        document.getElementById('end-modal').style.display = 'none';
        document.getElementById('log-drawer').innerHTML = '';
        this.uiTrumpRevealed = false;
        this.animatingTrick = false;
        this.clearTrickWinnerHalo();
        const vault = document.getElementById('secret-trump-vault'); if (vault) vault.style.display = 'none';
        const watermark = document.getElementById('lead-suit-watermark'); if (watermark) { watermark.className = ''; watermark.innerHTML = ''; }
        if(isHost) {
            if(gameMode === 'multi') broadcastNetMessage({type:'NEW_ROUND_RESET'});
            this.engine.startRound();
            this.gameLoop();
        }
    }

    showEndModal() { 
        let totalRemaining = this.engine.players.reduce((sum, p) => sum + (p ? p.length : 0), 0);
        if (totalRemaining > 0) {
            console.warn(`[showEndModal] Aborted: ${totalRemaining} cards still held by players!`);
            this.engine.phase = 'PLAYING';
            this.gameLoop();
            return;
        }
        if (this._lastEndedRoundId === (this.engine.roundId || 1) && document.getElementById('end-modal')?.style.display === 'block') {
            return; // Already showed end modal for this round; prevent infinite animation loops
        }
        this._lastEndedRoundId = this.engine.roundId || 1;
        document.getElementById('end-modal').style.display = 'block'; 
        if (typeof hideYourTurnBanner === 'function') hideYourTurnBanner(); 
        let bidTeam = (this.engine.highestBidder === 0 || this.engine.highestBidder === 2) ? 1 : 2;
        let pts = bidTeam === 1 ? this.engine.t1TrickPts : this.engine.t2TrickPts;
        let t = I18N[currentLang] || I18N.en;
        let isHi = (currentLang === 'hi');
        
        let winningTeamNum = this.engine.roundSuccess ? bidTeam : (bidTeam === 1 ? 2 : 1);
        let losingTeamNum = (winningTeamNum === 1) ? 2 : 1;
        let winningTeamName = getTeamDisplayName(winningTeamNum);
        let losingTeamName = getTeamDisplayName(losingTeamNum);
        let biddingTeamName = getTeamDisplayName(bidTeam);

        let userTeam = (typeof mySeat !== 'undefined' && (mySeat === 1 || mySeat === 3)) ? 2 : 1;
        let isSpectator = (typeof mySeat !== 'undefined' && mySeat === 99);
        let isUserWinner = !isSpectator && (winningTeamNum === userTeam);
        let isUserLoser = !isSpectator && (losingTeamNum === userTeam);

        let endIconEl = document.getElementById('end-icon');
        let titleEl = document.getElementById('end-title');

        if (isUserWinner) {
            if (endIconEl) endIconEl.innerText = '🏆';
            titleEl.innerText = t.yourTeamWon || (isHi ? '🎉 आपकी टीम जीत गई!' : '🎉 YOUR TEAM WON!');
            titleEl.style.color = '#86efac';
        } else if (isUserLoser) {
            if (endIconEl) endIconEl.innerText = '💀';
            titleEl.innerText = t.yourTeamDefeated || (isHi ? '💀 आपकी टीम हार गई!' : '💀 YOUR TEAM WAS DEFEATED!');
            titleEl.style.color = '#fca5a5';
        } else {
            if (endIconEl) endIconEl.innerText = '🏆';
            titleEl.innerText = `${winningTeamName.toUpperCase()} WON!`;
            titleEl.style.color = 'var(--gold-bright)';
        }

        let outcomeText = '';
        if (isUserWinner) {
            if (bidTeam === userTeam) {
                outcomeText = isHi 
                    ? 'आपकी टीम ने अपना लक्ष्य सफलतापूर्वक पूरा कर लिया!' 
                    : 'Your Team successfully made the contract!';
            } else {
                outcomeText = isHi 
                    ? 'विरोधी टीम हार गई! आपकी टीम ने सफलतापूर्वक बचाव किया।' 
                    : 'Opponent Team was defeated! Your Team successfully defended.';
            }
        } else if (isUserLoser) {
            if (bidTeam === userTeam) {
                outcomeText = isHi 
                    ? 'आपकी टीम लक्ष्य से चूक गई (विरोधी टीम जीती)!' 
                    : 'Your Team fell short of the target (Opponent Team Won)!';
            } else {
                outcomeText = isHi 
                    ? 'विरोधी टीम जीत गई (उन्होंने अपना लक्ष्य पूरा कर लिया)!' 
                    : 'Opponent Team won (they achieved their target)!';
            }
        } else {
            outcomeText = `${winningTeamName} defeated ${losingTeamName}!`;
        }

        let msg = `<div style="font-size:clamp(0.84rem, 1.7vh, 0.98rem); font-weight:700; color:${isUserWinner ? '#86efac' : (isUserLoser ? '#fca5a5' : 'var(--gold-bright)')}; margin-bottom:8px;">${outcomeText}</div>`;
        msg += `<b>${biddingTeamName}</b> ${isHi ? 'का लक्ष्य' : 'target'}: <b style="color:var(--gold-bright)">${this.engine.currentBid}</b> | ${isHi ? 'स्कोर' : 'Scored'}: <b>${pts}</b> ${t.pts}.<br><br>`;

        if (isUserWinner) {
            if (bidTeam === userTeam) {
                msg += `<span style="color:var(--success); font-weight:700;">+${this.engine.gamePointsWon} ${t.gamePtsWon}</span>`;
            } else {
                let penPrefix = isHi ? 'विरोधी टीम पर दंड' : 'Opponents Penalized';
                msg += `<span style="color:var(--success); font-weight:700;">${penPrefix}: -${this.engine.gamePointsWon} ${t.gamePtsPenalty}</span>`;
            }
        } else if (isUserLoser) {
            if (bidTeam === userTeam) {
                msg += `<span style="color:var(--danger); font-weight:700;">-${this.engine.gamePointsWon} ${t.gamePtsPenalty}</span>`;
            } else {
                let oppPrefix = isHi ? 'विरोधी टीम को' : 'Opponents Won';
                msg += `<span style="color:var(--danger); font-weight:700;">${oppPrefix}: +${this.engine.gamePointsWon} ${t.gamePtsWon}</span>`;
            }
        } else {
            if (this.engine.roundSuccess) {
                msg += `<span style="color:var(--gold-bright); font-weight:700;">+${this.engine.gamePointsWon} ${t.gamePtsWon}</span>`;
            } else {
                msg += `<span style="color:var(--gold-bright); font-weight:700;">-${this.engine.gamePointsWon} ${t.gamePtsPenalty}</span>`;
            }
        }

        if (isUserWinner) {
            triggerVictoryConfetti();
            playSound('win');
        } else {
            playSound('lose');
        }
        
        document.getElementById('end-text').innerHTML = msg;
        document.getElementById('next-round-btn').innerText = t.dealNextRound;
        document.getElementById('next-round-btn').style.display = isHost ? 'inline-flex' : 'none';

        // AI Tactical Card: Hidden by default, toggled via dedicated button!
        const coachBox = document.getElementById('end-coach-box');
        if (coachBox) coachBox.style.display = 'none';

        const toggleBtn = document.getElementById('toggle-tactical-card-btn');
        if (toggleBtn) {
            toggleBtn.style.display = 'inline-flex';
            const label = document.getElementById('trc-toggle-label');
            const arrow = document.getElementById('trc-toggle-arrow');
            if (label) label.innerText = t.viewTacticalAnalysis || (isHi ? '🧠 AI सामरिक विश्लेषण देखें' : '🧠 View AI Tactical Analysis');
            if (arrow) arrow.innerText = '▾';
        }

        let telemetry = null;
        try {
            telemetry = this.engine.getRoundTelemetry();
        } catch (err) {
            console.warn('[showEndModal] getRoundTelemetry fallback:', err);
        }
        // Pre-render immediately with client-computed telemetry
        try {
            this.renderTacticalReportCard(null, telemetry);
        } catch (err) {
            console.warn('[showEndModal] renderTacticalReportCard error:', err);
        }

        BackendAPI.getRecap(
            this.engine.highestBidder,
            this.engine.currentBid,
            bidTeam,
            this.engine.t1TrickPts,
            this.engine.t2TrickPts,
            this.engine.roundSuccess,
            this.engine.trumpSuit,
            this.engine.pairDeclared,
            currentLang,
            this.engine.roundTricks || [],
            this.engine.trumpRevealEvent || null,
            playerCustomNames || [],
            telemetry
        ).then(res => {
            if (res) {
                try {
                    this.renderTacticalReportCard(res, telemetry);
                } catch (err) {
                    console.warn('[showEndModal] recap renderTacticalReportCard error:', err);
                }
            }
        }).catch(() => {
            // Pre-render already visible
        });
    }

    toggleTacticalReportCard() {
        const box = document.getElementById('end-coach-box');
        const label = document.getElementById('trc-toggle-label');
        const arrow = document.getElementById('trc-toggle-arrow');
        if (!box) return;
        const isHidden = (box.style.display === 'none' || !box.style.display);
        const t = I18N[currentLang] || I18N.en;
        const isHi = (currentLang === 'hi');

        if (isHidden) {
            box.style.display = 'block';
            if (label) label.innerText = t.hideTacticalAnalysis || (isHi ? '🧠 AI सामरिक विश्लेषण छिपाएं' : '🧠 Hide AI Tactical Analysis');
            if (arrow) arrow.innerText = '▴';
            if (window.gsap) {
                gsap.fromTo(box, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
                gsap.fromTo('.trc-section', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.06, ease: 'power2.out' });
            }
            const modal = document.getElementById('end-modal');
            if (modal) {
                setTimeout(() => {
                    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 80);
            }
        } else {
            box.style.display = 'none';
            if (label) label.innerText = t.viewTacticalAnalysis || (isHi ? '🧠 AI सामरिक विश्लेषण देखें' : '🧠 View AI Tactical Analysis');
            if (arrow) arrow.innerText = '▾';
        }
    }

    renderTacticalReportCard(res, telemetry) {
        const coachBox = document.getElementById('end-coach-box');
        if (!coachBox) return;

        let t = I18N[currentLang] || I18N.en;
        let isHi = (currentLang === 'hi');
        let titleEl = document.getElementById('end-coach-title');
        if (titleEl) titleEl.innerText = isHi ? 'AI सामरिक रिपोर्ट कार्ड' : 'AI Tactical Report Card';

        // Overall Grade Badge
        let grade = (res && res.overallGrade) ? res.overallGrade : (telemetry && telemetry.overallGrade ? telemetry.overallGrade : (this.engine.roundSuccess ? 'A-' : 'C+'));
        let gradeEl = document.getElementById('end-coach-grade-badge');
        if (gradeEl) {
            gradeEl.innerText = grade;
            gradeEl.className = 'trc-grade-badge';
            if (grade.startsWith('A')) gradeEl.classList.add('trc-grade-a');
            else if (grade.startsWith('B')) gradeEl.classList.add('trc-grade-b');
            else if (grade.startsWith('C')) gradeEl.classList.add('trc-grade-c');
            else gradeEl.classList.add('trc-grade-d');
        }

        // 1. Phase 1 Bidding Section
        let bData = (res && res.biddingVerdict && res.biddingVerdict.summary) 
            ? res.biddingVerdict 
            : (telemetry ? telemetry.bidding_audit : {});
        let bRatingEl = document.getElementById('trc-bidding-pill');
        let bRating = (bData && bData.rating) ? bData.rating : ((telemetry && telemetry.bidding_audit) ? telemetry.bidding_audit.rating : 'Optimal');
        if (bRatingEl) {
            bRatingEl.innerText = bRating;
            bRatingEl.className = 'trc-pill ' + (bRating.includes('Optimal') || bRating.includes('उत्कृष्ट') ? 'pill-optimal' : ((bRating.includes('Overbid') || bRating.includes('जोखिम')) ? 'pill-drop' : 'pill-warn'));
        }

        let d1Cards = (telemetry && telemetry.event_log && telemetry.event_log.bidding && telemetry.event_log.bidding.humanDeal1 && telemetry.event_log.bidding.humanDeal1.length) 
            ? telemetry.event_log.bidding.humanDeal1 
            : ((telemetry && telemetry.bidding_audit && telemetry.bidding_audit.deal1_cards && telemetry.bidding_audit.deal1_cards.length) 
                ? telemetry.bidding_audit.deal1_cards 
                : []);

        let bCardsEl = document.getElementById('trc-bidding-cards');
        if (bCardsEl) {
            bCardsEl.innerHTML = d1Cards.map(cStr => {
                let rank = cStr.slice(0, -1);
                let suit = cStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let cardPts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                return `<div class="trc-mini-card ${isRed ? 'red' : 'black'}" title="${cardPts} pt${cardPts !== 1 ? 's' : ''}">${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${cardPts})</span></div>`;
            }).join('');
        }

        let bSumEl = document.getElementById('trc-bidding-summary');
        let bSummary = (bData && bData.summary) ? bData.summary : ((telemetry && telemetry.bidding_audit) ? telemetry.bidding_audit.summary : '');
        if (!bSummary || !bSummary.trim()) {
            bSummary = isHi 
                ? 'अनुशासित रक्षात्मक खेल: शुरुआती चालों में पत्तों को सुरक्षित रखकर टीम के लिए मजबूत आधार तैयार किया गया।'
                : 'Disciplined play: South maintained solid position and saved key honors for defensive counters.';
        }
        if (bSumEl) bSumEl.innerText = bSummary;

        // 2. Turning Point Section
        let tpData = (res && res.turningPointTrick && res.turningPointTrick.trickNumber) 
            ? res.turningPointTrick 
            : (telemetry ? telemetry.turning_point : {});
        let tpTrickNum = tpData.trickNumber || (telemetry && telemetry.turning_point ? telemetry.turning_point.trickNumber : 1);
        let tpTitleEl = document.getElementById('trc-tp-title');
        if (tpTitleEl) {
            tpTitleEl.innerText = isHi ? `⚡ निर्णायक मोड़: ट्रिक ${tpTrickNum}` : `⚡ INFLECTION POINT: TRICK ${tpTrickNum}`;
        }
        let tpDropEl = document.getElementById('trc-tp-drop-badge');
        if (tpDropEl) {
            let dropText = tpData.winProbDrop ? `${tpData.winProbDrop} Pace` : '0% Pace';
            tpDropEl.innerText = dropText;
        }

        let cardPlayedStr = tpData.cardPlayed || (telemetry && telemetry.turning_point ? telemetry.turning_point.cardPlayed : '') || '';
        let optimalCardStr = tpData.optimalCard || (telemetry && telemetry.turning_point ? telemetry.turning_point.optimalCard : '') || cardPlayedStr;

        let playedEl = document.getElementById('trc-played-card');
        if (playedEl) {
            if (cardPlayedStr) {
                let rank = cardPlayedStr.slice(0, -1);
                let suit = cardPlayedStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let pts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                playedEl.className = `trc-mini-card ${isRed ? 'red' : 'black'}`;
                playedEl.innerHTML = `${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${pts}p)</span>`;
                playedEl.style.display = 'inline-flex';
            } else {
                playedEl.style.display = 'none';
            }
        }

        let optEl = document.getElementById('trc-optimal-card');
        if (optEl) {
            if (optimalCardStr) {
                let rank = optimalCardStr.slice(0, -1);
                let suit = optimalCardStr.slice(-1);
                let isRed = (suit === '♥' || suit === '♦');
                let pts = (rank === 'J' ? 3 : (rank === '9' ? 2 : ((rank === 'A' || rank === '10') ? 1 : 0)));
                optEl.className = `trc-mini-card ${isRed ? 'red' : 'black'}`;
                optEl.innerHTML = `${rank}${suit} <span style="font-size:0.55rem; color:#94a3b8; margin-left:2px;">(${pts}p)</span>`;
                optEl.style.display = 'inline-flex';
            } else {
                optEl.style.display = 'none';
            }
        }

        let tpExpEl = document.getElementById('trc-tp-explanation');
        let tpExplanation = (tpData && tpData.explanation && tpData.explanation.trim()) 
            ? tpData.explanation 
            : ((telemetry && telemetry.turning_point && telemetry.turning_point.explanation) ? telemetry.turning_point.explanation : '');
        if (!tpExplanation || !tpExplanation.trim()) {
            tpExplanation = isHi
                ? `ट्रिक ${tpTrickNum} इस राउंड की निर्णायक चाल रही जहाँ अंक और चाल का नियंत्रण तय हुआ।`
                : `Trick ${tpTrickNum} was the pivotal inflection trick of the round, deciding crucial trick points.`;
        }
        if (tpExpEl) tpExpEl.innerText = tpExplanation;

        // 3. Partner Synergy
        let synData = (res && res.partnerSynergy && res.partnerSynergy.note) 
            ? res.partnerSynergy 
            : (telemetry ? telemetry.partner_synergy : {});
        let synScoreEl = document.getElementById('trc-synergy-score');
        let synBarEl = document.getElementById('trc-synergy-bar');
        let synNoteEl = document.getElementById('trc-synergy-note');
        let score = (synData && synData.score !== undefined) ? synData.score : ((telemetry && telemetry.partner_synergy) ? telemetry.partner_synergy.score : 70);
        
        let synPill = score >= 80 ? (isHi ? '🌟 उत्कृष्ट तालमेल' : '🌟 High Synergy') : (score >= 60 ? (isHi ? '🤝 मजबूत साझेदारी' : '🤝 Solid Teamwork') : (isHi ? '⚠️ तालमेल की कमी' : '⚠️ Coordination Gap'));
        if (synScoreEl) synScoreEl.innerHTML = `${score}% <span style="font-size:0.58rem; color:#94a3b8; font-weight:600; margin-left:4px;">(${synPill})</span>`;
        if (synBarEl) synBarEl.style.width = `${score}%`;
        
        let synNote = (synData && synData.note) ? synData.note : ((telemetry && telemetry.partner_synergy) ? telemetry.partner_synergy.note : '');
        if (!synNote || !synNote.trim()) {
            synNote = isHi
                ? 'विंगमैन (नॉर्थ) के साथ तालमेल संतुलित रहा; अहम मौकों पर बड़े पत्तों का संरक्षण हुआ।'
                : 'Wingman maintained discipline in defense, backing your leads on critical tricks.';
        }
        if (synNoteEl) synNoteEl.innerText = synNote;
    }
}


// ===========================
// QoL UI IMPROVEMENTS JS
// ===========================

// --- Toast notifications ---
function showGameToast(msg, durationMs) {
    durationMs = durationMs || 2200;
    var container = document.getElementById('game-toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'game-toast';
    toast.innerHTML = msg;
    container.appendChild(toast);
    requestAnimationFrame(function() {
        requestAnimationFrame(function() { toast.classList.add('show'); });
    });
    setTimeout(function() {
        toast.classList.add('hiding');
        toast.classList.remove('show');
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, durationMs);
}

// --- Your Turn Banner ---
var _yourTurnBannerVisible = false;
var _yourTurnTimeout = null;
function showYourTurnBanner(msg, autoHideMs) {
    // Gate turn prompts behind modals, round over, and deal animations
    if (typeof ui !== 'undefined' && ui && ui.engine) {
        if (ui.engine.phase === 'DEALING_1' || ui.engine.phase === 'DEALING_2' || ui.engine.phase === 'ROUND_OVER' || ui.dealingAnimationActive || ui.animatingTrick) {
            hideYourTurnBanner();
            return;
        }
    }
    const endModal = document.getElementById('end-modal');
    const isModalOpen = (
        (document.getElementById('bid-won-modal')?.style.display === 'block') ||
        (document.getElementById('trump-modal')?.style.display === 'block') ||
        (document.getElementById('bid-modal')?.style.display === 'block') ||
        (endModal && endModal.style.display !== 'none' && endModal.style.display !== '')
    );
    if (isModalOpen) {
        hideYourTurnBanner();
        return;
    }

    var banner = document.getElementById('your-turn-banner');
    if (!banner) return;
    banner.querySelector('span').textContent = msg || '✨ YOUR TURN — Play a Card';
    if (!_yourTurnBannerVisible) {
        banner.classList.add('visible');
        _yourTurnBannerVisible = true;
    }
    clearTimeout(_yourTurnTimeout);
    if (autoHideMs > 0) {
        _yourTurnTimeout = setTimeout(hideYourTurnBanner, autoHideMs);
    }
}
function hideYourTurnBanner() {
    var banner = document.getElementById('your-turn-banner');
    if (banner) banner.classList.remove('visible');
    _yourTurnBannerVisible = false;
    clearTimeout(_yourTurnTimeout);
}

// --- HUD Score Flash ---
function flashTrickHUD() {
    var pill = document.getElementById('trick-hud-pill');
    if (!pill) return;
    pill.classList.remove('score-flash');
    void pill.offsetWidth;
    pill.classList.add('score-flash');
    setTimeout(function() { pill.classList.remove('score-flash'); }, 600);
}

// --- Keyboard Hint Bar ---
var _kbdHintShown = false;
var _kbdHintTimer = null;
function showKbdHintBar() {
    var bar = document.getElementById('kbd-hint-bar');
    if (!bar) return;
    bar.classList.add('show');
    clearTimeout(_kbdHintTimer);
    _kbdHintTimer = setTimeout(function() {
        bar.classList.remove('show');
    }, 3500);
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    var key = e.key;

    // 1-8: Play card at that playable index (1-based)
    if (key >= '1' && key <= '8') {
        var idx = parseInt(key) - 1;
        var playableCards = document.querySelectorAll('.my-cards-row .card.playable');
        if (playableCards[idx]) {
            playableCards[idx].click();
            document.body.classList.remove('kbd-mode');
        }
        // Show kbd hints on first press
        document.body.classList.add('kbd-mode');
        setTimeout(function() { document.body.classList.remove('kbd-mode'); }, 4000);
        showKbdHintBar();
        return;
    }

    // R: Reveal trump
    if (key === 'r' || key === 'R') {
        var revealBtn = document.getElementById('reveal-btn');
        if (revealBtn && revealBtn.style.display !== 'none' && !revealBtn.disabled) {
            revealBtn.click();
        }
        return;
    }

    // B: Pass bid
    if (key === 'b' || key === 'B') {
        var passBtn = document.getElementById('modal-pass-btn') || document.getElementById('pass-btn');
        if (passBtn && passBtn.offsetParent !== null) passBtn.click();
        return;
    }

    // Escape: close open modals / drawers
    if (key === 'Escape') {
        var logModal = document.getElementById('log-modal');
        if (logModal && logModal.style.display === 'block' && typeof toggleLogModal === 'function') {
            toggleLogModal();
            return;
        }
        var logDrawer = document.getElementById('log-drawer');
        if (logDrawer && logDrawer.classList.contains('open') && ui && ui.toggleLogDrawer) ui.toggleLogDrawer();
        var trackerDrawer = document.getElementById('tracker-drawer');
        if (trackerDrawer && trackerDrawer.classList.contains('open') && ui && ui.toggleTrackerDrawer) ui.toggleTrackerDrawer();
    }
});


// ==================== TEST HARNESS FOR UI FEATURES ====================
window.testUIFeatures = function() {
    if (typeof ui !== 'undefined' && ui && ui.playRoyalPairAnimation) {
        ui.playRoyalPairAnimation(0);
    }
    console.log("Testing UI features...");
    if (typeof showYourTurnBanner === 'function') {
        showYourTurnBanner("✨ YOUR TURN — Lead a Card (Test Demo)", 4000);
    }
    if (typeof showGameToast === 'function') {
        showGameToast("🏆 Test Toast: You won Trick 3! (+5 pts)", 3000);
        setTimeout(() => showGameToast("🚨 Test Toast: Trump Revealed: ♥ Hearts!", 3000), 1200);
    }
    if (typeof flashTrickHUD === 'function') {
        flashTrickHUD();
    }
    const pill = document.getElementById('trick-hud-pill');
    if (pill) {
        pill.classList.add('your-turn-active');
        setTimeout(() => pill.classList.remove('your-turn-active'), 4000);
    }
    // Also test card hints
    document.body.classList.add('kbd-mode');
    if (typeof showKbdHintBar === 'function') showKbdHintBar();
    setTimeout(() => document.body.classList.remove('kbd-mode'), 5000);
};

const game = new TwentyEightEngine();
const ui = new UIController(game);

// Document Visibility Listener: Prevents desync when tab is minimized or switched
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (typeof ui !== 'undefined' && ui && ui.dealingAnimationActive) {
            console.log("[visibilitychange] Tab hidden during deal animation: fast-forwarding dealing");
            ui.clearActiveDealAnimation();
            document.querySelectorAll('[data-seat]').forEach(c => {
                c.style.visibility = 'visible';
                c.style.opacity = '1';
            });
            for (let i = 0; i < 4; i++) {
                const b = document.getElementById(`badge-cnt-${i}`);
                if (b && ui.engine && ui.engine.players[i]) b.textContent = ui.engine.players[i].length;
                if (ui.engine) ui.engine.sortHand(i);
            }
            if (typeof isHost !== 'undefined' && isHost) {
                ui.engine.finishDealAnimation();
                if (typeof gameMode !== 'undefined' && gameMode === 'multi') ui.broadcastGameState();
            } else if (ui.engine) {
                if (ui.engine.phase === 'DEALING_1') ui.engine.phase = 'BIDDING';
                if (ui.engine.phase === 'DEALING_2') ui.engine.phase = 'PLAYING';
                ui.applyPendingMasterState();
            }
            ui.renderStaticBoard();
        }
        // Tab hidden / window minimized: cleanly finish running trick animations so GSAP ticker pause does not desync timers
        if (typeof ui !== 'undefined' && ui && ui.animatingTrick) {
            console.log("[visibilitychange] Tab hidden during trick animation: fast-resolving active trick");
            ui.clearActiveTrickAnimation();
            const table = document.getElementById('center-table');
            if (table) table.innerHTML = '';
            ui.clearTrickWinnerHalo();
            if (ui.engine && ui.engine.trickCards && ui.engine.trickCards.length === 4) {
                ui.engine.resolveTrick();
                if (typeof flashTrickHUD === 'function') flashTrickHUD();
            }
            ui.animatingTrick = false;
            if (typeof isHost !== 'undefined' && isHost) ui.broadcastGameState();
        }
    } else {
        // Tab returned to visible: wake GSAP ticker and sync UI board and hand
        console.log("[visibilitychange] Tab restored to foreground");
        if (window.gsap && gsap.ticker && gsap.ticker.wake) {
            gsap.ticker.wake();
        }
        if (typeof ui !== 'undefined' && ui && ui.engine) {
            ui.syncTable();
            ui.renderStaticBoard();
            if (ui.engine.phase === 'PLAYING' && ui.engine.currentTurn === mySeat && mySeat !== 99) {
                if (typeof showYourTurnBanner === 'function') {
                    showYourTurnBanner('✨ YOUR TURN', 0);
                }
            }
            if (!ui.animatingTrick && !ui.animatingReveal && !ui.dealingAnimationActive && ui.engine.phase !== 'ROUND_OVER') {
                ui.gameLoop();
            }
        }
    }
});
