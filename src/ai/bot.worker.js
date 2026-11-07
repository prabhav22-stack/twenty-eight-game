/**
 * Web Worker: bot.worker.js
 * Offloads ISMCTS simulations to a background thread to maintain 60fps GSAP UI animations.
 */

// Embedded ISMCTS logic for self-contained Worker execution
self.onmessage = function (e) {
    const data = e.data;
    if (!data || data.type !== 'EVALUATE_MOVE') return;

    const {
        hand,
        validIndices,
        trickCards,
        leadSuit,
        trumpSuit,
        trumpRevealed,
        playerIdx,
        personality,
        voidInSuit,
        playedCards
    } = data;

    try {
        const bestIndex = runMCTS({
            hand,
            validIndices,
            trickCards,
            leadSuit,
            trumpSuit,
            trumpRevealed,
            playerIdx,
            personality,
            voidInSuit,
            playedCards,
            numRollouts: 80
        });

        self.postMessage({
            type: 'MOVE_EVALUATED',
            bestIndex: bestIndex,
            taskId: data.taskId
        });
    } catch (err) {
        // Fallback to first legal move on any unexpected error
        self.postMessage({
            type: 'MOVE_EVALUATED',
            bestIndex: validIndices && validIndices.length > 0 ? validIndices[0] : 0,
            taskId: data.taskId
        });
    }
};

function runMCTS(params) {
    const { hand, validIndices, trickCards, leadSuit, trumpSuit, trumpRevealed, playerIdx, personality, numRollouts } = params;
    if (!validIndices || validIndices.length === 0) return 0;
    if (validIndices.length === 1) return validIndices[0];

    const partnerSeat = (playerIdx + 2) % 4;
    const scores = {};
    for (let idx of validIndices) scores[idx] = 0;

    for (let r = 0; r < numRollouts; r++) {
        for (let moveIdx of validIndices) {
            const card = hand[moveIdx];
            let rolloutScore = 0;

            const simTrick = [...trickCards, { card, player: playerIdx }];
            const trickWinner = evaluateWinner(simTrick, leadSuit || card.suit, trumpSuit, trumpRevealed);
            const isTrickOver = (simTrick.length === 4);
            const trickPts = simTrick.reduce((sum, tc) => sum + (tc.card.value || 0), 0);
            const isWinnerUs = (trickWinner.player === playerIdx || trickWinner.player === partnerSeat);

            if (isTrickOver) {
                rolloutScore += isWinnerUs ? (trickPts * 12) : (-trickPts * 12);
            } else {
                rolloutScore += isWinnerUs ? 4 : -4;
            }

            // Personality utility injection
            if (personality === 'wingman') {
                if (trickWinner.player === partnerSeat) rolloutScore += (card.value * 8) + 6;
                if (card.rank === 'J' && !isTrickOver) rolloutScore -= 6;
            } else if (personality === 'striker') {
                if (card.power >= 6) rolloutScore += 8;
                if (isWinnerUs && trickPts >= 2) rolloutScore += 10;
            } else if (personality === 'saboteur') {
                if ((card.rank === 'J' || card.rank === '9') && trickPts < 3 && !isTrickOver) rolloutScore -= 14;
                if (!isWinnerUs && trickPts >= 4 && (card.rank === 'J' || card.rank === '9')) rolloutScore += 18;
            }

            scores[moveIdx] += rolloutScore;
        }
    }

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

function evaluateWinner(trickCards, leadSuit, trumpSuit, trumpRevealed) {
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
