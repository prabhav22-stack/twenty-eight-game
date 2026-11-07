/**
 * InferenceMatrix
 * Tracks played cards, deduces hard void constraints, maintains dynamic Boss-Card
 * promotion table (CardMemory Matrix), infers hidden secret trumps from bidder leads,
 * and samples valid hypothetical worlds for ISMCTS.
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
    }

    recordBidderLead(suit) {
        if (suit) this.bidderExcludedTrumps.add(suit);
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

    /**
     * Dynamic Boss-Card Promotion:
     * A card is the Boss of its suit if no unplayed card in that suit has higher power.
     */
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

    getRemainingUnseenCards(myHand) {
        const seen = new Set();
        for (let c of this.playedCards) seen.add(`${c.rank}${c.suit}`);
        for (let c of myHand) seen.add(`${c.rank}${c.suit}`);

        return ALL_CARDS.filter(c => !seen.has(`${c.rank}${c.suit}`));
    }

    /**
     * Determinization: Sample a valid hypothetical distribution of remaining unseen cards
     * among the other 3 players respecting all known void constraints.
     */
    sampleHypotheticalWorld(mySeat, myHand, handCounts) {
        const unseen = [...this.getRemainingUnseenCards(myHand)];
        // Fisher-Yates shuffle unseen cards
        for (let i = unseen.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
        }

        const simulatedHands = [[], [], [], []];
        simulatedHands[mySeat] = [...myHand];

        const otherSeats = [0, 1, 2, 3].filter(s => s !== mySeat);
        const targetCounts = {};
        for (let s of otherSeats) targetCounts[s] = handCounts[s] || 0;

        // Assign cards to other seats respecting void constraints
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

        // Fallback for tight constraints
        for (let card of unassigned) {
            let openSeats = otherSeats.filter(s => simulatedHands[s].length < targetCounts[s]);
            if (openSeats.length > 0) {
                simulatedHands[openSeats[0]].push(card);
            }
        }

        return simulatedHands;
    }
}
