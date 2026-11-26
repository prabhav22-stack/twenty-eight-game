/**
 * TwentyEightEngine - Authoritative 28 Card Game Rules & State Machine
 * Handles bidding, dealing, trick resolution, score calculation, and telemetry.
 */
import { InferenceMatrix } from './InferenceMatrix.js';
import { ISMCTS } from './ISMCTS.js';
import { TwentyEightDDS, DDS_SUITS, DDS_RANKS, DDS_RANK_VALUES, DDS_RANK_POWERS, DDS_SUIT_MASKS } from '../dds/TwentyEightDDS.js';
import { playSound } from '../ui/AudioHaptics.js';
import { currentLang } from '../ui/i18n.js';
import { recordMatchInCareer } from '../ui/stats.js';

const COMPASS_FULL = ['South', 'East', 'North', 'West'];

export class TwentyEightEngine {
    getOpponentProfile() {
        try {
            let p = localStorage.getItem('28_opponent_profile');
            return p ? JSON.parse(p) : { thetaBluff: 0.20, thetaBait: 0.20, thetaTrumpHoard: 0.20, roundsCount: 0 };
        } catch(e) {
            return { thetaBluff: 0.20, thetaBait: 0.20, thetaTrumpHoard: 0.20, roundsCount: 0 };
        }
    }

    updateOpponentProfile(observed) {
        let p = this.getOpponentProfile();
        const alpha = 0.25;
        if (typeof observed.bluffObserved === 'number') {
            p.thetaBluff = Math.round((alpha * observed.bluffObserved + (1 - alpha) * p.thetaBluff) * 1000) / 1000;
        }
        if (typeof observed.baitObserved === 'number') {
            p.thetaBait = Math.round((alpha * observed.baitObserved + (1 - alpha) * p.thetaBait) * 1000) / 1000;
        }
        if (typeof observed.trumpHoardObserved === 'number') {
            p.thetaTrumpHoard = Math.round((alpha * observed.trumpHoardObserved + (1 - alpha) * p.thetaTrumpHoard) * 1000) / 1000;
        }
        p.roundsCount = (p.roundsCount || 0) + 1;
        try {
            localStorage.setItem('28_opponent_profile', JSON.stringify(p));
        } catch(e) {}
        return p;
    }

    getSessionMemory() {
        try {
            let data = localStorage.getItem('28_session_memory');
            return data ? JSON.parse(data) : { humanOverbids: 0, humanBaitsJacks: 0, roundsPlayed: 0 };
        } catch (e) {
            return { humanOverbids: 0, humanBaitsJacks: 0, roundsPlayed: 0 };
        }
    }

    updateSessionMemory(update) {
        try {
            let mem = this.getSessionMemory();
            Object.assign(mem, update);
            localStorage.setItem('28_session_memory', JSON.stringify(mem));
        } catch (e) {}
    }

    constructor() {
        this.suits = ['♥', '♦', '♣', '♠'];
        this.ranks = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
        this.values = { 'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0 };
        this.power = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1 };
        this.t1GamePts = 0; this.t2GamePts = 0;
        this.roundStarter = 0;
        this.roundId = 0;
        this.stateSeq = 0;
        this.callbacks = { onLog: (msg) => {}, onBid: (pIndex, val) => {}, onBidWon: (pIndex, val) => {} };
        this.playedCardsHistory = []; 
        this.players = [[], [], [], []];
        this.phase = 'LOBBY';
        this.trickCards = [];
        this.playerBids = [null, null, null, null];
        this.roundTricks = [];
        this.trumpRevealEvent = null;
        this.justRevealedInCurrentTrick = false;
        this.justRevealedByPlayer = -1;
        this.inference = new InferenceMatrix();
        this.deal1Hands = [[], [], [], []];
        this.deal2Hands = [[], [], [], []];
        this.biddingHistory = [];
        this.humanBlunders = [];
        this.trickSnapshots = [];
        this.pendingPrematureReveal = null;
        this.roundEventLog = null;
    }

    resetRound() {
        this.roundId = (this.roundId || 0) + 1;
        this.stateSeq = (this.stateSeq || 0) + 1;
        this.deck = []; this.players = [[], [], [], []]; 
        this.currentBid = 15; this.highestBidder = -1;
        this.trumpSuit = null; this.trumpRevealed = false; this.phase2Hands = null;
        this.hasPassed = [false, false, false, false];
        this.playerBids = [null, null, null, null];
        this.hiddenTrumpCard = null; this.hasHiddenTrump = false;
        this.justRevealedBy = -1;
        this.pairDeclared = false; this.pairDeclaringTeam = -1;
        this.tricksWonByTeam = [0, 0];
        this.trickCards = []; this.leadSuit = null;
        this.t1TrickPts = 0; this.t2TrickPts = 0;
        this.currentTurn = this.roundStarter;
        this.roundStarter = (this.roundStarter + 1) % 4;
        this.passCount = 0; this.playedCardsHistory = [];
        this.roundTricks = [];
        this.trumpRevealEvent = null;
        this.justRevealedInCurrentTrick = false;
        this.justRevealedByPlayer = -1;
        this.voidInSuit = [
            {'♥':false, '♦':false, '♣':false, '♠':false},
            {'♥':false, '♦':false, '♣':false, '♠':false},
            {'♥':false, '♦':false, '♣':false, '♠':false},
            {'♥':false, '♦':false, '♣':false, '♠':false}
        ];
        this.bidderExcludedTrumps = new Set();
        this.remainingBySuit = {
            '♥': [...this.ranks],
            '♦': [...this.ranks],
            '♣': [...this.ranks],
            '♠': [...this.ranks]
        };
        this.inference = new InferenceMatrix();
        this.deal1Hands = [[], [], [], []];
        this.deal2Hands = [[], [], [], []];
        this.biddingHistory = [];
        this.humanBlunders = [];
        this.trickSnapshots = [];
        this.pendingPrematureReveal = null;
        this.roundEventLog = null;
    }

    log(msg) {
        this.callbacks.onLog(msg);
        if (gameMode === 'multi' && isHost) {
            broadcastNetMessage({type: 'UI_EVENT', log: msg});
        }
    }

    reshuffleRound(pIndex = 0) {
        let sameStarter = (this.roundStarter - 1 + 4) % 4;
        this.roundStarter = sameStarter;
        this.resetRound();
        this.phase2Hands = null;
        for (let suit of this.suits) {
            for (let rank of this.ranks) {
                this.deck.push({ suit, rank, value: this.values[rank], power: this.power[rank], isNew: false });
            }
        }
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let c = this.deck.pop();
                c.isNew = true;
                this.players[j].push(c);
            }
        }
        this.sortHand(0); this.sortHand(1); this.sortHand(2); this.sortHand(3);
        this.deal1Hands = this.players.map(p => p.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })));
        const hSeatRedeal = (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) ? mySeat : 0;
        this.roundEventLog = {
            roundId: Date.now(),
            bidding: {
                sequence: [],
                winner: null,
                contract: 16,
                trumpSuit: null,
                parPoints: 16,
                humanDeal1: (this.players && this.players[hSeatRedeal]) ? this.players[hSeatRedeal].map(c => `${c.rank}${c.suit}`) : []
            },
            trumpReveal: null,
            tricks: [],
            swingMoments: [],
            outcome: null
        };
        this.phase = 'DEALING_1';
        this.log(`🔄 Redeal requested by Player ${pIndex} (0 points in hand). Fresh hands dealt!`);
    }

    startRound() {
        this.resetRound();
        this.phase2Hands = null;
        for (let suit of this.suits) {
            for (let rank of this.ranks) {
                this.deck.push({ suit, rank, value: this.values[rank], power: this.power[rank], isNew: false });
            }
        }
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let c = this.deck.pop();
                c.isNew = true;
                this.players[j].push(c);
            }
        }
        this.sortHand(0); this.sortHand(1); this.sortHand(2); this.sortHand(3);
        this.deal1Hands = this.players.map(p => p.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })));
        const humanSeat = (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) ? mySeat : 0;
        this.roundEventLog = {
            roundId: Date.now(),
            bidding: {
                sequence: [],
                winner: null,
                contract: 16,
                trumpSuit: null,
                parPoints: 16,
                humanDeal1: (this.players && this.players[humanSeat]) ? this.players[humanSeat].map(c => `${c.rank}${c.suit}`) : []
            },
            trumpReveal: null,
            tricks: [],
            swingMoments: [],
            outcome: null
        };
        this.phase = 'DEALING_1';
        this.log("♣ Dealing first 4 cards — Bidding begins!");
    }

    finishDealAnimation() {
        for(let p of this.players) for(let c of p) c.isNew = false;
        for(let i=0; i<4; i++) this.sortHand(i);
        if(this.phase === 'DEALING_1') this.phase = 'BIDDING';
        if(this.phase === 'DEALING_2') this.phase = 'PLAYING';
    }

    sortHand(pIndex) {
        this.players[pIndex].sort((a,b) => this.suits.indexOf(a.suit) - this.suits.indexOf(b.suit) || this.power[b.rank] - this.power[a.rank]);
    }

    submitBid(pIndex, val) {
        if (this.currentTurn !== pIndex || this.phase !== 'BIDDING') return; 
        this.playerBids[pIndex] = val;
        this.biddingHistory.push({ player: pIndex, bid: val });
        if (this.roundEventLog && this.roundEventLog.bidding) {
            this.roundEventLog.bidding.sequence.push({ player: pIndex, bid: val });
        }

        if (val === 'Pass') { 
            this.hasPassed[pIndex] = true;
            this.passCount++;
            this.log(`Player ${pIndex} passed.`);
            playSound('pass');
            if(this.callbacks.onBid) this.callbacks.onBid(pIndex, 'Pass');
            if(gameMode === 'multi' && isHost) broadcastNetMessage({type:'UI_EVENT', bidEvent:{pIndex, val:'Pass', won:false}});
        } else { 
            this.currentBid = parseInt(val);
            this.highestBidder = pIndex;
            this.log(`Player ${pIndex} bids ${this.currentBid}`);
            playSound('bid');
            if(this.callbacks.onBid) this.callbacks.onBid(pIndex, this.currentBid);
            if(gameMode === 'multi' && isHost) broadcastNetMessage({type:'UI_EVENT', bidEvent:{pIndex, val:this.currentBid, won:false}});
        }

        let passedCount = this.hasPassed.filter(p => p).length;

        // 1. All 4 players passed without any bid -> Forced dealer bid at 16
        if (passedCount >= 4 && this.highestBidder === -1) {
            this.log("🔄 All passed — Dealer forced to 16.");
            this.currentBid = 16;
            this.highestBidder = pIndex;
            if (this.roundEventLog && this.roundEventLog.bidding) {
                this.roundEventLog.bidding.winner = this.highestBidder;
                this.roundEventLog.bidding.contract = 16;
            }
            this.phase = 'SET_TRUMP';
            this.currentTurn = this.highestBidder;
            if(this.callbacks.onBidWon) this.callbacks.onBidWon(this.highestBidder, 16);
            if(gameMode === 'multi' && isHost) {
                broadcastNetMessage({type:'UI_EVENT', bidEvent:{pIndex:this.highestBidder, val:16, won:true}});
                if (typeof ui !== 'undefined' && ui) ui.broadcastGameState();
            }
            return;
        }

        // 2. Three players passed and contract was bid -> Auction won!
        if (passedCount >= 3 && this.highestBidder !== -1) { 
            this.phase = 'SET_TRUMP'; 
            this.currentTurn = this.highestBidder;
            if (this.roundEventLog && this.roundEventLog.bidding) {
                this.roundEventLog.bidding.winner = this.highestBidder;
                this.roundEventLog.bidding.contract = this.currentBid;
            }
            this.log(`🎯 Player ${this.highestBidder} wins contract at ${this.currentBid}`); 
            if(this.callbacks.onBidWon) this.callbacks.onBidWon(this.highestBidder, this.currentBid);
            if(gameMode === 'multi' && isHost) {
                broadcastNetMessage({type:'UI_EVENT', bidEvent:{pIndex:this.highestBidder, val:this.currentBid, won:true}});
                if (typeof ui !== 'undefined' && ui) ui.broadcastGameState();
            }
            return;
        }

        // 3. Advance to the next active player who has NOT passed
        let nextTurn = (this.currentTurn + 1) % 4;
        let loopGuard = 0;
        while (this.hasPassed[nextTurn] && loopGuard < 4) {
            nextTurn = (nextTurn + 1) % 4;
            loopGuard++;
        }
        this.currentTurn = nextTurn;

        if(gameMode === 'multi' && isHost) {
            if (typeof ui !== 'undefined' && ui) ui.broadcastGameState();
        }
    }


    async getAIBidAsync() {
        let pIndex = this.currentTurn;
        this.lastBotBehavior = null;
        try {
            if (typeof BackendAPI !== 'undefined' && BackendAPI && BackendAPI.getBotBrain) {
                let payload = {
                    seat: COMPASS_FULL[pIndex],
                    player_idx: pIndex,
                    personality: pIndex === 2 ? 'Wingman' : (pIndex === 1 ? 'Striker' : 'Saboteur'),
                    phase: 'BIDDING',
                    botHand: (this.players[pIndex] || []).map(c => `${c.rank}${c.suit}`),
                    current_bid: this.currentBid,
                    highest_bidder: this.highestBidder,
                    sessionMemory: this.getSessionMemory(),
                    language: typeof currentLang !== 'undefined' ? currentLang : 'en'
                };
                let brainRes = await BackendAPI.getBotBrain(payload);
                if (brainRes && brainRes.chosenAction && brainRes.chosenAction.bid !== undefined) {
                    this.lastBotBehavior = brainRes.humanBehavior;
                    return brainRes.chosenAction.bid;
                }
            }
        } catch (e) {
            console.warn('Backend bot-brain bid error, using local AI:', e);
        }
        return this.getAIBid();
    }

    async getAITrumpAsync() {
        let pIndex = this.highestBidder;
        this.lastBotBehavior = null;
        try {
            if (typeof BackendAPI !== 'undefined' && BackendAPI && BackendAPI.getBotBrain) {
                let payload = {
                    seat: COMPASS_FULL[pIndex],
                    player_idx: pIndex,
                    personality: pIndex === 2 ? 'Wingman' : (pIndex === 1 ? 'Striker' : 'Saboteur'),
                    phase: 'SET_TRUMP',
                    botHand: (this.players[pIndex] || []).map(c => `${c.rank}${c.suit}`),
                    sessionMemory: this.getSessionMemory(),
                    language: typeof currentLang !== 'undefined' ? currentLang : 'en'
                };
                let brainRes = await BackendAPI.getBotBrain(payload);
                if (brainRes && brainRes.chosenAction && brainRes.chosenAction.suit) {
                    this.lastBotBehavior = brainRes.humanBehavior;
                    return brainRes.chosenAction.suit;
                }
            }
        } catch (e) {
            console.warn('Backend bot-brain trump error, using local AI:', e);
        }
        return this.getAITrump();
    }

    async getAIPlayAsync() {
        let pIndex = this.currentTurn;
        this.lastBotBehavior = null;
        try {
            if (typeof BackendAPI !== 'undefined' && BackendAPI && BackendAPI.getBotBrain) {
                let knownTrumpSuit = (this.trumpRevealed || pIndex === this.highestBidder) ? this.trumpSuit : null;
                let payload = {
                    seat: COMPASS_FULL[pIndex],
                    player_idx: pIndex,
                    personality: pIndex === 2 ? 'Wingman' : (pIndex === 1 ? 'Striker' : 'Saboteur'),
                    phase: 'PLAYING',
                    botHand: (this.players[pIndex] || []).map(c => `${c.rank}${c.suit}`),
                    currentTrick: (this.trickCards || []).map(tc => ({
                        seat: COMPASS_FULL[tc.player],
                        card: `${tc.card.rank}${tc.card.suit}`
                    })),
                    bidState: {
                        winner: COMPASS_FULL[this.highestBidder],
                        target: this.currentBid,
                        trumpRevealed: this.trumpRevealed,
                        trumpSuit: knownTrumpSuit
                    },
                    playedCardsHistory: (this.playedCardsHistory || []).map(c => `${c.rank}${c.suit}`),
                    knownVoids: this.voidInSuit,
                    teamPoints: { NS: this.t1TrickPts, EW: this.t2TrickPts },
                    sessionMemory: this.getSessionMemory(),
                    language: typeof currentLang !== 'undefined' ? currentLang : 'en'
                };
                let brainRes = await BackendAPI.getBotBrain(payload);
                if (brainRes && brainRes.chosenAction && typeof brainRes.chosenAction.cardIndex === 'number') {
                    let valids = this.getValidPlayIndices(pIndex);
                    if (valids.includes(brainRes.chosenAction.cardIndex)) {
                        this.lastBotBehavior = brainRes.humanBehavior;
                        return {
                            reveal: !!brainRes.chosenAction.revealTrump,
                            index: brainRes.chosenAction.cardIndex,
                            behavior: brainRes.humanBehavior
                        };
                    }
                }
            }
        } catch (e) {
            console.warn('Backend bot-brain play error, using local AI:', e);
        }
        return this.getAIPlay();
    }

    getAIBid() {
        let pIndex = this.currentTurn;
        let partnerIndex = (pIndex + 2) % 4;
        let hand = this.players[pIndex];

        let suitCounts = {'♥':0, '♦':0, '♣':0, '♠':0};
        let suitJacks = {'♥':0, '♦':0, '♣':0, '♠':0};
        let suitNines = {'♥':0, '♦':0, '♣':0, '♠':0};
        let totalJacks = 0;

        hand.forEach(c => {
            suitCounts[c.suit]++;
            if (c.rank === 'J') { suitJacks[c.suit] = 1; totalJacks++; }
            if (c.rank === '9') suitNines[c.suit] = 1;
        });

        // Expected Value (EV) 4-Card Bidding Formula:
        // BidEV = 12 + (TrumpLength * 1.8) + (HasTrumpJack * 3.5) + (HasTrumpNine * 2.5) + (SideJacks * 2.0)
        let bestSuit = this.suits[0];
        let bestEV = -1;

        for (let s of this.suits) {
            let trumpLen = suitCounts[s];
            let hasTrumpJ = suitJacks[s];
            let hasTrump9 = suitNines[s];
            let sideJacks = totalJacks - hasTrumpJ;
            let sideAces = hand.filter(c => c.suit !== s && c.rank === 'A').length;

            let ev = 12 + (trumpLen * 1.8) + (hasTrumpJ * 3.5) + (hasTrump9 * 2.5) + (sideJacks * 2.0) + (sideAces * 0.8);

            // Penalty for scattered 1-1-1-1 distribution (lacks concentrated trump power)
            let isScattered = Object.values(suitCounts).every(cnt => cnt <= 1);
            if (isScattered) ev -= 3.0;

            if (ev > bestEV) {
                bestEV = ev;
                bestSuit = s;
            }
        }

        // Partner Support & Signaling:
        if (this.highestBidder === partnerIndex) {
            // Partner already holds a firm bid (>=16). Support partner by passing!
            return 'Pass';
        }

        let isEnemy = (pIndex === 1 || pIndex === 3);
        if (currentDifficulty === 'easy' && isEnemy) {
            if (this.highestBidder === -1 && this.passCount === 3) return 16;
            return 'Pass';
        }

        let maxWilling = Math.round(bestEV);
        if (currentDifficulty === 'medium') {
            maxWilling = Math.min(19, maxWilling - 1);
        }

        // Personality Weaponization in Bidding & Opponent Bluff Calibration:
        const oppProf = this.getOpponentProfile();
        if (pIndex === 1) {
            // Striker (East): Scale overbid aggression against human bluff frequency (Framework 4)
            let bluffScale = (1.0 - 0.3 * oppProf.thetaBluff);
            if (bestEV * bluffScale >= 16.5) maxWilling += 1;
        } else if (pIndex === 3) {
            // Saboteur (West): Opportunistic bidder
            if (bestEV >= 17 && bestEV < 20) maxWilling += 1;
        } else if (pIndex === 2) {
            // Wingman (North): Disciplined team player
            maxWilling = Math.min(22, maxWilling);
        }

        if (maxWilling > 24) maxWilling = 24;

        let aiBid = 'Pass';
        if (this.currentBid < maxWilling) {
            aiBid = Math.max(16, this.currentBid + 1);
        }
        if (this.highestBidder === -1 && this.passCount === 3) aiBid = 16;
        return aiBid;
    }

    getAvailableSuits(pIndex) { return [...new Set(this.players[pIndex].map(c => c.suit))]; }

    setTrump(suit) {
        if (this.phase !== 'SET_TRUMP') return; 
        this.trumpSuit = suit;
        this.hiddenTrumpCard = null;
        this.hasHiddenTrump = false;
        if (this.roundEventLog && this.roundEventLog.bidding) {
            this.roundEventLog.bidding.trumpSuit = suit;
            this.roundEventLog.bidding.winner = this.highestBidder;
            this.roundEventLog.bidding.contract = this.currentBid;
        }
        this.log(`🤫 Player ${this.highestBidder} chose Secret Trump.`);
        playSound('trump_select');

        if (this.phase2Hands && this.phase2Hands.length === 4) {
            for (let j = 0; j < 4; j++) {
                for (let c of this.phase2Hands[j]) {
                    c.isNew = true;
                    this.players[j].push(c);
                }
            }
            this.phase2Hands = null;
        } else {
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 4; j++) {
                    let c = this.deck.pop();
                    if (c) {
                        c.isNew = true;
                        this.players[j].push(c);
                    }
                }
            }
        }
        this.deal2Hands = [
            this.players[0].slice(4).map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })),
            this.players[1].slice(4).map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })),
            this.players[2].slice(4).map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })),
            this.players[3].slice(4).map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power }))
        ];
        // Defer hand sorting until round 2 dealing animation finishes to avoid vanished cards and scrambled slots
        this.phase = 'DEALING_2';
        this.currentTurn = this.highestBidder;
    }

    getAITrump() {
        let pIndex = this.highestBidder;
        let hand = this.players[pIndex];
        let suitScores = {'♥':0, '♦':0, '♣':0, '♠':0};
        let suitLengths = {'♥':0, '♦':0, '♣':0, '♠':0};
        hand.forEach(c => {
            suitScores[c.suit] += c.power + (c.value * 2);
            suitLengths[c.suit]++;
        });
        let avail = this.getAvailableSuits(pIndex);

        // Rule 3 (Single-Trump Trap Avoidance): Avoid picking a 1-card suit if multi-card suit exists
        let multiCardSuits = avail.filter(s => suitLengths[s] >= 2);
        let candidates = multiCardSuits.length > 0 ? multiCardSuits : avail;

        let bestSuit = candidates[0];
        let bestScore = -1;
        for (let s of candidates) {
            let score = (suitLengths[s] * 12) + suitScores[s];
            if (score > bestScore) { bestScore = score; bestSuit = s; }
        }
        return bestSuit;
    }

    hasPair(pIndex) {
        if (!this.trumpRevealed || !this.trumpSuit) return false;
        let hand = this.players[pIndex];
        let hasKing = hand.some(c => c.suit === this.trumpSuit && c.rank === 'K');
        let hasQueen = hand.some(c => c.suit === this.trumpSuit && c.rank === 'Q');
        return hasKing && hasQueen;
    }

    canDeclarePair(pIndex) {
        if (this.pairDeclared || !this.hasPair(pIndex)) return false;
        let teamIdx = (pIndex === 0 || pIndex === 2) ? 0 : 1;
        let roundTricksWon = (this.roundTricks || []).filter(t => {
            let winP = (t.winner !== undefined) ? t.winner : (t.winningPlayer !== undefined ? t.winningPlayer : -1);
            return ((winP === 0 || winP === 2) ? 0 : 1) === teamIdx;
        }).length;
        return (this.tricksWonByTeam[teamIdx] > 0 || roundTricksWon > 0);
    }

    declarePair(pIndex) {
        if (this.pairDeclared || !this.hasPair(pIndex)) return;
        let team = (pIndex === 0 || pIndex === 2) ? 1 : 2;
        let biddingTeam = (this.highestBidder === 0 || this.highestBidder === 2) ? 1 : 2;
        this.pairDeclared = true;
        this.pairDeclaringTeam = team;
        playSound('pair');

        let oldBid = this.currentBid;
        if (team === biddingTeam) {
            // Rule: Contract cannot drop below 16 (16 is minimum ceiling/floor)
            this.currentBid = Math.max(16, this.currentBid - 4);
            let diff = oldBid - this.currentBid;
            let reductionMsg = diff > 0 
                ? `Target reduced from ${oldBid} to ${this.currentBid} (-${diff} pts).`
                : `Target remains 16 pts (minimum contract ceiling).`;
            this.log(`👑 Player ${pIndex} declared Royal K-Q Pair! ${reductionMsg}`);
        } else {
            this.currentBid = Math.min(28, this.currentBid + 4);
            let diff = this.currentBid - oldBid;
            this.log(`👑 Player ${pIndex} declared Royal K-Q Pair! Target raised from ${oldBid} to ${this.currentBid} (+${diff} pts).`);
        }
        this.lastPairDeclaration = { player: pIndex, team, oldBid, newBid: this.currentBid, suit: this.trumpSuit };
    }

    canRevealTrump(pIndex) {
        if (this.trumpRevealed) return false;
        // Secret trump must have been chosen by bidder (direct suit or hidden trump in multiplayer)
        if (!this.trumpSuit && !this.hasHiddenTrump && !this.trumpSet) return false;
        if (this.phase !== 'PLAYING') return false;
        if (this.currentTurn !== pIndex) return false;
        // The player starting the hand can NEVER open the trump:
        if (this.trickCards.length === 0) return false;
        // Allowed in ANY hand (first, second, or later) if the player does NOT have the suit of the card being played:
        let hand = this.players[pIndex] || [];
        let hasLeadSuit = hand.some(c => c.suit === this.leadSuit);
        if (hasLeadSuit) return false;
        return true;
    }

    getValidPlayIndices(pIndex) {
        let hand = this.players[pIndex] || [];
        if (hand.length === 0) return [];

        // 1. LEADING A TRICK: Player can lead any card from their hand
        if (this.trickCards.length === 0) {
            return hand.map((_, i) => i);
        }

        // 2. FOLLOWING THE SUIT LED
        let hasLeadSuit = hand.some(c => c.suit === this.leadSuit);
        if (hasLeadSuit) {
            return hand.map((c, i) => c.suit === this.leadSuit ? i : -1).filter(i => i !== -1);
        }

        // 3. VOID IN SUIT LED
        // If this player just explicitly revealed trump on this turn, they must play trump if they have one
        if (this.justRevealedBy === pIndex && this.trumpRevealed) {
            let trumps = hand.map((c, i) => c.suit === this.trumpSuit ? i : -1).filter(i => i !== -1);
            if (trumps.length > 0) return trumps;
        }

        return hand.map((_, i) => i);
    }

    playCard(pIndex, cardIndex) {
        if (this.currentTurn !== pIndex || this.phase !== 'PLAYING') return; 
        let hand = this.players[pIndex];
        if (!hand || hand.length === 0) return;

        let validIndices = this.getValidPlayIndices(pIndex);
        if (!validIndices || validIndices.length === 0) validIndices = hand.map((_, i) => i);
        if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= hand.length || !validIndices.includes(cardIndex)) {
            cardIndex = validIndices[0];
        }

        if (this.trickCards.length === 0) {
            let currentTrickNum = this.roundTricks.length + 1;
            this.trickSnapshots.push({
                trickNum: currentTrickNum,
                hands: this.players.map(h => (h || []).map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power })))
            });
        }
        let humanSeat = (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) ? mySeat : 0;
        if (pIndex === humanSeat && this.players[pIndex] && this.players[pIndex][cardIndex]) {
            let cardToPlay = this.players[pIndex][cardIndex];
            let handBeforePlay = this.players[pIndex].map(c => ({ suit: c.suit, rank: c.rank, value: c.value, power: c.power }));
            this.detectHumanBlunder(this.roundTricks.length + 1, cardToPlay, handBeforePlay, this.trickCards);
        }
        let card = hand.splice(cardIndex, 1)[0];
        if (!card) return;

        if (this.trickCards.length === 0) {
            this.leadSuit = card.suit;
            // Secret Trump Deduction: Bidder cannot lead secret trump in Phase 1
            if (!this.trumpRevealed && pIndex === this.highestBidder) {
                if (card.suit !== this.trumpSuit) {
                    if (this.bidderExcludedTrumps) this.bidderExcludedTrumps.add(card.suit);
                    if (this.inference) this.inference.recordBidderLead(card.suit);
                }
            }
        } else if (this.leadSuit && card.suit !== this.leadSuit) {
            if (this.voidInSuit && this.voidInSuit[pIndex]) {
                this.voidInSuit[pIndex][this.leadSuit] = true;
            }
        }

        // CardMemory Matrix: Remove played card from remainingBySuit for dynamic boss promotion
        if (this.remainingBySuit && this.remainingBySuit[card.suit]) {
            let rIdx = this.remainingBySuit[card.suit].indexOf(card.rank);
            if (rIdx !== -1) this.remainingBySuit[card.suit].splice(rIdx, 1);
        }

        this.justRevealedBy = -1;
        this.trickCards.push({ card, player: pIndex });
        this.playedCardsHistory.push(card);
        if (this.inference) this.inference.recordCardPlay(pIndex, card, this.leadSuit);
        this.log(`🃏 Player ${pIndex} plays ${card.rank}${card.suit}`);

        this.currentTurn = (this.currentTurn + 1) % 4;
        if (this.trickCards.length === 4) this.phase = 'TRICK_OVER';
    }

    _isCardHighestRemaining(card) {
        if (!card) return false;
        if (this.remainingBySuit && this.remainingBySuit[card.suit]) {
            let remaining = this.remainingBySuit[card.suit];
            if (remaining.length === 0) return true;
            return card.rank === remaining[0]; // Remaining ranks are sorted J -> 9 -> A -> 10 -> ...
        }
        if (card.rank === 'J') return true;
        let higherRanks = this.ranks.filter(r => this.power[r] > this.power[card.rank]);
        for (let r of higherRanks) {
            let played = this.playedCardsHistory.some(c => c.rank === r && c.suit === card.suit);
            let inTrick = this.trickCards.some(tc => tc.card.rank === r && tc.card.suit === card.suit);
            if (!played && !inTrick) return false;
        }
        return true;
    }

    _getBossCardOfSuit(suit) {
        if (this.remainingBySuit && this.remainingBySuit[suit] && this.remainingBySuit[suit].length > 0) {
            return this.remainingBySuit[suit][0];
        }
        return null;
    }

    _countPointsInTrick() { return this.trickCards.reduce((sum, tc) => sum + tc.card.value, 0); }

    _getCurrentTrickWinner() {
        if (this.trickCards.length === 0) return null;
        let winningPlay = this.trickCards[0];
        for (let tc of this.trickCards) {
            let isTcTrump = (this.trumpRevealed && tc.card.suit === this.trumpSuit);
            let isWinnerTrump = (this.trumpRevealed && winningPlay.card.suit === this.trumpSuit);
            if (isTcTrump && !isWinnerTrump) winningPlay = tc;
            else if (isTcTrump && isWinnerTrump && tc.card.power > winningPlay.card.power) winningPlay = tc;
            else if (!isTcTrump && !isWinnerTrump && tc.card.suit === this.leadSuit && tc.card.power > winningPlay.card.power) winningPlay = tc;
        }
        return winningPlay;
    }

    getAIPlay() {
        let pIndex = this.currentTurn;
        let hand = this.players[pIndex];
        let partnerIndex = (pIndex + 2) % 4;
        let opp1 = (pIndex + 1) % 4;
        let opp2 = (pIndex + 3) % 4;

        // Difficulty adjustment for offline/local AI fallback
        let isEnemy = (pIndex === 1 || pIndex === 3);
        if (currentDifficulty === 'easy' && isEnemy) {
            let validIndices = this.getValidPlayIndices(pIndex);
            if (validIndices.length === 0) validIndices = hand.map((_, i) => i);
            if (this.trickCards.length > 0 && !validIndices.some(i => hand[i].suit === this.leadSuit)) {
                let nonTrumps = validIndices.filter(i => !this.trumpRevealed || hand[i].suit !== this.trumpSuit);
                if (nonTrumps.length > 0) {
                    nonTrumps.sort((a, b) => hand[a].power - hand[b].power);
                    return { reveal: false, index: nonTrumps[0] };
                }
            }
            validIndices.sort((a, b) => hand[a].power - hand[b].power);
            return { reveal: false, index: validIndices[0] };
        }

        let knownTrumpSuit = (this.trumpRevealed || pIndex === this.highestBidder) ? this.trumpSuit : null;
        let holdsUndeclaredPair = knownTrumpSuit && !this.pairDeclared &&
            hand.some(c => c.suit === knownTrumpSuit && c.rank === 'K') &&
            hand.some(c => c.suit === knownTrumpSuit && c.rank === 'Q');

        // Tactical Secret Trump Deduction & The "Anti-Reveal" Trap
        if (this.canRevealTrump(pIndex)) {
            let currentWinner = this._getCurrentTrickWinner();
            let partnerWinning = (currentWinner && currentWinner.player === partnerIndex);
            let trickPts = this._countPointsInTrick();
            let isLastPlayer = (this.trickCards.length === 3);

            let isPartnerBoss = currentWinner && currentWinner.card && this._isCardHighestRemaining(currentWinner.card);
            let isPartnerHighHonor = currentWinner && currentWinner.card && (currentWinner.card.rank === 'J' || currentWinner.card.rank === '9');

            let defendingNeeded = (29 - this.currentBid) - this.t2TrickPts;

            // Check Anti-Reveal conditions:
            // 1. Partner is already winning (especially with Jack/9 or Boss card): NEVER reveal!
            if (partnerWinning && (isPartnerBoss || isPartnerHighHonor || isLastPlayer)) {
                // Do NOT reveal trump: slough / fatten points onto partner instead!
            }
            // 2. Zero-Point Junk Trick early in the round (<= 3 tricks): don't expose secret trump for 0 pts!
            else if (trickPts === 0 && this.roundTricks.length <= 2) {
                // Do NOT reveal trump: discard low trash (7 or 8) to create secondary void!
            }
            const chooseBestRevealPlay = () => {
                let trumps = hand.map((c, i) => c.suit === this.trumpSuit ? i : -1).filter(i => i !== -1);
                if (trumps.length > 0) {
                    trumps.sort((a, b) => hand[a].power - hand[b].power);
                    let currentWinner = this._getCurrentTrickWinner();
                    let winningTrump = trumps.find(i => !currentWinner || !currentWinner.card || currentWinner.card.suit !== this.trumpSuit || hand[i].power > currentWinner.card.power);
                    return winningTrump !== undefined ? winningTrump : trumps[0];
                }
                let nonTrumps = hand.map((c, i) => i);
                nonTrumps.sort((a, b) => (hand[a].value * 10 + hand[a].power) - (hand[b].value * 10 + hand[b].power));
                return nonTrumps[0] || 0;
            };

            // 3. Saboteur Contract-Breaker Check: If defending team needs <= 3 pts, reveal and cut trick >= 2 pts!
            if (pIndex === 3 && defendingNeeded <= 3 && trickPts >= 2) {
                return { reveal: true, index: chooseBestRevealPlay() };
            }
            // 4. Reveal Criteria: Only reveal if trick has >= 2 points at stake, or opponent played high honor,
            // or bot holds strong trumps to seize control of the board.
            else {
                let hasStrongTrumps = hand.some(c => c.suit === this.trumpSuit && (c.rank === 'J' || c.rank === '9'));
                let highOpponentCard = currentWinner && currentWinner.card && ['J', '9', 'A', '10'].includes(currentWinner.card.rank);
                if (trickPts >= 2 || highOpponentCard || hasStrongTrumps) {
                    return { reveal: true, index: chooseBestRevealPlay() };
                }
            }
        }

        let validIndices = this.getValidPlayIndices(pIndex);
        if (validIndices.length === 0) validIndices = hand.map((_, i) => i);
        if (validIndices.length === 1) return { reveal: false, index: validIndices[0] };

        // Information Set Monte Carlo Tree Search (ISMCTS) with AlphaZero PUCT & Dynamic Utilities
        let botRole = pIndex === 2 ? 'wingman' : (pIndex === 1 ? 'striker' : 'saboteur');
        let rollouts = currentDifficulty === 'hard' ? 70 : (currentDifficulty === 'medium' ? 40 : 20);
        let mathPriors = (typeof ui !== 'undefined' && ui && ui.cachedMathPriors) ? ui.cachedMathPriors : null;
        let oppProfile = this.getOpponentProfile();

        // Discard evaluation function (defining dumpCost eliminates ReferenceError risks)
        const discardCost = (idx) => {
            let c = hand[idx];
            let isTrump = (knownTrumpSuit && c.suit === knownTrumpSuit) ? 1 : 0;
            return (isTrump * 50) + (c.value * 10) + c.power;
        };
        const dumpCost = discardCost; // Explicitly define dumpCost alias

        try {
            let bestIdx = ISMCTS.selectBestPlay({
                hand: hand,
                validIndices: validIndices,
                trickCards: this.trickCards,
                leadSuit: this.leadSuit,
                trumpSuit: knownTrumpSuit,
                trumpRevealed: this.trumpRevealed,
                playerIdx: pIndex,
                personality: botRole,
                inference: this.inference,
                currentBid: this.currentBid,
                t1Points: this.t1TrickPts,
                t2Points: this.t2TrickPts,
                highestBidder: this.highestBidder,
                utilityWeights: mathPriors ? mathPriors.utilityWeights : null,
                movePriors: mathPriors ? mathPriors.movePriors : null,
                trumpPriors: mathPriors ? mathPriors.trumpSuitPriors : null,
                opponentProfile: oppProfile,
                numRollouts: rollouts
            });
            if (bestIdx !== undefined && bestIdx !== null && validIndices.includes(bestIdx)) {
                return { reveal: false, index: bestIdx };
            }
        } catch (mctsErr) {
            console.warn("ISMCTS evaluation error, executing tactical fallback:", mctsErr);
        }

        // Tactical Rule-based Fallback (safe with defined discardCost/dumpCost)
        let winningPlay = this._getCurrentTrickWinner();
        let isLastPlayer = (this.trickCards.length === 3);
        let isPartnerWinning = (winningPlay && winningPlay.player === partnerIndex);

        if (isPartnerWinning) {
            let partnerSafe = isLastPlayer || (winningPlay.card && this._isCardHighestRemaining(winningPlay.card));
            if (partnerSafe) {
                let smearCandidates = [...validIndices].sort((a, b) => {
                    let aTrump = (knownTrumpSuit && hand[a].suit === knownTrumpSuit) ? 1 : 0;
                    let bTrump = (knownTrumpSuit && hand[b].suit === knownTrumpSuit) ? 1 : 0;
                    if (aTrump !== bTrump) return aTrump - bTrump;
                    return hand[b].value - hand[a].value || hand[a].power - hand[b].power;
                });
                return { reveal: false, index: smearCandidates[0] };
            }
            validIndices.sort((a, b) => dumpCost(a) - dumpCost(b));
            return { reveal: false, index: validIndices[0] };
        } else {
            let winningIndices = validIndices.filter(i => {
                let c = hand[i];
                let isCTrump = (this.trumpRevealed && c.suit === this.trumpSuit);
                let isWTrump = (winningPlay && this.trumpRevealed && winningPlay.card && winningPlay.card.suit === this.trumpSuit);
                if (isCTrump && !isWTrump) return true;
                if (isCTrump && isWTrump && winningPlay.card && c.power > winningPlay.card.power) return true;
                if (!isCTrump && !isWTrump && c.suit === this.leadSuit && winningPlay && winningPlay.card && c.power > winningPlay.card.power) return true;
                return false;
            });

            if (winningIndices.length > 0) {
                if (isLastPlayer) {
                    winningIndices.sort((a, b) => hand[a].power - hand[b].power);
                    return { reveal: false, index: winningIndices[0] };
                } else {
                    let masterWinners = winningIndices.filter(i => this._isCardHighestRemaining(hand[i]));
                    if (masterWinners.length > 0) return { reveal: false, index: masterWinners[0] };
                    winningIndices.sort((a, b) => hand[a].power - hand[b].power);
                    return { reveal: false, index: winningIndices[0] };
                }
            }

            validIndices.sort((a, b) => dumpCost(a) - dumpCost(b));
            return { reveal: false, index: validIndices[0] };
        }
    }

    resolveTrick() {
        if (!this.trickCards || this.trickCards.length !== 4) {
            console.warn(`[resolveTrick] Aborted: trick has ${this.trickCards ? this.trickCards.length : 0} cards (expected 4)`);
            return;
        }
        let winningPlay = this._getCurrentTrickWinner();
        if (!winningPlay) winningPlay = { player: 0, card: null };
        let trickPoints = Number(this._countPointsInTrick()) || 0;
        
        let winTeam = (winningPlay.player === 0 || winningPlay.player === 2) ? 0 : 1;
        if (this.trumpRevealed) this.tricksWonByTeam[winTeam]++;

        if (winTeam === 0) this.t1TrickPts = (Number(this.t1TrickPts) || 0) + trickPoints;
        else this.t2TrickPts = (Number(this.t2TrickPts) || 0) + trickPoints;

        // Record trick telemetry for deeply grounded AI Match Analysis
        let trickHonors = (this.trickCards || [])
            .filter(tc => tc.card && tc.card.value > 0)
            .map(tc => ({
                rank: tc.card.rank,
                suit: tc.card.suit,
                pts: tc.card.value,
                player: tc.player,
                seat: COMPASS_FULL[tc.player] || `Player ${tc.player}`
            }));

        let currentTrickNum = this.roundTricks.length + 1;
        let trickRecord = {
            trickNum: currentTrickNum,
            leader: this.trickCards[0] ? this.trickCards[0].player : 0,
            leaderSeat: this.trickCards[0] ? COMPASS_FULL[this.trickCards[0].player] : 'South',
            winningPlayer: winningPlay.player,
            winningSeat: COMPASS_FULL[winningPlay.player] || `Player ${winningPlay.player}`,
            winningTeam: winTeam + 1,
            winningCard: winningPlay.card ? `${winningPlay.card.rank}${winningPlay.card.suit}` : '',
            points: trickPoints,
            honors: trickHonors,
            plays: (this.trickCards || []).map(tc => ({
                player: tc.player,
                card: tc.card ? { suit: tc.card.suit, rank: tc.card.rank, value: tc.card.value, power: tc.card.power } : null
            })),
            trumpRevealedThisTrick: this.justRevealedInCurrentTrick ? {
                by: this.justRevealedByPlayer,
                seat: COMPASS_FULL[this.justRevealedByPlayer] || `Player ${this.justRevealedByPlayer}`,
                suit: this.trumpSuit
            } : null,
            t1TotalAfter: this.t1TrickPts,
            t2TotalAfter: this.t2TrickPts
        };
        if (this.pendingPrematureReveal) {
            if (winTeam !== 0) {
                let pInfo = this.pendingPrematureReveal;
                let reason = pInfo.partnerWinning ? "when North was already winning" : `on a low-value trick (${pInfo.trickPoints} pts)`;
                this.humanBlunders.push({
                    tag: 'PREMATURE_TRUMP_REVEAL',
                    trickNum: pInfo.trickNum,
                    cardPlayed: winningPlay.card ? `${winningPlay.card.rank}${winningPlay.card.suit}` : 'Trump',
                    details: `Trick ${pInfo.trickNum}: South exposed the Secret Trump (${this.trumpSuit}) ${reason} and failed to win it.`,
                    pointSwing: 3
                });
            }
            this.pendingPrematureReveal = null;
        }
        this.roundTricks.push(trickRecord);
        if (this.roundEventLog) {
            this.roundEventLog.tricks.push({
                trickNum: trickRecord.trickNum,
                leadSeat: trickRecord.leader,
                plays: (this.trickCards || []).map(tc => ({
                    player: tc.player,
                    card: tc.card ? `${tc.card.rank}${tc.card.suit}` : '',
                    pts: (tc.card && tc.card.value !== undefined) ? tc.card.value : 0
                })),
                winningPlayer: trickRecord.winningPlayer,
                winningTeam: trickRecord.winningTeam,
                points: trickRecord.points,
                t1Total: trickRecord.t1TotalAfter,
                t2Total: trickRecord.t2TotalAfter
            });
        }
        this.justRevealedInCurrentTrick = false;
        this.justRevealedByPlayer = -1;

        playSound('trick');
        this.log(`🏆 Player ${winningPlay.player} wins trick (+${trickPoints} pts)`);
        this.trickCards = [];
        this.leadSuit = null; 
        this.currentTurn = winningPlay.player;
        
        let totalRemaining = this.players[0].length + this.players[1].length + this.players[2].length + this.players[3].length;
        if (totalRemaining === 0 && this.roundTricks.length >= 8) {
            if (!this.trumpRevealed) this.revealTrump(this.highestBidder, true);
            this.calculateRoundScore();
            if (this.roundEventLog) {
                this.roundEventLog.outcome = {
                    t1Pts: this.t1TrickPts,
                    t2Pts: this.t2TrickPts,
                    contract: this.currentBid,
                    biddingTeam: (this.highestBidder === 0 || this.highestBidder === 2) ? 1 : 2,
                    success: this.roundSuccess
                };
            }
            this.phase = 'ROUND_OVER';
        } else {
            this.phase = 'PLAYING';
        }
    }


    detectHumanBlunder(trickNum, card, handBeforePlay, trickCardsSoFar) {
        if (!card) return;
        let leadSuit = (trickCardsSoFar.length > 0) ? trickCardsSoFar[0].card.suit : card.suit;
        let seatInTrick = trickCardsSoFar.length; // 0=lead, 1=second, 2=third, 3=fourth

        // 1. DRY_9_AMBUSH: Human leads or plays a 9 (2 pts) when Jack of that suit is still unplayed and held by opponent
        let humanSeat = (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) ? mySeat : 0;
        let partnerSeat = (humanSeat + 2) % 4;
        let humanName = (typeof myNickname !== 'undefined' && myNickname) ? myNickname : (COMPASS_FULL[humanSeat] || 'You');

        if (card.rank === '9') {
            let jackPlayedAlready = this.playedCardsHistory.some(c => c.suit === card.suit && c.rank === 'J');
            let jackInTrick = trickCardsSoFar.some(tc => tc.card && tc.card.suit === card.suit && tc.card.rank === 'J');
            let jackInPartnerHand = this.players[partnerSeat] && this.players[partnerSeat].some(c => c.suit === card.suit && c.rank === 'J');
            if (!jackPlayedAlready && !jackInTrick && !jackInPartnerHand) {
                let lowerCardInSuit = handBeforePlay.find(c => c.suit === card.suit && c.rank !== '9' && c.rank !== 'J');
                let safeAlt = lowerCardInSuit ? `${lowerCardInSuit.rank}${lowerCardInSuit.suit}` : (handBeforePlay.find(c => c.rank !== '9') ? `${handBeforePlay.find(c => c.rank !== '9').rank}${handBeforePlay.find(c => c.rank !== '9').suit}` : `${card.rank}${card.suit}`);
                let oppHolding = 'Opponent';
                for (let opp of [(humanSeat + 1) % 4, (humanSeat + 3) % 4]) {
                    if (this.players[opp] && this.players[opp].some(c => c.suit === card.suit && c.rank === 'J')) {
                        oppHolding = COMPASS_FULL[opp] || `Player ${opp}`;
                        break;
                    }
                }
                this.humanBlunders.push({
                    tag: 'DRY_9_AMBUSH',
                    trickNum: trickNum,
                    cardPlayed: `${card.rank}${card.suit}`,
                    optimalCard: safeAlt,
                    details: `Trick ${trickNum}: Played 9${card.suit} while J${card.suit} was still live in ${oppHolding}'s hand, conceding high honors.`,
                    pointSwing: 5
                });
            }
        }

        // 2. MISSED_FATTENING: Partner (Wingman) plays guaranteed boss card, and human plays 7/8 while holding unprotected 10 or Ace
        let northPlay = trickCardsSoFar.find(tc => tc.player === partnerSeat);
        if (northPlay && northPlay.card) {
            let northIsWinning = false;
            let currentWinner = this._getCurrentTrickWinner();
            if (currentWinner && currentWinner.player === partnerSeat) {
                let isBoss = this._isCardHighestRemaining(northPlay.card) || (this.trumpRevealed && northPlay.card.suit === this.trumpSuit && this._isCardHighestRemaining(northPlay.card));
                if (isBoss || seatInTrick === 3) northIsWinning = true;
            }
            if (northIsWinning && (card.rank === '7' || card.rank === '8')) {
                let fatCard = handBeforePlay.find(c => (c.rank === '10' || c.rank === 'A') && (c.suit === card.suit || card.suit !== leadSuit));
                if (fatCard) {
                    this.humanBlunders.push({
                        tag: 'MISSED_FATTENING',
                        trickNum: trickNum,
                        cardPlayed: `${card.rank}${card.suit}`,
                        optimalCard: `${fatCard.rank}${fatCard.suit}`,
                        details: `Trick ${trickNum}: Partner North had the trick locked with ${northPlay.card.rank}${northPlay.card.suit}, but South played ${card.rank}${card.suit} instead of dumping ${fatCard.rank}${fatCard.suit} (+1 pt lost).`,
                        pointSwing: 1
                    });
                }
            }
        }

        // 3. OVERTRUMP_WASTE: Human plays Trump Jack (3 pts) in 4th seat when a low trump (7 or 8) would have won just as easily
        if (seatInTrick === 3 && this.trumpRevealed && card.suit === this.trumpSuit && card.rank === 'J') {
            let currentWinner = this._getCurrentTrickWinner();
            let lowerWinningTrump = handBeforePlay.find(c => {
                if (c.suit !== this.trumpSuit || c.rank === 'J') return false;
                if (!currentWinner) return true;
                let winCard = currentWinner.card;
                if (winCard.suit !== this.trumpSuit) return true;
                return c.power > winCard.power;
            });
            if (lowerWinningTrump) {
                this.humanBlunders.push({
                    tag: 'OVERTRUMP_WASTE',
                    trickNum: trickNum,
                    cardPlayed: `${card.rank}${card.suit}`,
                    optimalCard: `${lowerWinningTrump.rank}${lowerWinningTrump.suit}`,
                    details: `Trick ${trickNum}: South wasted J${card.suit} in 4th seat to cut a trick when ${lowerWinningTrump.rank}${lowerWinningTrump.suit} would have won it.`,
                    pointSwing: 3
                });
            }
        }

        // 4. ROYAL_PAIR_MISPLAY: Human holds both K and Q of Trumps and discards one before declaring the pair
        if (this.trumpSuit && (card.suit === this.trumpSuit) && (card.rank === 'K' || card.rank === 'Q')) {
            let otherRank = (card.rank === 'K') ? 'Q' : 'K';
            let holdsOther = handBeforePlay.some(c => c.suit === this.trumpSuit && c.rank === otherRank);
            if (holdsOther && (!this.trumpRevealed || !this.pairDeclared)) {
                let otherNonPair = handBeforePlay.find(c => c.suit !== this.trumpSuit || (c.rank !== 'K' && c.rank !== 'Q'));
                let altCard = otherNonPair ? `${otherNonPair.rank}${otherNonPair.suit}` : `${card.rank}${card.suit}`;
                this.humanBlunders.push({
                    tag: 'ROYAL_PAIR_MISPLAY',
                    trickNum: trickNum,
                    cardPlayed: `${card.rank}${card.suit}`,
                    optimalCard: altCard,
                    details: `Trick ${trickNum}: Discarded ${card.rank}${card.suit} before declaring Royal Pair, throwing away a 4-point contract bonus.`,
                    pointSwing: 4
                });
            }
        }
    }

    getRoundTelemetry() {
        let bidTeam = (this.highestBidder === 0 || this.highestBidder === 2) ? 1 : 2;
        let isDeclarer = (this.highestBidder === 0);
        let team1Target = (bidTeam === 1) ? this.currentBid : (29 - this.currentBid);
        let humanSeat = (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) ? mySeat : 0;
        let isHumanBidWinner = (this.highestBidder === humanSeat);
        let trumpIdx = DDS_SUITS.indexOf(this.trumpSuit);
        let isHi = (currentLang === 'hi');

        // 1. Initial Deal & Double-Dummy Par Points (P_par)
        let initialHands = (this.trickSnapshots && this.trickSnapshots[0] && this.trickSnapshots[0].hands)
            ? this.trickSnapshots[0].hands
            : (this.deal1Hands && this.deal2Hands ? [
                [...(this.deal1Hands[0]||[]), ...(this.deal2Hands[0]||[])],
                [...(this.deal1Hands[1]||[]), ...(this.deal2Hands[1]||[])],
                [...(this.deal1Hands[2]||[]), ...(this.deal2Hands[2]||[])],
                [...(this.deal1Hands[3]||[]), ...(this.deal2Hands[3]||[])]
              ] : null);

        let parPoints = 16;
        if (initialHands) {
            try {
                parPoints = Math.round(TwentyEightDDS.solvePar(initialHands, 0, trumpIdx, true));
            } catch (e) {
                console.warn("DDS solvePar fallback:", e);
            }
        }

        // 2. Expected Contract Equity (ECE) & Multi-Trick Rollback Regret
        let paceGraph = [];
        let maxRegret = -1;
        let bestInflectionTrick = 0;
        let bestCardPlayed = null;
        let bestOptimalCard = null;
        let bestInflectionDetail = "";
        let prevECE = 0;

        for (let i = 0; i < this.roundTricks.length; i++) {
            let t = this.roundTricks[i];
            let snap = (this.trickSnapshots && this.trickSnapshots[i]) ? this.trickSnapshots[i] : null;
            let trickNum = t.trickNum || (i + 1);

            let t1PtsSoFar = t.t1TotalAfter || 0;
            let remainingPar = 0;
            if (snap && snap.hands && i < this.roundTricks.length - 1) {
                try {
                    let nextLead = (t.winningPlayer !== undefined) ? t.winningPlayer : (t.plays && t.plays[0] ? t.plays[0].player : 0);
                    remainingPar = TwentyEightDDS.solvePar(snap.hands, nextLead, trumpIdx, this.trumpRevealed);
                } catch (e) {}
            }
            let currentECE = (t1PtsSoFar + remainingPar) - team1Target;
            let deltaECE = currentECE - prevECE;
            prevECE = currentECE;

            let totalPts = (t.t1TotalAfter || 0) + (t.t2TotalAfter || 0);
            let legacyPace = t1PtsSoFar - (team1Target * (totalPts / 28.0));

            paceGraph.push({
                trickNum: trickNum,
                ece: Math.round(currentECE * 10) / 10,
                paceDelta: Math.round(legacyPace * 10) / 10,
                deltaChange: Math.round(deltaECE * 10) / 10,
                pointsInTrick: t.points,
                winningTeam: t.winningTeam
            });

            // Multi-Trick Regret Evaluation for Human Player
            if (snap && snap.hands && snap.hands[humanSeat]) {
                let humanHandAtTrick = snap.hands[humanSeat];
                let humanPlay = t.plays ? t.plays.find(p => p.player === humanSeat) : null;
                let cardPlayedStr = humanPlay && humanPlay.card ? `${humanPlay.card.rank}${humanPlay.card.suit}` : null;

                if (cardPlayedStr && humanHandAtTrick.length > 1) {
                    let leadSuit = (t.plays && t.plays.length > 0 && t.plays[0].card) ? t.plays[0].card.suit : null;
                    let legalCards = humanHandAtTrick;
                    if (leadSuit && humanHandAtTrick.some(c => c.suit === leadSuit)) {
                        legalCards = humanHandAtTrick.filter(c => c.suit === leadSuit);
                    }

                    if (legalCards.length > 1) {
                        try {
                            let playsBeforeHuman = [];
                            if (t.plays) {
                                for (let p of t.plays) {
                                    if (p.player === humanSeat) break;
                                    playsBeforeHuman.push({ player: p.player, card: p.card });
                                }
                            }
                            let equities = TwentyEightDDS.evaluateMoveEquities(
                                snap.hands,
                                humanSeat,
                                playsBeforeHuman,
                                trumpIdx,
                                this.trumpRevealed,
                                legalCards
                            );

                            let playedVal = equities[cardPlayedStr] !== undefined ? equities[cardPlayedStr] : -Infinity;
                            let maxVal = -Infinity;
                            let optCard = cardPlayedStr;

                            for (let cKey in equities) {
                                if (equities[cKey] > maxVal) {
                                    maxVal = equities[cKey];
                                    optCard = cKey;
                                }
                            }

                            let trickRegret = (maxVal > -Infinity && playedVal > -Infinity) ? (maxVal - playedVal) : 0;
                            if (trickRegret > maxRegret) {
                                maxRegret = trickRegret;
                                bestInflectionTrick = trickNum;
                                bestCardPlayed = cardPlayedStr;
                                bestOptimalCard = optCard;
                            }
                        } catch (e) {
                            console.warn("DDS regret eval error:", e);
                        }
                    }
                }
            }
        }

        // Fallback / Alignment for Turning Point (strictly from actual roundTricks / swingMoments)
        let trickBlunder = this.humanBlunders && this.humanBlunders.length > 0 ? this.humanBlunders[0] : null;
        if (maxRegret <= 0.5) {
            if (trickBlunder) {
                bestInflectionTrick = trickBlunder.trickNum || 1;
                bestCardPlayed = trickBlunder.cardPlayed || null;
                bestOptimalCard = trickBlunder.optimalCard || bestCardPlayed;
            } else if (this.roundTricks && this.roundTricks.length > 0) {
                // No blunder: select decisive trick (max points, tie-break by J/9 honor capture)
                let decisive = this.roundTricks[0];
                let bestScore = -1;
                for (let t of this.roundTricks) {
                    let hasHonor = (t.plays || []).some(p => p.card && (p.card.rank === 'J' || p.card.rank === '9'));
                    let sc = (t.points || 0) * 10 + (hasHonor ? 1 : 0);
                    if (sc > bestScore) {
                        bestScore = sc;
                        decisive = t;
                    }
                }
                bestInflectionTrick = decisive.trickNum || (this.roundTricks.indexOf(decisive) + 1);
                let hp = (decisive.plays || []).find(p => p.player === humanSeat);
                bestCardPlayed = (hp && hp.card) ? `${hp.card.rank}${hp.card.suit}` : null;
                bestOptimalCard = bestCardPlayed;
            }
        } else if (this.roundEventLog && this.roundEventLog.swingMoments && this.roundEventLog.swingMoments.length === 0 && bestCardPlayed) {
            this.roundEventLog.swingMoments.push({
                trickNum: bestInflectionTrick,
                player: humanSeat,
                cardPlayed: bestCardPlayed,
                optimalCard: bestOptimalCard,
                regret: Math.round(maxRegret * 10) / 10
            });
        }

        let dropPct = maxRegret > 0.5
            ? Math.min(65, Math.max(15, Math.round((maxRegret / (team1Target || 16)) * 100)))
            : 0;
        let winProbDropStr = dropPct > 0 ? `-${dropPct}%` : `0%`;

        // Rich Game-Aware Inflection Point Explanation
        let pRank = bestCardPlayed ? bestCardPlayed.slice(0, -1) : '';
        let pSuit = bestCardPlayed ? bestCardPlayed.slice(-1) : '';
        let oRank = bestOptimalCard ? bestOptimalCard.slice(0, -1) : '';
        let oSuit = bestOptimalCard ? bestOptimalCard.slice(-1) : '';
        let playedPtVal = (pRank === 'J' ? 3 : (pRank === '9' ? 2 : ((pRank === 'A' || pRank === '10') ? 1 : 0)));
        let optPtVal = (oRank === 'J' ? 3 : (oRank === '9' ? 2 : ((oRank === 'A' || oRank === '10') ? 1 : 0)));

        let trkObj = (this.roundTricks && bestInflectionTrick > 0 && bestInflectionTrick <= this.roundTricks.length) 
            ? this.roundTricks[bestInflectionTrick - 1] 
            : null;
        let trkWinner = trkObj ? trkObj.winningPlayer : -1;
        let didOpponentsWinTrick = (trkWinner !== -1 && (trkWinner % 2 !== humanSeat % 2));
        let didPartnerWinTrick = (trkWinner !== -1 && trkWinner !== humanSeat && (trkWinner % 2 === humanSeat % 2));

        if (didOpponentsWinTrick && playedPtVal >= 1 && optPtVal === 0) {
            bestInflectionDetail = isHi
                ? `अंकों का नुकसान: विरोधियों द्वारा जीती चाल में ${bestCardPlayed} (${playedPtVal} अंक) खेलने से उन्हें मुफ्त अंक मिले। 0 अंक वाला ${bestOptimalCard} सुरक्षित विकल्प था।`
                : `Costly Honor Feed: Playing ${bestCardPlayed} surrendered ${playedPtVal} trick pt${playedPtVal > 1 ? 's' : ''} on a trick won by opponents. Discarding zero-point ${bestOptimalCard} would have starved their score and preserved equity.`;
        } else if (didPartnerWinTrick && playedPtVal >= 2 && optPtVal === 0) {
            bestInflectionDetail = isHi
                ? `अनावश्यक बड़ा पत्ता: साथी पहले ही यह चाल जीत रहा था। ${bestCardPlayed} खेलने के बजाय ${bestOptimalCard} बचाकर रखना भविष्य की चालों के लिए बेहतर होता।`
                : `Redundant Honor: Partner had already secured Trick ${bestInflectionTrick}. Playing ${bestCardPlayed} duplicated high cards; exiting with ${bestOptimalCard} saves your honors for later tricks.`;
        } else if (pSuit === this.trumpSuit && oSuit !== this.trumpSuit && pSuit) {
            bestInflectionDetail = isHi
                ? `हुकुम का जल्दबाजी में उपयोग: ${bestCardPlayed} खेलने से हुकुम का नियंत्रण कमजोर हुआ। दूसरा पत्ता ${bestOptimalCard} चलना बेहतर रहता।`
                : `Premature Trump Play: Trumping with ${bestCardPlayed} weakened your team's long-term trump barrier. Discarding ${bestOptimalCard} preserves trump length for the endgame.`;
        } else if (playedPtVal < optPtVal && bestCardPlayed) {
            bestInflectionDetail = isHi
                ? `चाल जीतने का मौका गंवाया: ${bestCardPlayed} चलने से विरोधियों को सस्ती चाल मिली। ${bestOptimalCard} खेलकर महत्वपूर्ण अंक जीते जा सकते थे।`
                : `Missed Capture Window: Playing low card ${bestCardPlayed} allowed opponents to take the trick cheaply. Stepping up with ${bestOptimalCard} would have secured vital trick points.`;
        } else if (bestCardPlayed) {
            bestInflectionDetail = isHi
                ? `निर्णायक मोड़: ट्रिक ${bestInflectionTrick} पर ${bestOptimalCard} खेलना ${bestCardPlayed} की तुलना में अधिक सुरक्षित और रक्षात्मक था (${winProbDropStr} पेस)।`
                : `Decisive Turning Point: Trick ${bestInflectionTrick} swung contract equity by ${winProbDropStr}. Playing ${bestOptimalCard} instead of ${bestCardPlayed} preserves high tenaces.`;
        } else {
            bestInflectionDetail = isHi
                ? `ट्रिक ${bestInflectionTrick} राउंड की सबसे महत्वपूर्ण चाल रही जिसमें मुख्य अंक तय हुए।`
                : `Trick ${bestInflectionTrick} was the key trick of the round, securing critical points toward the contract.`;
        }

        let turningPointData = {
            trickNumber: bestInflectionTrick || 1,
            winProbDrop: winProbDropStr,
            cardPlayed: bestCardPlayed || '',
            optimalCard: bestOptimalCard || bestCardPlayed || '',
            explanation: bestInflectionDetail,
            allHands: (this.trickSnapshots && this.trickSnapshots[bestInflectionTrick - 1]) ? this.trickSnapshots[bestInflectionTrick - 1].hands : null
        };

        // 4. Guaranteed Deal 1 Cards strictly from roundEventLog / actual deal
        let deal1Cards = (this.roundEventLog && this.roundEventLog.bidding && this.roundEventLog.bidding.humanDeal1 && this.roundEventLog.bidding.humanDeal1.length)
            ? this.roundEventLog.bidding.humanDeal1
            : ((this.deal1Hands && this.deal1Hands[humanSeat] && this.deal1Hands[humanSeat].length)
                ? this.deal1Hands[humanSeat].map(c => `${c.rank}${c.suit}`)
                : []);
        if (!deal1Cards.length && this.trickSnapshots && this.trickSnapshots[0] && this.trickSnapshots[0].hands && this.trickSnapshots[0].hands[humanSeat]) {
            deal1Cards = this.trickSnapshots[0].hands[humanSeat].slice(0, 4).map(c => `${c.rank}${c.suit}`);
        }
        if (!deal1Cards.length) {
            let played = [];
            for (let trk of (this.roundTricks || [])) {
                if (trk.plays) {
                    let hp = trk.plays.find(p => p.player === humanSeat);
                    if (hp && hp.card) played.push(`${hp.card.rank}${hp.card.suit}`);
                }
            }
            if (played.length > 0) deal1Cards = played.slice(0, 4);
        }

        if (this.roundEventLog && this.roundEventLog.bidding) {
            this.roundEventLog.bidding.parPoints = parPoints;
            this.roundEventLog.bidding.winner = this.highestBidder;
            this.roundEventLog.bidding.contract = this.currentBid;
            this.roundEventLog.bidding.trumpSuit = this.trumpSuit;
            if (!this.roundEventLog.bidding.humanDeal1.length && deal1Cards.length) {
                this.roundEventLog.bidding.humanDeal1 = deal1Cards;
            }
        }

        let d1HonorPts = deal1Cards.reduce((acc, cStr) => {
            let r = cStr.slice(0, -1);
            return acc + (r === 'J' ? 3 : (r === '9' ? 2 : ((r === 'A' || r === '10') ? 1 : 0)));
        }, 0);

        let deal2Cards = (this.deal2Hands && this.deal2Hands[humanSeat]) ? this.deal2Hands[humanSeat].map(c => `${c.rank}${c.suit}`) : [];
        let humanBid = (this.playerBids && this.playerBids[humanSeat] && this.playerBids[humanSeat] !== 'Pass') ? parseInt(this.playerBids[humanSeat]) : null;
        let pNames = this.playerNames || (typeof playerCustomNames !== 'undefined' ? playerCustomNames : COMPASS_FULL);
        let bidderName = pNames[this.highestBidder] || COMPASS_FULL[this.highestBidder] || `Player ${this.highestBidder}`;

        let biddingRating = "Optimal";
        let biddingSummary = "";

        if (isHumanBidWinner && humanBid) {
            if (d1HonorPts >= 5) {
                biddingRating = isHi ? "उत्कृष्ट आक्रामक बोली" : "Optimal Aggressive Bid";
                biddingSummary = isHi
                    ? `शुरुआती हाथ में ${d1HonorPts} अंक [${deal1Cards.join(', ')}] के साथ ${humanBid} की बोली लगाना बहुत मजबूत और रणनीतिक निर्णय था।`
                    : `Holding ${d1HonorPts} initial honor points [${deal1Cards.join(', ')}], bidding ${humanBid} was an optimal, high-equity contract that established winning board control.`;
            } else if (d1HonorPts >= 3) {
                biddingRating = isHi ? "संतुलित बोली" : "Calculated Bid";
                biddingSummary = isHi
                    ? `हाथ में ${d1HonorPts} अंक [${deal1Cards.join(', ')}] होने पर ${humanBid} की बोली साथी के सहयोग पर आधारित एक संतुलित दांव था।`
                    : `Bidding ${humanBid} with ${d1HonorPts} points in hand [${deal1Cards.join(', ')}] was a calculated move, relying on partner support in the second deal.`;
            } else {
                biddingRating = isHi ? "अत्यधिक आक्रामक बोली" : "Aggressive Overbid";
                biddingSummary = isHi
                    ? `हाथ में केवल ${d1HonorPts} अंक [${deal1Cards.join(', ')}] होने के बावजूद ${humanBid} की बोली अधिक जोखिम भरी साबित हुई।`
                    : `Overextended Contract: Bidding ${humanBid} with only ${d1HonorPts} points [${deal1Cards.join(', ')}] left your team vulnerable to defensive counter-play.`;
            }
        } else {
            if (d1HonorPts <= 2) {
                biddingRating = isHi ? "अनुशासित पास" : "Disciplined Pass";
                biddingSummary = isHi
                    ? `हाथ में केवल ${d1HonorPts} अंक [${deal1Cards.join(', ')}] होने के कारण ${bidderName} की ${this.currentBid} बोली के सामने पास करना सबसे सुरक्षित रक्षात्मक निर्णय था।`
                    : `Disciplined Pass: Holding only ${d1HonorPts} trick point [${deal1Cards.join(', ')}], passing against ${bidderName}'s ${this.currentBid} contract was the optimal play, preventing severe penalties.`;
            } else if (d1HonorPts >= 5) {
                biddingRating = isHi ? "सतर्क पास" : "Conservative Pass";
                biddingSummary = isHi
                    ? `हाथ में ${d1HonorPts} अंक [${deal1Cards.join(', ')}] होने पर भी पास करके आपने बड़े पत्तों को रक्षात्मक जाल के लिए सुरक्षित रखा।`
                    : `Conservative Pass: Holding ${d1HonorPts} trick points [${deal1Cards.join(', ')}], passing conserved high honors to trap opponents during card play.`;
            } else {
                biddingRating = isHi ? "संतुलित पास" : "Solid Defensive Pass";
                biddingSummary = isHi
                    ? `हाथ में [${deal1Cards.join(', ')}] (${d1HonorPts} अंक) के साथ पास करना खेल की गति के अनुसार सही निर्णय था।`
                    : `Holding [${deal1Cards.join(', ')}] (${d1HonorPts} pts), passing against ${bidderName}'s ${this.currentBid} contract preserved cards for defense.`;
            }
        }

        let biddingAuditData = {
            rating: biddingRating,
            summary: biddingSummary,
            deal1_cards: deal1Cards,
            deal2_cards: deal2Cards,
            human_bid: isHumanBidWinner ? (humanBid || 'Pass') : 'Pass',
            is_contractor: isHumanBidWinner,
            contractor_name: bidderName,
            contract_bid: this.currentBid,
            par_points: parPoints,
            ev: parPoints
        };

        // 5. Deterministic Partner Synergy Rating (0–100%)
        let synergyScore = 70;
        for (let t of this.roundTricks) {
            if (t.winningPlayer === humanSeat) {
                let partnerSeat = (humanSeat + 2) % 4;
                let pPlay = t.plays ? t.plays.find(p => p.player === partnerSeat) : null;
                if (pPlay && pPlay.card && pPlay.card.value > 0) {
                    synergyScore += pPlay.card.value * 4;
                }
            } else if (t.winningTeam !== ((humanSeat === 1 || humanSeat === 3) ? 2 : 1)) {
                let partnerSeat = (humanSeat + 2) % 4;
                let pPlay = t.plays ? t.plays.find(p => p.player === partnerSeat) : null;
                if (pPlay && pPlay.card && pPlay.card.value > 0) {
                    synergyScore -= pPlay.card.value * 4;
                }
            }
        }
        if (this.roundSuccess) synergyScore += 8;
        else synergyScore -= 6;
        synergyScore = Math.max(35, Math.min(96, Math.round(synergyScore)));

        let synergyNote = "";
        if (synergyScore >= 80) {
            synergyNote = isHi 
                ? "उत्कृष्ट तालमेल: साथी ने आपकी चालों का पूरा समर्थन किया और सही समय पर अंक देकर टीम को मजबूत किया।"
                : "Outstanding Harmony: Partner supported your leads accurately, feeding point-scoring cards on secured tricks and conserving trumps.";
        } else if (synergyScore >= 60) {
            synergyNote = isHi 
                ? "संतुलित साझेदारी: बुनियादी तालमेल अच्छा रहा, हालांकि कुछ चालों में समन्वय और बेहतर हो सकता था।"
                : "Solid Partnership: Good foundational coordination on early leads; maintained steady defensive pressure.";
        } else {
            synergyNote = isHi 
                ? "तालमेल की कमी: रंगों में तालमेल न बैठने के कारण विरोधियों को हुकुम से अंक काटने का अवसर मिला।"
                : "Coordination Gap: Leads were fragmented across suits, allowing opponents to cut in with intermediate trumps and capture high honors.";
        }

        // 6. Bot Locker Room Reaction
        let botSpeaker = "Saboteur (West)";
        let botTaunt = "";
        if (this.roundSuccess) {
            botSpeaker = "Wingman (North)";
            botTaunt = `Textbook teamwork! Our ${this.trumpSuit || 'trump'} control shut down East and West cleanly.`;
        } else {
            botSpeaker = "Striker (East)";
            botTaunt = `We had trump defense mapped from Trick 1—breaking your ${this.currentBid} contract was inevitable.`;
        }

        // 7. Causal Ledger
        let auditLedger = {
            bidding: {
                rating: biddingRating,
                par_points: parPoints,
                contract: this.currentBid,
                deal1_cards: deal1Cards,
                deal2_cards: deal2Cards,
                human_bid: isHumanBidWinner ? (humanBid || 'Pass') : 'Pass',
                is_contractor: isHumanBidWinner,
                summary: biddingSummary
            },
            inflection_point: {
                trick_number: bestInflectionTrick || 1,
                card_played: bestCardPlayed || '',
                optimal_card: bestOptimalCard || bestCardPlayed || '',
                regret_pts: Math.round(maxRegret * 10) / 10,
                win_pace_drop: winProbDropStr,
                explanation: bestInflectionDetail
            },
            partner_synergy: {
                score: synergyScore,
                note: synergyNote
            },
            grounding_facts: {
                bidding_winner: this.highestBidder,
                bidding_team: bidTeam,
                trump_suit: this.trumpSuit,
                trump_revealed: this.trumpRevealed,
                t1_points: this.t1TrickPts,
                t2_points: this.t2TrickPts,
                success: this.roundSuccess
            }
        };

        return {
            blunders: this.humanBlunders,
            pace_graph: paceGraph,
            turning_point: turningPointData,
            bidding_audit: biddingAuditData,
            partner_synergy: { score: synergyScore, note: synergyNote },
            bot_locker_room: { speaker: botSpeaker, taunt: botTaunt },
            audit_ledger: auditLedger,
            event_log: this.roundEventLog
        };
    }

    calculateRoundScore() {
        let bidTeam = (this.highestBidder === 0 || this.highestBidder === 2) ? 1 : 2;
        let bidTeamPts = bidTeam === 1 ? this.t1TrickPts : this.t2TrickPts;
        this.roundSuccess = bidTeamPts >= this.currentBid;
        this.gamePointsWon = this.currentBid < 20 ? 1 : (this.currentBid < 25 ? 2 : 3);
        
        if (this.roundSuccess) {
            if (bidTeam === 1) this.t1GamePts += this.gamePointsWon; else this.t2GamePts += this.gamePointsWon;
        } else {
            if (bidTeam === 1) this.t1GamePts -= this.gamePointsWon; else this.t2GamePts -= this.gamePointsWon;
        }

        // Record career stats for the local human player's team
        try {
            let myTeam = (typeof mySeat !== 'undefined' && (mySeat === 1 || mySeat === 3)) ? 2 : 1;
            let isHumanWin = (bidTeam === myTeam && this.roundSuccess) || (bidTeam !== myTeam && !this.roundSuccess);
            let humanBidder = (bidTeam === myTeam);
            let myTrickPts = (myTeam === 1) ? this.t1TrickPts : this.t2TrickPts;
            let diff = (typeof currentDifficulty !== 'undefined') ? currentDifficulty : 'medium';
            recordMatchInCareer(isHumanWin, humanBidder, this.roundSuccess, this.currentBid, myTrickPts, diff);
        } catch (statsErr) {
            console.warn('[calculateRoundScore] Failed to record career stats:', statsErr);
        }
    }

    revealTrump(requesterIndex, autoEndReveal = false) {
        if (this.trumpRevealed) return;
        if (!autoEndReveal && !this.canRevealTrump(requesterIndex)) {
            console.warn(`Illegal trump reveal rejected for player ${requesterIndex}`);
            return;
        }
        this.trumpRevealed = true;
        this.justRevealedBy = autoEndReveal ? -1 : requesterIndex;
        if (!autoEndReveal) {
            this.justRevealedInCurrentTrick = true;
            this.justRevealedByPlayer = requesterIndex;
            if (requesterIndex === 0) {
                let trickPts = this._countPointsInTrick();
                let currentWinner = this._getCurrentTrickWinner();
                let partnerWinning = currentWinner && currentWinner.player === 2;
                if (trickPts <= 1 || partnerWinning) {
                    this.pendingPrematureReveal = {
                        trickNum: this.roundTricks.length + 1,
                        trickPoints: trickPts,
                        partnerWinning: partnerWinning
                    };
                }
            }
            if (!this.trumpRevealEvent) {
                this.trumpRevealEvent = {
                    trickNum: this.roundTricks.length + 1,
                    player: requesterIndex,
                    seat: COMPASS_FULL[requesterIndex] || `Player ${requesterIndex}`,
                    suit: this.trumpSuit
                };
            }
            if (this.roundEventLog && !this.roundEventLog.trumpReveal) {
                this.roundEventLog.trumpReveal = {
                    trickNum: this.roundTricks.length + 1,
                    player: requesterIndex,
                    seat: COMPASS_FULL[requesterIndex] || `Player ${requesterIndex}`,
                    suit: this.trumpSuit
                };
            }
        }
        playSound('reveal');
        this.log(`🚨 Player ${requesterIndex} revealed Trump: ${this.trumpSuit}!`);
        this.hiddenTrumpCard = null;
        this.hasHiddenTrump = false;
    }

    exportStateForClient(clientSeat) {
        return PeerManager.getSanitizedStateForPeer(this, clientSeat);
    }

    syncFromMasterState(state) {
        if (!state) return;

        // 1. Detect Round Transition: Wipe stale round tricks, anim flags, and deal locks
        let isNewRound = (state.roundId !== undefined && state.roundId !== this.roundId);
        if (isNewRound) {
            this.roundId = state.roundId;
            this.roundTricks = [];
            this.trickCards = [];
            if (typeof ui !== 'undefined' && ui) {
                ui.lastAnimatedDealKey = null;
                ui.clearActiveDealAnimation();
                ui.animatingTrick = false;
                ui.animatingReveal = false;
                ui.pendingMasterState = null;
                ui._lastEndedRoundId = null;
            }
        } else if (state.roundId !== undefined) {
            this.roundId = state.roundId;
        }

        if (state.autoPlaySeats) {
            autoPlaySeats = state.autoPlaySeats;
            if (typeof mySeat !== 'undefined' && mySeat !== 99 && mySeat >= 0 && mySeat < 4) {
                const banner = document.getElementById('afk-resume-banner');
                if (banner) banner.style.display = autoPlaySeats[mySeat] ? 'flex' : 'none';
            }
        }

        if (state.turnDeadline !== undefined) {
            this.turnDeadline = state.turnDeadline;
            this.turnDurationMs = state.turnDurationMs || 30000;
        }
        if (state.humanSeats) {
            humanSeats = state.humanSeats;
        }
        if (state.playerCustomNames) {
            playerCustomNames = state.playerCustomNames;
        }

        this.t1TrickPts = state.t1TrickPts || 0; this.t2TrickPts = state.t2TrickPts || 0;
        this.t1GamePts = state.t1GamePts || 0; this.t2GamePts = state.t2GamePts || 0;
        this.currentBid = state.currentBid || 15; this.currentTurn = state.currentTurn !== undefined ? state.currentTurn : 0;

        // Align localTricksCount with master to prevent ghost tricks across rounds
        let localTricksCount = (this.roundTricks || []).length;
        let masterTricksCount = state.roundTricksCount !== undefined ? state.roundTricksCount : localTricksCount;
        if (state.roundTricksCount !== undefined && localTricksCount > masterTricksCount) {
            this.roundTricks.length = masterTricksCount;
            localTricksCount = masterTricksCount;
        }

        // Deal Phase Regression Guard: Never regress client back to DEALING if client already finished this deal
        let isDealRegress = (!isNewRound && (state.phase === 'DEALING_1' || state.phase === 'DEALING_2') && 
                            (this.phase !== 'DEALING_1' && this.phase !== 'DEALING_2' && this.phase !== 'LOBBY'));

        if (state.phase === 'TRICK_OVER' && localTricksCount > masterTricksCount) {
            // Already resolved this trick locally - keep current playing state
        } else if (!isDealRegress) {
            this.phase = state.phase;
            this.trickCards = state.trickCards || [];
        } else {
            this.trickCards = state.trickCards || [];
        }
        this.leadSuit = state.leadSuit;
        this.trumpRevealed = !!state.trumpRevealed; this.trumpSuit = state.trumpSuit;
        this.highestBidder = state.highestBidder !== undefined ? state.highestBidder : -1;
        this.hasHiddenTrump = !!state.hasHiddenTrump;
        this.trumpSet = !!state.trumpSet;
        this.justRevealedBy = state.justRevealedBy !== undefined ? state.justRevealedBy : -1;
        this.hasPassed = state.hasPassed || [false, false, false, false]; this.playerBids = state.playerBids || [null, null, null, null];
        this.tricksWonByTeam = state.tricksWonByTeam || [0, 0];
        this.roundSuccess = state.roundSuccess; this.gamePointsWon = state.gamePointsWon;
        this.pairDeclared = !!state.pairDeclared; this.pairDeclaringTeam = state.pairDeclaringTeam;

        if (!this.trumpRevealed) ui.uiTrumpRevealed = false;
        if (this.phase !== 'ROUND_OVER') {
            const endM = document.getElementById('end-modal');
            if (endM) endM.style.display = 'none';
        }
        
        let isDealPhase = (this.phase === 'DEALING_1' || this.phase === 'DEALING_2');
        let sizes = state.handSizes || [0, 0, 0, 0];
        if (mySeat !== 99 && mySeat >= 0 && mySeat < 4) {
            this.players[mySeat] = state.myHand || []; 
            for(let i=0; i<4; i++) {
                if(i !== mySeat) this.players[i] = Array.from({ length: sizes[i] || 0 }, () => ({ isNew: isDealPhase }));
            }
        } else {
            for(let i=0; i<4; i++) this.players[i] = Array.from({ length: sizes[i] || 0 }, () => ({ isNew: isDealPhase }));
        }
    }
}
