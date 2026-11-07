/**
 * InferenceMatrix
 * Tracks played cards, deduces hard void constraints, and samples valid hidden worlds
 * (determinization) for Information Set Monte Carlo Tree Search (ISMCTS).
 */

const ALL_CARDS = [];
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const POINTS = { 'J': 3, '9': 2, 'A': 1, '10': 1, 'K': 0, 'Q': 0, '8': 0, '7': 0 };
const POWER = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1 };

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
    }

    recordCardPlay(playerIndex, card, leadSuit) {
        this.playedCards.push({ suit: card.suit, rank: card.rank });
        if (leadSuit && card.suit !== leadSuit) {
            this.voidInSuit[playerIndex][leadSuit] = true;
        }
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
            let placed = false;
            // Prefer seats that are not void in this suit
            const candidates = otherSeats.filter(s => 
                simulatedHands[s].length < targetCounts[s] && !this.voidInSuit[s][card.suit]
            );

            if (candidates.length > 0) {
                const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                simulatedHands[chosen].push(card);
                placed = true;
            } else {
                unassigned.push(card);
            }
        }

        // Fallback for remaining unassigned cards
        for (let card of unassigned) {
            const openSeats = otherSeats.filter(s => simulatedHands[s].length < targetCounts[s]);
            if (openSeats.length > 0) {
                const chosen = openSeats[0];
                simulatedHands[chosen].push(card);
            }
        }

        return simulatedHands;
    }
}
