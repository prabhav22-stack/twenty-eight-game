/**
 * ISMCTS - Information Set Monte Carlo Tree Search
 * Evaluates bot tactical moves across personality archetypes.
 */
import { TwentyEightDDS } from '../dds/TwentyEightDDS.js';

export class ISMCTS {
    static selectBestPlay(params) {
        const {
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
        } = params;

        if (!validIndices || validIndices.length === 0) return 0;
        if (validIndices.length === 1) return validIndices[0];

        const myTeam = (playerIdx === 0 || playerIdx === 2) ? 1 : 2;
        const contractorTeam = (highestBidder === 0 || highestBidder === 2) ? 1 : 2;
        const isContractorSide = (myTeam === contractorTeam);
        const partnerSeat = (playerIdx + 2) % 4;
        const seatInTrick = (trickCards || []).length;

        const myTeamPts = (myTeam === 1) ? t1Points : t2Points;
        const oppTeamPts = (myTeam === 1) ? t2Points : t1Points;
        const defendingNeeded = (29 - currentBid) - (isContractorSide ? oppTeamPts : myTeamPts);

        // Framework 2: Dynamic Objective Weight Vector w = [w_imm, w_pres, w_rev, w_ctrl, w_feed]
        let defaultWeights;
        if (currentBid >= 24) {
            // Tier 3: Grand Slam / All-In (24-28 pts)
            defaultWeights = {
                immediatePts: 0.98,
                preserveHonors: 0.05,
                forceTrumpReveal: 0.60,
                suitControl: 0.95,
                partnerFeed: 0.90
            };
        } else if (currentBid >= 20 || defendingNeeded <= 3) {
            // Tier 2: Aggressive High Stakes (20-23 pts or critical defense)
            defaultWeights = {
                immediatePts: 0.90,
                preserveHonors: (defendingNeeded <= 3) ? 0.08 : 0.22,
                forceTrumpReveal: 0.45,
                suitControl: 0.80,
                partnerFeed: 0.85
            };
        } else {
            // Tier 1: Standard Tactical Play (16-19 pts)
            defaultWeights = {
                immediatePts: (defendingNeeded <= 4) ? 0.85 : 0.70,
                preserveHonors: (defendingNeeded <= 4) ? 0.20 : 0.50,
                forceTrumpReveal: 0.25,
                suitControl: 0.65,
                partnerFeed: 0.75
            };
        }
        const w = utilityWeights || defaultWeights;

        // Framework 4: Opponent Behavioral Calibrations (Bait Frequency)
        const thetaBait = (opponentProfile && typeof opponentProfile.thetaBait === 'number') ? opponentProfile.thetaBait : 0.20;

        // Framework 3: AlphaZero-style PUCT structures
        const c_puct = 1.414;
        const N = {};
        const W = {};
        const P = {};

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
        const currentTricks = Math.floor(((inference?.playedCards || []).length) / 4);
        for (let i = 0; i < 4; i++) {
            handCounts[i] = Math.max(0, 8 - currentTricks - (trickCards.some(tc => tc.player === i) ? 1 : 0));
        }
        handCounts[playerIdx] = hand.length;

        // Upgrade 1: Hybrid Search - Exact Double Dummy Solver for Endgame (Tricks 4-8, <= 5 cards)
        if (hand.length <= 5 && hand.length > 1) {
            try {
                const moveScores = {};
                for (let idx of validIndices) moveScores[idx] = 0;
                const numWorlds = 20;

                for (let w = 0; w < numWorlds; w++) {
                    const sampledTrump = trumpRevealed ? trumpSuit : (inference ? inference.sampleSecretTrump(trumpPriors) : (trumpSuit || '♠'));
                    const sTrumpIdx = DDS_SUITS.indexOf(sampledTrump);
                    const simHands = inference
                        ? inference.sampleHypotheticalWorld(playerIdx, hand, handCounts)
                        : [[...hand], [...hand], [...hand], [...hand]];

                    const candidateCardObjs = validIndices.map(i => hand[i]);
                    const equities = TwentyEightDDS.evaluateMoveEquities(
                        simHands,
                        playerIdx,
                        trickCards,
                        sTrumpIdx,
                        trumpRevealed,
                        candidateCardObjs
                    );

                    for (let idx of validIndices) {
                        const cKey = `${hand[idx].rank}${hand[idx].suit}`;
                        const eq = (equities[cKey] !== undefined) ? equities[cKey] : 0;
                        const myTeamVal = (myTeam === 1) ? eq : (28 - eq);
                        moveScores[idx] += myTeamVal;
                    }
                }

                let bestIdx = validIndices[0];
                let bestScore = -Infinity;
                for (let idx of validIndices) {
                    if (moveScores[idx] > bestScore) {
                        bestScore = moveScores[idx];
                        bestIdx = idx;
                    }
                }
                return bestIdx;
            } catch (err) {
                console.warn("Endgame DDS fallback to PUCT:", err);
            }
        }

        // PUCT Selection Loop for Early Game (Tricks 1-3)
        for (let r = 0; r < numRollouts; r++) {
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
            const trickWinner = ISMCTS.evaluateWinner(simTrick, leadSuit || card.suit, activeTrump, trumpRevealed);
            const isTrickOver = (simTrick.length === 4);
            const trickPts = simTrick.reduce((sum, tc) => sum + (tc.card.value || 0), 0);
            const isWinnerUs = (trickWinner.player === playerIdx || trickWinner.player === partnerSeat);
            const isWinnerPartner = (trickWinner.player === partnerSeat);
            const isWinnerMe = (trickWinner.player === playerIdx);

            // Normalized feature vector phi in [-1, 1]
            let phi_immediate = isWinnerUs ? (trickPts / 4.0) : -(trickPts / 4.0);
            if (!isTrickOver && isWinnerUs) phi_immediate += 0.25;

            let phi_preserve = 0;
            if (card.rank === 'J' || card.rank === '9') {
                phi_preserve = isWinnerUs ? 0.3 : -0.8;
            } else if (card.power <= 2) {
                phi_preserve = 0.5;
            }

            let phi_reveal = 0;
            if (!trumpRevealed && card.suit === activeTrump) {
                phi_reveal = (playerIdx === highestBidder) ? -0.7 : 0.5;
            }

            let phi_control = 0;
            const isBoss = inference ? inference.isBossCard(card) : (card.rank === 'J');
            if (seatInTrick === 0) {
                if (isBoss) phi_control = 0.8;
                else if (card.rank === '9') phi_control = -0.5;
                else if (card.rank === '7' || card.rank === '8') phi_control = 0.3;
            } else if (seatInTrick === 1) {
                const leadPlay = trickCards[0];
                if (leadPlay.card.rank === '7' || leadPlay.card.rank === '8') {
                    if (card.rank === '9' || card.rank === 'A') {
                        phi_control = -0.7 * (1.0 + thetaBait);
                    } else {
                        phi_control = 0.4;
                    }
                }
            } else if (seatInTrick === 2) {
                if (trickCards[0].player === partnerSeat && card.power >= 6) phi_control = 0.6;
            } else if (seatInTrick === 3) {
                if (!isWinnerPartner && isWinnerMe) phi_control = 0.5 - (card.power * 0.05);
            }

            let phi_feed = 0;
            if (isWinnerPartner && card.value > 0) {
                // Upgrade 3: 4th-seat ruff danger check for North (seat 2)
                const westVoidInLead = inference && inference.voidInSuit && inference.voidInSuit[3] && leadSuit && inference.voidInSuit[3][leadSuit];
                if (playerIdx === 2 && seatInTrick === 2 && westVoidInLead) {
                    phi_feed = -2.5; // Do NOT feed points into 4th seat over-ruff!
                } else {
                    phi_feed = (card.value / 3.0);
                }
            }

            // Royal Pair (K+Q) Protection
            if (isContractorSide && card.suit === activeTrump && (card.rank === 'K' || card.rank === 'Q')) {
                phi_preserve += 0.8;
            }

            // Upgrade 4: East/West SetTarget dynamics & Tenace Trapping
            if (!isContractorSide) {
                if (seatInTrick === 1 && card.power >= 5 && !isBoss && defendingNeeded > 4) {
                    phi_control -= 0.5; // West 2nd seat tenace ducking in Phase A
                }
                if (defendingNeeded <= 4) {
                    if (isWinnerMe && trickPts > 0) phi_immediate += 0.6; // Phase B: Cash masters immediately!
                }
            }

            // Total Dynamic Utility
            let U = (w.immediatePts * phi_immediate) +
                    (w.preserveHonors * phi_preserve) +
                    (w.forceTrumpReveal * phi_reveal) +
                    (w.suitControl * phi_control) +
                    (w.partnerFeed * phi_feed);

            if (personality === 'wingman' && isWinnerPartner) U += 0.3;
            else if (personality === 'striker' && isWinnerMe && trickPts >= 2) U += 0.4;
            else if (personality === 'saboteur' && defendingNeeded <= 3 && isWinnerMe && trickPts >= 2) U += 0.6;

            N[selectedIdx] += 1;
            W[selectedIdx] += U;
        }

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

    static evaluateWinner(trickCards, leadSuit, trumpSuit, trumpRevealed) {
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
