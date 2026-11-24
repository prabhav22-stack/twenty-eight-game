/**
 * InferenceMatrix - Card Tracking & Belief State Inference
 * Tracks void suits, card counts, bidder leads, and hidden trump priors.
 */
export class InferenceMatrix {
    constructor() {
        this.voidInSuit = [
            { '♠': false, '♥': false, '♣': false, '♦': false },
            { '♠': false, '♥': false, '♣': false, '♦': false },
            { '♠': false, '♥': false, '♣': false, '♦': false },
            { '♠': false, '♥': false, '♣': false, '♦': false }
        ];
        this.playedCards = [];
        this.bidderExcludedTrumps = new Set();
        this.remainingBySuit = {
            '♠': ['J', '9', 'A', '10', 'K', 'Q', '8', '7'],
            '♥': ['J', '9', 'A', '10', 'K', 'Q', '8', '7'],
            '♣': ['J', '9', 'A', '10', 'K', 'Q', '8', '7'],
            '♦': ['J', '9', 'A', '10', 'K', 'Q', '8', '7']
        };
        // Framework 1: Bayesian Prior Distribution over Trump Suits
        this.trumpSuitPriors = { '♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25 };
        this.allCards = [];
        const suits = ['♠', '♥', '♣', '♦'];
        const ranks = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
        const pts = { 'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0 };
        const pwr = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1 };
        for (let s of suits) {
            for (let r of ranks) {
                this.allCards.push({ suit: s, rank: r, value: pts[r], power: pwr[r] });
            }
        }
    }

    recordBidderLead(suit) {
        if (suit) {
            this.bidderExcludedTrumps.add(suit);
            if (this.trumpSuitPriors) {
                this.trumpSuitPriors[suit] = 0.0;
                let tot = Object.values(this.trumpSuitPriors).reduce((a, b) => a + b, 0);
                if (tot > 0) {
                    for (let s of ['♠', '♥', '♣', '♦']) this.trumpSuitPriors[s] /= tot;
                }
            }
        }
    }

    setTrumpSuitPriors(priors) {
        if (!priors) return;
        this.trumpSuitPriors = { ...priors };
        for (let s of this.bidderExcludedTrumps) this.trumpSuitPriors[s] = 0.0;
        let tot = Object.values(this.trumpSuitPriors).reduce((a, b) => a + b, 0);
        if (tot > 0) {
            for (let s of ['♠', '♥', '♣', '♦']) this.trumpSuitPriors[s] /= tot;
        }
    }

    sampleSecretTrump(priorsOverride) {
        let priors = priorsOverride || this.trumpSuitPriors || { '♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25 };
        let suits = ['♠', '♥', '♣', '♦'];
        let weights = suits.map(s => this.bidderExcludedTrumps.has(s) ? 0 : (priors[s] || 0.05));
        let total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) return suits[Math.floor(Math.random() * suits.length)];
        let r = Math.random() * total;
        let cumulative = 0;
        for (let i = 0; i < suits.length; i++) {
            cumulative += weights[i];
            if (r <= cumulative) return suits[i];
        }
        return suits[0];
    }

    recordCardPlay(playerIndex, card, leadSuit) {
        this.playedCards.push({ suit: card.suit, rank: card.rank });
        if (leadSuit && card.suit !== leadSuit && this.voidInSuit[playerIndex]) {
            this.voidInSuit[playerIndex][leadSuit] = true;
        }
        if (this.remainingBySuit[card.suit]) {
            let idx = this.remainingBySuit[card.suit].indexOf(card.rank);
            if (idx !== -1) this.remainingBySuit[card.suit].splice(idx, 1);
        }
    }

    isBossCard(card) {
        if (!card || !this.remainingBySuit[card.suit]) return false;
        let rem = this.remainingBySuit[card.suit];
        if (rem.length === 0) return true;
        return rem[0] === card.rank;
    }

    getBossRank(suit) {
        if (!suit || !this.remainingBySuit[suit] || this.remainingBySuit[suit].length === 0) return null;
        return this.remainingBySuit[suit][0];
    }

    isProbableTrump(suit) {
        if (!suit) return false;
        return !this.bidderExcludedTrumps.has(suit);
    }

    sampleHypotheticalWorld(mySeat, myHand, handCounts) {
        const seen = new Set();
        for (let c of this.playedCards) seen.add(`${c.rank}${c.suit}`);
        for (let c of myHand) seen.add(`${c.rank}${c.suit}`);
        const unseen = this.allCards.filter(c => !seen.has(`${c.rank}${c.suit}`));

        for (let i = unseen.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
        }
        const simHands = [[], [], [], []];
        simHands[mySeat] = [...myHand];
        const others = [0, 1, 2, 3].filter(s => s !== mySeat);
        const unassigned = [];

        for (let card of unseen) {
            const cands = others.filter(s => simHands[s].length < (handCounts[s] || 0) && !this.voidInSuit[s][card.suit]);
            if (cands.length > 0) {
                const chosen = cands[Math.floor(Math.random() * cands.length)];
                simHands[chosen].push(card);
            } else {
                unassigned.push(card);
            }
        }
        for (let card of unassigned) {
            const openSeats = others.filter(s => simHands[s].length < (handCounts[s] || 0));
            if (openSeats.length > 0) simHands[openSeats[0]].push(card);
        }
        return simHands;
    }
}
