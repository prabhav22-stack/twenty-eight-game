/**
 * Information Set Monte Carlo Tree Search (ISMCTS) for 28
 * Runs fast determinized rollouts to evaluate best card plays under imperfect information.
 */

export class ISMCTS {
    /**
     * Finds the highest expected value card index to play.
     * @param {object} params
     * @param {Array} params.hand - Bot's own cards
     * @param {Array} params.validIndices - Indices of legal plays in hand
     * @param {Array} params.trickCards - Current trick plays
     * @param {string|null} params.leadSuit - Suit led in trick
     * @param {string|null} params.trumpSuit - Trump suit
     * @param {boolean} params.trumpRevealed - Whether trump is known to all
     * @param {number} params.playerIdx - Bot seat index (0, 1, 2, 3)
     * @param {string} params.personality - 'wingman' | 'striker' | 'saboteur'
     * @param {InferenceMatrix} params.inference - Belief state
     * @param {number} [params.numRollouts=80] - Number of Monte Carlo simulations
     */
    static selectBestPlay({
        hand,
        validIndices,
        trickCards,
        leadSuit,
        trumpSuit,
        trumpRevealed,
        playerIdx,
        personality = 'wingman',
        inference,
        numRollouts = 60
    }) {
        if (!validIndices || validIndices.length === 0) return 0;
        if (validIndices.length === 1) return validIndices[0];

        const myTeam = (playerIdx === 0 || playerIdx === 2) ? 1 : 2;
        const partnerSeat = (playerIdx + 2) % 4;

        // Initialize score tallies for each legal move
        const scores = {};
        for (let idx of validIndices) scores[idx] = 0;

        const handCounts = [8, 8, 8, 8];
        const playedCount = (inference?.playedCards || []).length;
        const currentRoundTricks = Math.floor(playedCount / 4);
        for (let i = 0; i < 4; i++) {
            handCounts[i] = Math.max(0, 8 - currentRoundTricks - (trickCards.some(tc => tc.player === i) ? 1 : 0));
        }
        handCounts[playerIdx] = hand.length;

        // Perform MCTS Rollouts across sampled worlds
        for (let r = 0; r < numRollouts; r++) {
            const worldHands = inference ? inference.sampleHypotheticalWorld(playerIdx, hand, handCounts) : null;

            for (let moveIdx of validIndices) {
                const card = hand[moveIdx];
                let rolloutScore = 0;

                // 1. Evaluate immediate trick outcome with this card
                const simTrick = [...trickCards, { card, player: playerIdx }];
                const trickWinner = ISMCTS.evaluateTrickWinner(simTrick, leadSuit || card.suit, trumpSuit, trumpRevealed);
                const isTrickOver = (simTrick.length === 4);
                const trickPts = simTrick.reduce((sum, tc) => sum + (tc.card.value || 0), 0);

                const isWinnerMeOrPartner = (trickWinner.player === playerIdx || trickWinner.player === partnerSeat);

                if (isTrickOver) {
                    if (isWinnerMeOrPartner) {
                        rolloutScore += trickPts * 12;
                    } else {
                        rolloutScore -= trickPts * 12;
                    }
                } else {
                    // Intermediate trick heuristic
                    if (isWinnerMeOrPartner) rolloutScore += 4;
                    else rolloutScore -= 4;
                }

                // 2. Personality-Specific Utility Injection
                if (personality === 'wingman') {
                    // Cooperative: reward partner winning tricks, penalize taking tricks partner already owns
                    if (trickWinner.player === partnerSeat) {
                        rolloutScore += (card.value * 8) + 6; // Smear points to partner
                    }
                    if (card.rank === 'J' && !isTrickOver) {
                        rolloutScore -= 6; // Preserve master honors
                    }
                } else if (personality === 'striker') {
                    // Aggressive: attack to drain trumps and claim high tricks
                    if (card.power >= 6) rolloutScore += 8;
                    if (isWinnerMeOrPartner && trickPts >= 2) rolloutScore += 10;
                } else if (personality === 'saboteur') {
                    // Disruptive: hoard high honors (Jacks/9s) for high-value ambush
                    if ((card.rank === 'J' || card.rank === '9') && trickPts < 3 && !isTrickOver) {
                        rolloutScore -= 14; // Save for richer trick
                    }
                    if (!isWinnerMeOrPartner && trickPts >= 4 && (card.rank === 'J' || card.rank === '9')) {
                        rolloutScore += 18; // Ambush capture
                    }
                }

                scores[moveIdx] += rolloutScore;
            }
        }

        // Return move with highest average simulation score
        let bestIdx = validIndices[0];
        let bestVal = -Infinity;
        for (let idx of validIndices) {
            if (scores[idx] > bestVal) {
                bestVal = scores[idx];
                bestIdx = idx;
            }
        }

        return bestIdx;
    }

    static evaluateTrickWinner(trickCards, leadSuit, trumpSuit, trumpRevealed) {
        if (!trickCards || trickCards.length === 0) return null;
        let winner = trickCards[0];

        for (let tc of trickCards) {
            let isCurrentTrump = trumpRevealed && trumpSuit && (tc.card.suit === trumpSuit);
            let isWinnerTrump = trumpRevealed && trumpSuit && (winner.card.suit === trumpSuit);

            if (isCurrentTrump && !isWinnerTrump) {
                winner = tc;
            } else if (isCurrentTrump && isWinnerTrump) {
                if (tc.card.power > winner.card.power) winner = tc;
            } else if (!isCurrentTrump && !isWinnerTrump) {
                if (tc.card.suit === leadSuit && tc.card.power > winner.card.power) {
                    winner = tc;
                }
            }
        }

        return winner;
    }
}
