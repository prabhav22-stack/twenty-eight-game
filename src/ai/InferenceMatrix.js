/**
 * InferenceMatrix
 * Tracks played cards, deduces hard void constraints, maintains dynamic Boss-Card
 * promotion table (CardMemory Matrix), infers hidden secret trumps from bidder leads,
 * and samples valid hypothetical worlds for ISMCTS using Bayesian Suit Priors P(T = s | H_hard, B_Groq).
 */

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const POINTS = { 'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0 };
const POWER = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1 };
const RANK_ORDER = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']; // descending power

const ALL_CARDS = [];
for (let s of SUITS) {
    for (let r of RANKS) {
        ALL_CARDS.push({ suit: s, rank: r, value: POINTS[r], power: POWER[r] });
    }
}

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
            '♠': [...RANK_ORDER],
            '♥': [...RANK_ORDER],
            '♣': [...RANK_ORDER],
            '♦': [...RANK_ORDER]
        };
        // Framework 1: Bayesian Prior Distribution over Trump Suits
        this.trumpSuitPriors = { '♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25 };
    }

    recordBidderLead(suit) {
        if (suit) {
            this.bidderExcludedTrumps.add(suit);
            // Posterior update: Hard constraint I_legal(s) = 0
            if (this.trumpSuitPriors) {
                this.trumpSuitPriors[suit] = 0.0;
                let tot = Object.values(this.trumpSuitPriors).reduce((a, b) => a + b, 0);
                if (tot > 0) {
                    for (let s of SUITS) this.trumpSuitPriors[s] /= tot;
                }
            }
        }
    }

    setTrumpSuitPriors(priors) {
        if (!priors) return;
        this.trumpSuitPriors = { ...priors };
        // Apply hard negative constraints
        for (let s of this.bidderExcludedTrumps) {
            this.trumpSuitPriors[s] = 0.0;
        }
        let tot = Object.values(this.trumpSuitPriors).reduce((a, b) => a + b, 0);
        if (tot > 0) {
            for (let s of SUITS) this.trumpSuitPriors[s] /= tot;
        }
    }

    recordCardPlay(playerIndex, card, leadSuit) {
        this.playedCards.push({ suit: card.suit, rank: card.rank });
        if (leadSuit && card.suit !== leadSuit && this.voidInSuit[playerIndex]) {
            this.voidInSuit[playerIndex][leadSuit] = true;
        }

        // CardMemory Matrix: Remove played card from remainingBySuit for dynamic boss promotion
        if (this.remainingBySuit[card.suit]) {
            let idx = this.remainingBySuit[card.suit].indexOf(card.rank);
            if (idx !== -1) {
                this.remainingBySuit[card.suit].splice(idx, 1);
            }
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

    sampleSecretTrump(priorsOverride) {
        let priors = priorsOverride || this.trumpSuitPriors || { '♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25 };
        let weights = SUITS.map(s => this.bidderExcludedTrumps.has(s) ? 0 : (priors[s] || 0.05));
        let total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) return SUITS[Math.floor(Math.random() * SUITS.length)];
        let r = Math.random() * total;
        let cumulative = 0;
        for (let i = 0; i < SUITS.length; i++) {
            cumulative += weights[i];
            if (r <= cumulative) return SUITS[i];
        }
        return SUITS[0];
    }

    getRemainingUnseenCards(myHand) {
        const seen = new Set();
        for (let c of this.playedCards) seen.add(`${c.rank}${c.suit}`);
        for (let c of myHand) seen.add(`${c.rank}${c.suit}`);

        return ALL_CARDS.filter(c => !seen.has(`${c.rank}${c.suit}`));
    }

    /**
     * Determinization: Sample a valid hypothetical distribution of remaining unseen cards
     * among the other 3 players respecting all known void constraints and Bayesian Trump Priors.
     */
    sampleHypotheticalWorld(mySeat, myHand, handCounts, trumpPriors) {
        const unseen = [...this.getRemainingUnseenCards(myHand)];
        for (let i = unseen.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
        }

        const simulatedHands = [[], [], [], []];
        simulatedHands[mySeat] = [...myHand];

        const otherSeats = [0, 1, 2, 3].filter(s => s !== mySeat);
        const targetCounts = {};
        for (let s of otherSeats) targetCounts[s] = handCounts[s] || 0;

        const unassigned = [];
        for (let card of unseen) {
            let candidates = otherSeats.filter(s =>
                simulatedHands[s].length < targetCounts[s] &&
                !this.voidInSuit[s][card.suit]
            );

            if (candidates.length > 0) {
                let chosen = candidates[Math.floor(Math.random() * candidates.length)];
                simulatedHands[chosen].push(card);
            } else {
                unassigned.push(card);
            }
        }

        for (let card of unassigned) {
            let openSeats = otherSeats.filter(s => simulatedHands[s].length < targetCounts[s]);
            if (openSeats.length > 0) {
                simulatedHands[openSeats[0]].push(card);
            }
        }

        return simulatedHands;
    }
}
