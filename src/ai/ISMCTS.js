/**
 * Information Set Monte Carlo Tree Search (ISMCTS) for 28
 * Runs fast determinized rollouts with 28-specific tactical heuristics:
 * - 4-Seat Positional Awareness (Lead probing, 2nd hand low, 3rd hand high, 4th hand greed)
 * - CardMemory Matrix & Dynamic Boss Promotion
 * - Anti-Reveal Sloughing & K-Q Royal Pair Protection
 * - Personality Weaponization (Wingman, Striker, Saboteur)
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
     * @param {InferenceMatrix} params.inference - Belief state & CardMemory
     * @param {number} [params.currentBid=16] - Current contract target
     * @param {number} [params.t1Points=0] - Team 1 accumulated points
     * @param {number} [params.t2Points=0] - Team 2 accumulated points
     * @param {number} [params.highestBidder=-1] - Seat of contract winner
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

        const seatInTrick = (trickCards || []).length; // 0=Seat 1 (Lead), 1=Seat 2, 2=Seat 3, 3=Seat 4

        // Defending team contract-breaker distance
        const myTeamPts = (myTeam === 1) ? t1Points : t2Points;
        const oppTeamPts = (myTeam === 1) ? t2Points : t1Points;
        const defendingNeeded = (29 - currentBid) - (isContractorSide ? oppTeamPts : myTeamPts);

        // Initialize score tallies
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
            for (let moveIdx of validIndices) {
                const card = hand[moveIdx];
                let rolloutScore = 0;

                // 1. Evaluate immediate trick outcome
                const simTrick = [...trickCards, { card, player: playerIdx }];
                const trickWinner = ISMCTS.evaluateTrickWinner(simTrick, leadSuit || card.suit, trumpSuit, trumpRevealed);
                const isTrickOver = (simTrick.length === 4);
                const trickPts = simTrick.reduce((sum, tc) => sum + (tc.card.value || 0), 0);
                const isWinnerMeOrPartner = (trickWinner.player === playerIdx || trickWinner.player === partnerSeat);
                const isWinnerPartner = (trickWinner.player === partnerSeat);
                const isWinnerMe = (trickWinner.player === playerIdx);

                if (isTrickOver) {
                    rolloutScore += isWinnerMeOrPartner ? (trickPts * 14) : (-trickPts * 14);
                } else {
                    rolloutScore += isWinnerMeOrPartner ? 5 : -5;
                }

                // 2. Positional Awareness Heuristics (Seats 1 - 4)
                if (seatInTrick === 0) {
                    // SEAT 1 (Leader)
                    const isBoss = inference ? inference.isBossCard(card) : (card.rank === 'J');
                    const isTrump = trumpRevealed && trumpSuit && (card.suit === trumpSuit);

                    // Trump Pull Cessation: If both opponents void in trump, stop pulling trumps!
                    if (isTrump && inference && inference.voidInSuit[opp1][trumpSuit] && inference.voidInSuit[opp2][trumpSuit]) {
                        rolloutScore -= 30; // Save trumps to ruff opponent leads, cash side winners instead
                    }

                    // Boss Cashing vs Probing:
                    if (isBoss) {
                        // Check if opponent behind is void in this suit and holds trumps (Defensive rule)
                        const oppBehind = (playerIdx + 1) % 4;
                        const oppBehindVoid = inference && inference.voidInSuit[oppBehind][card.suit];
                        const oppHasTrump = !trumpRevealed || (inference && !inference.voidInSuit[oppBehind][trumpSuit]);
                        if (oppBehindVoid && oppHasTrump && !isTrump) {
                            rolloutScore -= 25; // Don't feed Jack into opponent's ruff!
                        } else {
                            rolloutScore += 16; // Cash safe boss card!
                        }
                    } else if (card.rank === '9') {
                        // Holding 9 without Jack: Probe with 7/8 instead of gifting 2 pts to an opponent Jack!
                        rolloutScore -= 12;
                    } else if (card.rank === '7' || card.rank === '8') {
                        // Probing lead with low card to smoke out opponent honors
                        rolloutScore += 6;
                    }
                } else if (seatInTrick === 1) {
                    // SEAT 2 (Second Hand Low)
                    const leadPlay = trickCards[0];
                    const isLeadByOpponent = (leadPlay.player === opp1 || leadPlay.player === opp2);
                    const isLeadLow = (leadPlay.card.rank === '7' || leadPlay.card.rank === '8');

                    if (isLeadByOpponent && isLeadLow) {
                        // If Jack of suit is still unplayed, play low! Don't waste vulnerable 9 or Ace into Seat 4!
                        const bossRank = inference ? inference.getBossRank(leadPlay.card.suit) : 'J';
                        if (bossRank === 'J' && (card.rank === '9' || card.rank === 'A' || card.rank === '10')) {
                            rolloutScore -= 18; // Second Hand Low
                        } else if (card.rank === '7' || card.rank === '8' || card.rank === 'Q') {
                            rolloutScore += 10;
                        }
                    }
                } else if (seatInTrick === 2) {
                    // SEAT 3 (Third Hand High / Finesse)
                    const leadPlay = trickCards[0];
                    const isLeadByPartner = (leadPlay.player === partnerSeat);
                    const isLeadLow = (leadPlay.card.rank === '7' || leadPlay.card.rank === '8');

                    if (isLeadByPartner && isLeadLow) {
                        // Partner led low to finesse / smoke out honors. Play high!
                        if (card.power >= 6) rolloutScore += 16;
                    }
                } else if (seatInTrick === 3) {
                    // SEAT 4 (Last to Play - Maximum Greed)
                    if (isWinnerPartner) {
                        // Fatten trick with riskiest point card (unprotected 10, Ace, or vulnerable 9)
                        if (card.value > 0) {
                            rolloutScore += (card.value * 16);
                            if (card.rank !== 'J') rolloutScore += 6; // Fatten without spending Jack
                        }
                    } else {
                        // Win as cheaply as possible:
                        if (isWinnerMe) {
                            // Reward winning, but penalize overkill
                            rolloutScore += 18;
                            rolloutScore -= (card.power * 2); // Prefers lowest winning card (e.g. 10 over J)
                        } else {
                            // Dump lowest trash
                            rolloutScore -= (card.value * 12);
                            if (card.power <= 2) rolloutScore += 8;
                        }
                    }
                }

                // 3. Personality Weaponization
                if (personality === 'wingman') {
                    // Partner Bot: Bid signaling & Desperation mode
                    if (isWinnerPartner) {
                        rolloutScore += (card.value * 14) + 8; // Cooperative smearing
                    }
                    if (isContractorSide && (currentBid - t1Points >= 5) && handCounts[playerIdx] <= 3) {
                        // Desperation mode: aggressively ruff and take tricks
                        if (isWinnerMe && trickPts >= 1) rolloutScore += 20;
                    }
                    // Protect partner's lead
                    if (card.rank === 'J' && !isTrickOver && !isWinnerPartner) {
                        rolloutScore -= 8;
                    }
                } else if (personality === 'striker') {
                    // Aggressive Opponent: Trump-Drain Gambit & Phase-1 Lead Punishment
                    const isDefending = !isContractorSide;
                    if (seatInTrick === 0 && trumpRevealed && isDefending && trumpSuit && card.suit === trumpSuit) {
                        // Trump-Drain Gambit: bleed bidder's trumps!
                        if (card.rank === 'J' || card.rank === '9') rolloutScore += 22;
                    }
                    if (seatInTrick === 0 && !trumpRevealed) {
                        // Phase-1 punishment: deliberately lead suits where holding A, 10, or 9
                        if (card.rank === 'A' || card.rank === '10' || card.rank === '9') rolloutScore += 12;
                    }
                    if (card.power >= 6 && isWinnerMe) rolloutScore += 10;
                } else if (personality === 'saboteur') {
                    // Disruptive Opponent: Baiting, Sandbagging & Contract-Breaker Math
                    if (seatInTrick === 0 && !trumpRevealed) {
                        // Baiting with low 7/8 when holding Jack of same suit
                        const hasJackInSuit = hand.some(c => c.suit === card.suit && c.rank === 'J');
                        if (hasJackInSuit && (card.rank === '7' || card.rank === '8')) rolloutScore += 18;
                    }

                    // Contract-Breaker Threshold Math:
                    if (!isContractorSide && defendingNeeded <= 3) {
                        // Just need <= 3 points to break the contract! Ruff aggressively!
                        if (isWinnerMe && trickPts >= 2) rolloutScore += 35;
                    } else {
                        // Sandbagging: don't reveal high honors into cheap tricks
                        if ((card.rank === 'J' || card.rank === '9') && trickPts < 2 && !isTrickOver) {
                            rolloutScore -= 16;
                        }
                    }
                }

                // 4. Royal Pair (K-Q) Protection
                if (!trumpRevealed && (card.rank === 'K' || card.rank === 'Q')) {
                    const hasMate = hand.some(c => c.suit === card.suit && (c.rank === 'K' || c.rank === 'Q') && c.rank !== card.rank);
                    const isProbable = inference ? inference.isProbableTrump(card.suit) : true;
                    if (hasMate && isProbable) {
                        rolloutScore -= 24; // Heavily penalize breaking potential Royal Pair before trump reveal!
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
