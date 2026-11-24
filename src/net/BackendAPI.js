/**
 * BackendAPI - Client for Python Serverless Backend
 * Provides non-blocking API calls for bot math, bot brains, bidding, and LLM-grounded round recaps.
 */
export const BackendAPI = {
    async getBotMath(state) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 1800);
            const res = await fetch('/api/bot-math', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            return null;
        }
    },
    async getBotBrain(payload) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2800);
            const res = await fetch('/api/bot-brain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            return null;
        }
    },
    async getBid(hand, currentBid, highestBidder, playerIdx, passCount, difficulty = 'medium') {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2000);
            const diff = difficulty || (typeof window !== 'undefined' && window.currentDifficulty) || 'medium';
            const res = await fetch('/api/bid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    hand, 
                    current_bid: currentBid, 
                    highest_bidder: highestBidder, 
                    player_idx: playerIdx, 
                    pass_count: passCount,
                    difficulty: diff
                }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            return null;
        }
    },
    async getTrump(hand, playerIdx) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 1500);
            const res = await fetch('/api/trump', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hand, player_idx: playerIdx }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const data = await res.json();
            return data.trump_suit;
        } catch(e) {
            return null;
        }
    },
    async getPlay(hand, trickCards, leadSuit, trumpSuit, trumpRevealed, playerIdx, playedHistory, voidSuits, difficulty = 'medium') {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2000);
            const diff = difficulty || (typeof window !== 'undefined' && window.currentDifficulty) || 'medium';
            const res = await fetch('/api/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hand, trick_cards: trickCards, lead_suit: leadSuit,
                    trump_suit: trumpSuit, trump_revealed: trumpRevealed,
                    player_idx: playerIdx, played_history: playedHistory,
                    void_suits: voidSuits,
                    difficulty: diff
                }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            return null;
        }
    },
    async getRecap(biddingWinner, contract, biddingTeam, t1Pts, t2Pts, success, trumpSuit, pairDeclared, language, tricks, trumpRevealEvent, customNames, telemetry) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 7500);
            const res = await fetch('/api/recap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bidding_winner: biddingWinner,
                    contract: contract,
                    bidding_team: biddingTeam,
                    t1_pts: t1Pts,
                    t2_pts: t2Pts,
                    success: success,
                    trump_suit: trumpSuit,
                    pair_declared: pairDeclared,
                    language: language || 'en',
                    tricks: tricks || [],
                    trump_reveal_event: trumpRevealEvent || null,
                    custom_names: customNames || null,
                    telemetry: telemetry || null,
                    event_log: (telemetry && telemetry.event_log) ? telemetry.event_log : null
                }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            return null;
        }
    }
};
