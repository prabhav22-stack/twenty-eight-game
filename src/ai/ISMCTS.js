/**
 * Information Set Monte Carlo Tree Search (ISMCTS) for 28
 * Enhanced with AlphaZero-style PUCT Prior Policy and Groq Dynamic Utility Tuning:
 * 1. PUCT Selection: PUCT(s, a) = Q(s, a) + c_puct * P_Groq(s, a) * sqrt(sum N) / (1 + N(a))
 * 2. Dynamic Utility: U(s, a) = w_imm * phi_imm + w_pres * phi_pres + w_rev * phi_rev + w_ctrl * phi_ctrl + w_feed * phi_feed
 * 3. Bayesian Trump Prior Weighting
 * 4. Opponent Modeling & Bluff Calibration
 */

export class ISMCTS {
    /**
     * Finds the highest expected value card index to play using PUCT & Dynamic Utilities.
     * @param {object} params
     * @param {Array} params.hand - Bot's cards
     * @param {Array} params.validIndices - Indices of legal plays in hand
     * @param {Array} params.trickCards - Current trick plays
     * @param {string|null} params.leadSuit - Suit led in trick
     * @param {string|null} params.trumpSuit - Trump suit (if known)
     * @param {boolean} params.trumpRevealed - Whether trump is known to all
     * @param {number} params.playerIdx - Bot seat index (0, 1, 2, 3)
     * @param {string} params.personality - 'wingman' | 'striker' | 'saboteur'
     * @param {InferenceMatrix} params.inference - Belief state & CardMemory
     * @param {number} [params.currentBid=16] - Current contract target
     * @param {number} [params.t1Points=0] - Team 1 accumulated points
     * @param {number} [params.t2Points=0] - Team 2 accumulated points
     * @param {number} [params.highestBidder=-1] - Seat of contract winner
     * @param {object|null} [params.utilityWeights=null] - Dynamic weights w from Groq co-processor
     * @param {object|null} [params.movePriors=null] - Prior policy P_Groq(s, a)
     * @param {object|null} [params.trumpPriors=null] - Bayesian trump priors
     * @param {object|null} [params.opponentProfile=null] - Human behavioral parameters (thetaBluff, thetaBait)
     * @param {number} [params.numRollouts=60] - Number of Monte Carlo simulations
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
        currentBid = 16,
        t1Points = 0,
        t2Points = 0,
        highestBidder = -1,
        utilityWeights = null,
        movePriors = null,
        trumpPriors = null,
        opponentProfile = null,
        numRollouts = 60
    }) {
        if (!validIndices || validIndices.length === 0) return 0;
        if (validIndices.length === 1) return validIndices[0];

        const myTeam = (playerIdx === 0 || playerIdx === 2) ? 1 : 2;
        const contractorTeam = (highestBidder === 0 || highestBidder === 2) ? 1 : 2;
        const isContractorSide = (myTeam === contractorTeam);
        const partnerSeat = (playerIdx + 2) % 4;
        const opp1 = (playerIdx + 1) % 4;
        const opp2 = (playerIdx + 3) % 4;
        const seatInTrick = (trickCards || []).length;

        const myTeamPts = (myTeam === 1) ? t1Points : t2Points;
        const oppTeamPts = (myTeam === 1) ? t2Points : t1Points;
        const defendingNeeded = (29 - currentBid) - (isContractorSide ? oppTeamPts : myTeamPts);

        // Framework 2: Dynamic Objective Weight Vector w = [w_imm, w_pres, w_rev, w_ctrl, w_feed]
        const w = utilityWeights || {
            immediatePts: (defendingNeeded <= 4 || currentBid >= 19) ? 0.95 : 0.70,
            preserveHonors: (defendingNeeded <= 4 || currentBid >= 19) ? 0.10 : 0.50,
            forceTrumpReveal: 0.20,
            suitControl: 0.65,
            partnerFeed: 0.75
        };

        // Framework 4: Opponent Behavioral Calibrations
        const thetaBait = (opponentProfile && typeof opponentProfile.thetaBait === 'number') ? opponentProfile.thetaBait : 0.20;

        // Framework 3: AlphaZero-style PUCT Tracking Structures
        const c_puct = 1.414;
        const N = {}; // Visit counts
        const W = {}; // Total accumulated utility value
        const P = {}; // Move prior policy P_Groq(s, a)

        // Initialize move priors
        let rawPriorSum = 0;
        for (let idx of validIndices) {
            N[idx] = 0;
            W[idx] = 0;
            const c = hand[idx];
            const rawCardKey = `${c.rank}${c.suit}`;
            const basePrior = (movePriors && typeof movePriors[rawCardKey] === 'number')
                ? movePriors[rawCardKey]
                : (c.power + c.value * 2);
            P[idx] = Math.max(0.05, basePrior);
            rawPriorSum += P[idx];
        }
        for (let idx of validIndices) P[idx] /= (rawPriorSum || 1);

        const handCounts = [8, 8, 8, 8];
        const playedCount = (inference?.playedCards || []).length;
        const currentRoundTricks = Math.floor(playedCount / 4);
        for (let i = 0; i < 4; i++) {
            handCounts[i] = Math.max(0, 8 - currentRoundTricks - (trickCards.some(tc => tc.player === i) ? 1 : 0));
        }
        handCounts[playerIdx] = hand.length;

        // PUCT Exploration Loop
        for (let r = 0; r < numRollouts; r++) {
            // PUCT Selection step: argmax PUCT(s, a)
            const totalN = Object.values(N).reduce((a, b) => a + b, 0);
            let selectedIdx = validIndices[0];
            let bestPUCT = -Infinity;

            for (let idx of validIndices) {
                const q = (N[idx] > 0) ? (W[idx] / N[idx]) : 0.0;
                const exploration = c_puct * P[idx] * (Math.sqrt(totalN) / (1 + N[idx]));
                const puctScore = q + exploration;
                if (puctScore > bestPUCT) {
                    bestPUCT = puctScore;
                    selectedIdx = idx;
                }
            }

            const card = hand[selectedIdx];
            const simTrick = [...trickCards, { card, player: playerIdx }];
            const activeTrump = trumpSuit || (inference ? inference.sampleSecretTrump(trumpPriors) : '♠');
            const trickWinner = ISMCTS.evaluateTrickWinner(simTrick, leadSuit || card.suit, activeTrump, trumpRevealed);
            const isTrickOver = (simTrick.length === 4);
            const trickPts = simTrick.reduce((sum, tc) => sum + (tc.card.value || 0), 0);
            const isWinnerUs = (trickWinner.player === playerIdx || trickWinner.player === partnerSeat);
            const isWinnerPartner = (trickWinner.player === partnerSeat);
            const isWinnerMe = (trickWinner.player === playerIdx);

            // Compute normalized feature vector phi in [-1, 1]
            // phi_immediatePts: trick points normalized to [-1, 1]
            let phi_immediate = isWinnerUs ? (trickPts / 4.0) : -(trickPts / 4.0);
            if (!isTrickOver && isWinnerUs) phi_immediate += 0.25;

            // phi_preserveHonors: penalty for throwing unprotected honors
            let phi_preserve = 0;
            if (card.rank === 'J' || card.rank === '9') {
                phi_preserve = isWinnerUs ? 0.3 : -0.8;
            } else if (card.power <= 2) {
                phi_preserve = 0.5; // Conserving high cards
            }

            // phi_forceReveal: reward forcing or punishing reveals
            let phi_reveal = 0;
            if (!trumpRevealed && card.suit === activeTrump) {
                phi_reveal = (playerIdx === highestBidder) ? -0.7 : 0.5;
            }

            // phi_suitControl: maintaining boss status or probing
            let phi_control = 0;
            const isBoss = inference ? inference.isBossCard(card) : (card.rank === 'J');
            if (seatInTrick === 0) {
                if (isBoss) phi_control = 0.8;
                else if (card.rank === '9') phi_control = -0.5; // Probing rule
                else if (card.rank === '7' || card.rank === '8') phi_control = 0.3;
            } else if (seatInTrick === 1) {
                // Second hand low scaled by human bait frequency (Framework 4)
                const leadPlay = trickCards[0];
                if (leadPlay.card.rank === '7' || leadPlay.card.rank === '8') {
                    if (card.rank === '9' || card.rank === 'A') {
                        phi_control = -0.7 * (1.0 + thetaBait);
                    } else {
                        phi_control = 0.4;
                    }
                }
            } else if (seatInTrick === 2) {
                if (trickCards[0].player === partnerSeat && card.power >= 6) phi_control = 0.6; // 3rd hand high
            } else if (seatInTrick === 3) {
                if (!isWinnerPartner && isWinnerMe) phi_control = 0.5 - (card.power * 0.05); // Win as cheaply as possible
            }

            // phi_partnerFeed: smearing points onto partner
            let phi_feed = 0;
            if (isWinnerPartner && card.value > 0) {
                phi_feed = (card.value / 3.0);
            }

            // Compute Total Dynamic Utility U(s, a)
            let U = (w.immediatePts * phi_immediate) +
                    (w.preserveHonors * phi_preserve) +
                    (w.forceTrumpReveal * phi_reveal) +
                    (w.suitControl * phi_control) +
                    (w.partnerFeed * phi_feed);

            // Personality-specific heuristic injection
            if (personality === 'wingman' && isWinnerPartner) U += 0.3;
            else if (personality === 'striker' && isWinnerMe && trickPts >= 2) U += 0.4;
            else if (personality === 'saboteur' && defendingNeeded <= 3 && isWinnerMe && trickPts >= 2) U += 0.6;

            // Update PUCT visit counts and cumulative values
            N[selectedIdx] += 1;
            W[selectedIdx] += U;
        }

        // Return move with highest visit count N (standard MCTS decision policy)
        let bestIdx = validIndices[0];
        let maxVisits = -1;
        for (let idx of validIndices) {
            if (N[idx] > maxVisits) {
                maxVisits = N[idx];
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
