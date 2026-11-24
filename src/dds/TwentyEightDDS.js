/**
 * TwentyEightDDS - Bitmask-based Minimax Double-Dummy Solver
 * Evaluates par contracts, trick equities, and optimal card lines.
 */
export const DDS_SUITS = ['♠', '♥', '♣', '♦'];
export const DDS_RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
export const DDS_RANK_VALUES = [3, 2, 1, 1, 0, 0, 0, 0];
export const DDS_RANK_POWERS = [8, 7, 6, 5, 4, 3, 2, 1];
export const DDS_SUIT_MASKS = [
    0x000000FF,
    0x0000FF00,
    0x00FF0000,
    (0xFF000000 | 0)
];

export class TwentyEightDDS {
    static cardToId(card) {
        if (!card) return -1;
        const s = DDS_SUITS.indexOf(card.suit);
        const r = DDS_RANKS.indexOf(card.rank);
        if (s === -1 || r === -1) return -1;
        return (s << 3) | r;
    }

    static idToCard(id) {
        if (id < 0 || id > 31) return null;
        const s = id >> 3;
        const r = id & 7;
        return {
            suit: DDS_SUITS[s],
            rank: DDS_RANKS[r],
            value: DDS_RANK_VALUES[r],
            power: DDS_RANK_POWERS[r]
        };
    }

    static handToBitmask(cards) {
        let mask = 0;
        if (!cards) return mask;
        for (let c of cards) {
            const id = (typeof c === 'number') ? c : TwentyEightDDS.cardToId(c);
            if (id >= 0) mask |= (1 << id);
        }
        return mask;
    }

    static getLegalMovesMask(handMask, leadSuitIdx) {
        if (leadSuitIdx < 0 || leadSuitIdx > 3) return handMask;
        const suitMask = DDS_SUIT_MASKS[leadSuitIdx];
        const inSuit = handMask & suitMask;
        return (inSuit !== 0) ? inSuit : handMask;
    }

    static getCardIdsFromMask(mask) {
        const ids = [];
        let m = mask;
        while (m !== 0) {
            const lowest = m & (-m);
            const id = 31 - Math.clz32(lowest);
            ids.push(id);
            m ^= lowest;
        }
        return ids;
    }

    static evalTrickWinner(trickPlays, trumpSuitIdx, trumpRevealed) {
        let winPlay = trickPlays[0];
        let winCardId = winPlay.cardId;
        let winSuit = winCardId >> 3;
        let winPower = DDS_RANK_POWERS[winCardId & 7];
        let leadSuit = winSuit;
        let winIsTrump = trumpRevealed && (trumpSuitIdx >= 0) && (winSuit === trumpSuitIdx);

        for (let i = 1; i < trickPlays.length; i++) {
            const play = trickPlays[i];
            const cid = play.cardId;
            const suit = cid >> 3;
            const power = DDS_RANK_POWERS[cid & 7];
            const isTrump = trumpRevealed && (trumpSuitIdx >= 0) && (suit === trumpSuitIdx);

            if (isTrump && !winIsTrump) {
                winPlay = play;
                winCardId = cid;
                winSuit = suit;
                winPower = power;
                winIsTrump = true;
            } else if (isTrump && winIsTrump) {
                if (power > winPower) {
                    winPlay = play;
                    winCardId = cid;
                    winPower = power;
                }
            } else if (!winIsTrump && suit === leadSuit) {
                if (power > winPower) {
                    winPlay = play;
                    winCardId = cid;
                    winPower = power;
                }
            }
        }
        return winPlay;
    }

    static fastRollout(handsBitmask, startPlayer, trumpSuitIdx, trumpRevealed) {
        const hands = new Uint32Array(handsBitmask);
        let turn = startPlayer;
        let t1Pts = 0;

        while (hands[0] !== 0 || hands[1] !== 0 || hands[2] !== 0 || hands[3] !== 0) {
            const trick = [];
            let leadSuitIdx = -1;

            for (let seat = 0; seat < 4; seat++) {
                const player = (turn + seat) % 4;
                const legalMask = TwentyEightDDS.getLegalMovesMask(hands[player], leadSuitIdx);
                const legalIds = TwentyEightDDS.getCardIdsFromMask(legalMask);
                if (legalIds.length === 0) continue;

                let chosenId = legalIds[0];
                if (legalIds.length > 1) {
                    const rnd = Math.floor(Math.random() * legalIds.length);
                    chosenId = legalIds[rnd];
                }

                hands[player] ^= (1 << chosenId);
                trick.push({ player, cardId: chosenId });
                if (seat === 0) leadSuitIdx = chosenId >> 3;
            }

            if (trick.length === 4) {
                const winPlay = TwentyEightDDS.evalTrickWinner(trick, trumpSuitIdx, trumpRevealed);
                let pts = 0;
                for (let p of trick) pts += DDS_RANK_VALUES[p.cardId & 7];
                if (winPlay.player === 0 || winPlay.player === 2) t1Pts += pts;
                turn = winPlay.player;
            } else {
                break;
            }
        }
        return t1Pts;
    }

    static solve(hands, turnPlayer, currentTrick, trumpSuitIdx, trumpRevealed, alpha, beta, tt, depth = 0) {
        if (hands[0] === 0 && hands[1] === 0 && hands[2] === 0 && hands[3] === 0 && currentTrick.length === 0) {
            return 0;
        }

        let trickKey = 0;
        for (let i = 0; i < currentTrick.length; i++) {
            trickKey = (trickKey << 8) | (currentTrick[i].player << 5) | (currentTrick[i].cardId & 31);
        }
        const ttKey = `${hands[0]}_${hands[1]}_${hands[2]}_${hands[3]}_${turnPlayer}_${trickKey}`;
        if (tt && tt.has(ttKey)) {
            return tt.get(ttKey);
        }

        const isTeam1 = (turnPlayer === 0 || turnPlayer === 2);
        const leadSuitIdx = (currentTrick.length > 0) ? (currentTrick[0].cardId >> 3) : -1;
        const legalMask = TwentyEightDDS.getLegalMovesMask(hands[turnPlayer], leadSuitIdx);
        const legalIds = TwentyEightDDS.getCardIdsFromMask(legalMask);

        if (legalIds.length === 0) return 0;

        legalIds.sort((a, b) => {
            const vA = DDS_RANK_VALUES[a & 7];
            const vB = DDS_RANK_VALUES[b & 7];
            return isTeam1 ? (vB - vA) : (vA - vB);
        });

        let bestVal = isTeam1 ? -Infinity : Infinity;

        for (const cid of legalIds) {
            hands[turnPlayer] ^= (1 << cid);
            const nextTrick = currentTrick.concat([{ player: turnPlayer, cardId: cid }]);
            let score = 0;

            if (nextTrick.length === 4) {
                const winnerPlay = TwentyEightDDS.evalTrickWinner(nextTrick, trumpSuitIdx, trumpRevealed);
                let trickPts = 0;
                for (let p of nextTrick) trickPts += DDS_RANK_VALUES[p.cardId & 7];
                const ptsForTeam1 = (winnerPlay.player === 0 || winnerPlay.player === 2) ? trickPts : 0;

                const restScore = TwentyEightDDS.solve(
                    hands,
                    winnerPlay.player,
                    [],
                    trumpSuitIdx,
                    trumpRevealed,
                    alpha,
                    beta,
                    tt,
                    depth + 1
                );
                score = ptsForTeam1 + restScore;
            } else {
                const nextPlayer = (turnPlayer + 1) % 4;
                score = TwentyEightDDS.solve(
                    hands,
                    nextPlayer,
                    nextTrick,
                    trumpSuitIdx,
                    trumpRevealed,
                    alpha,
                    beta,
                    tt,
                    depth + 1
                );
            }

            hands[turnPlayer] |= (1 << cid);

            if (isTeam1) {
                if (score > bestVal) bestVal = score;
                if (score > alpha) alpha = score;
            } else {
                if (score < bestVal) bestVal = score;
                if (score < beta) beta = score;
            }

            if (beta <= alpha) {
                break;
            }
        }

        if (tt && tt.size < 100000) {
            tt.set(ttKey, bestVal);
        }
        return bestVal;
    }

    static evaluateMoveEquities(handsArray, turnPlayer, currentTrickCards, trumpSuitIdx, trumpRevealed, candidateCards) {
        const hands = new Uint32Array(4);
        let totalCards = 0;
        for (let i = 0; i < 4; i++) {
            hands[i] = (typeof handsArray[i] === 'number') ? handsArray[i] : TwentyEightDDS.handToBitmask(handsArray[i]);
            let m = hands[i];
            while (m !== 0) { totalCards++; m &= (m - 1); }
        }

        const currentTrick = (currentTrickCards || []).map(tc => ({
            player: tc.player,
            cardId: (typeof tc.card === 'number') ? tc.card : TwentyEightDDS.cardToId(tc.card)
        }));

        const isTeam1 = (turnPlayer === 0 || turnPlayer === 2);
        const equities = {};
        const leadSuitIdx = (currentTrick.length > 0) ? (currentTrick[0].cardId >> 3) : -1;
        const legalMask = TwentyEightDDS.getLegalMovesMask(hands[turnPlayer], leadSuitIdx);
        const legalIds = TwentyEightDDS.getCardIdsFromMask(legalMask);

        const cardsToTest = candidateCards
            ? candidateCards.map(c => (typeof c === 'number' ? c : TwentyEightDDS.cardToId(c))).filter(id => (legalMask & (1 << id)))
            : legalIds;

        if (totalCards <= 20) {
            const tt = new Map();
            for (const cid of cardsToTest) {
                hands[turnPlayer] ^= (1 << cid);
                const nextTrick = currentTrick.concat([{ player: turnPlayer, cardId: cid }]);
                let score = 0;

                if (nextTrick.length === 4) {
                    const winnerPlay = TwentyEightDDS.evalTrickWinner(nextTrick, trumpSuitIdx, trumpRevealed);
                    let trickPts = 0;
                    for (let p of nextTrick) trickPts += DDS_RANK_VALUES[p.cardId & 7];
                    const ptsForTeam1 = (winnerPlay.player === 0 || winnerPlay.player === 2) ? trickPts : 0;

                    score = ptsForTeam1 + TwentyEightDDS.solve(
                        hands,
                        winnerPlay.player,
                        [],
                        trumpSuitIdx,
                        trumpRevealed,
                        -Infinity,
                        Infinity,
                        tt,
                        0
                    );
                } else {
                    const nextPlayer = (turnPlayer + 1) % 4;
                    score = TwentyEightDDS.solve(
                        hands,
                        nextPlayer,
                        nextTrick,
                        trumpSuitIdx,
                        trumpRevealed,
                        -Infinity,
                        Infinity,
                        tt,
                        0
                    );
                }

                hands[turnPlayer] |= (1 << cid);
                const cardObj = TwentyEightDDS.idToCard(cid);
                equities[`${cardObj.rank}${cardObj.suit}`] = score;
            }
        } else {
            const numSamples = 40;
            for (const cid of cardsToTest) {
                hands[turnPlayer] ^= (1 << cid);
                const nextTrick = currentTrick.concat([{ player: turnPlayer, cardId: cid }]);
                let totalPts = 0;

                for (let s = 0; s < numSamples; s++) {
                    let sTrickPts = 0;
                    let nextPlayer = (turnPlayer + 1) % 4;
                    if (nextTrick.length === 4) {
                        const win = TwentyEightDDS.evalTrickWinner(nextTrick, trumpSuitIdx, trumpRevealed);
                        let pts = 0;
                        for (let p of nextTrick) pts += DDS_RANK_VALUES[p.cardId & 7];
                        if (win.player === 0 || win.player === 2) sTrickPts += pts;
                        nextPlayer = win.player;
                        totalPts += sTrickPts + TwentyEightDDS.fastRollout(hands, nextPlayer, trumpSuitIdx, trumpRevealed);
                    } else {
                        const tempHands = new Uint32Array(hands);
                        const fillTrick = [...nextTrick];
                        let curP = nextPlayer;
                        let lSuit = fillTrick[0].cardId >> 3;
                        while (fillTrick.length < 4) {
                            const lMask = TwentyEightDDS.getLegalMovesMask(tempHands[curP], lSuit);
                            const lIds = TwentyEightDDS.getCardIdsFromMask(lMask);
                            const pick = lIds[Math.floor(Math.random() * lIds.length)];
                            tempHands[curP] ^= (1 << pick);
                            fillTrick.push({ player: curP, cardId: pick });
                            curP = (curP + 1) % 4;
                        }
                        const win = TwentyEightDDS.evalTrickWinner(fillTrick, trumpSuitIdx, trumpRevealed);
                        let pts = 0;
                        for (let p of fillTrick) pts += DDS_RANK_VALUES[p.cardId & 7];
                        if (win.player === 0 || win.player === 2) sTrickPts += pts;
                        totalPts += sTrickPts + TwentyEightDDS.fastRollout(tempHands, win.player, trumpSuitIdx, trumpRevealed);
                    }
                }

                hands[turnPlayer] |= (1 << cid);
                const cardObj = TwentyEightDDS.idToCard(cid);
                equities[`${cardObj.rank}${cardObj.suit}`] = Math.round((totalPts / numSamples) * 10) / 10;
            }
        }

        return equities;
    }

    static solvePar(handsArray, turnPlayer, trumpSuitIdx, trumpRevealed) {
        const hands = new Uint32Array(4);
        let totalCards = 0;
        for (let i = 0; i < 4; i++) {
            hands[i] = (typeof handsArray[i] === 'number') ? handsArray[i] : TwentyEightDDS.handToBitmask(handsArray[i]);
            let m = hands[i];
            while (m !== 0) { totalCards++; m &= (m - 1); }
        }
        if (totalCards <= 20) {
            const tt = new Map();
            return TwentyEightDDS.solve(hands, turnPlayer, [], trumpSuitIdx, trumpRevealed, -Infinity, Infinity, tt, 0);
        } else {
            let total = 0;
            for (let i = 0; i < 50; i++) {
                total += TwentyEightDDS.fastRollout(hands, turnPlayer, trumpSuitIdx, trumpRevealed);
            }
            return Math.round((total / 50) * 10) / 10;
        }
    }
}

