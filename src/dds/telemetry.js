/**
 * telemetry.js - Post-Round Game Analysis & Telemetry Engine
 * Calculates par points, Expected Contract Equity (ECE), move regret, partner synergy, and swing moments.
 */
import { TwentyEightDDS, DDS_SUITS } from './TwentyEightDDS.js';

export function calculateRoundTelemetry(engine, humanSeat = 0, currentLang = 'en') {
    if (!engine) return null;

    let bidTeam = (engine.highestBidder === 0 || engine.highestBidder === 2) ? 1 : 2;
    let isDeclarer = (engine.highestBidder === 0);
    let team1Target = (bidTeam === 1) ? engine.currentBid : (29 - engine.currentBid);
    let hSeat = (humanSeat !== undefined && humanSeat !== 99 && humanSeat >= 0 && humanSeat < 4) ? humanSeat : 0;
    let isHumanBidWinner = (engine.highestBidder === hSeat);
    let trumpIdx = DDS_SUITS.indexOf(engine.trumpSuit);
    let isHi = (currentLang === 'hi');

    // 1. Initial Deal & Double-Dummy Par Points (P_par)
    let initialHands = (engine.trickSnapshots && engine.trickSnapshots[0] && engine.trickSnapshots[0].hands)
        ? engine.trickSnapshots[0].hands
        : (engine.deal1Hands && engine.deal2Hands ? [
            [...(engine.deal1Hands[0]||[]), ...(engine.deal2Hands[0]||[])],
            [...(engine.deal1Hands[1]||[]), ...(engine.deal2Hands[1]||[])],
            [...(engine.deal1Hands[2]||[]), ...(engine.deal2Hands[2]||[])],
            [...(engine.deal1Hands[3]||[]), ...(engine.deal2Hands[3]||[])]
          ] : null);

    let parPoints = 16;
    if (initialHands && trumpIdx >= 0) {
        try {
            parPoints = Math.round(TwentyEightDDS.solvePar(initialHands, 0, trumpIdx, true));
        } catch (e) {
            console.warn("DDS solvePar fallback:", e);
        }
    }

    // 2. Expected Contract Equity (ECE) & Multi-Trick Rollback Regret
    let paceGraph = [];
    let maxRegret = -1;
    let bestInflectionTrick = 0;
    let bestCardPlayed = null;
    let bestOptimalCard = null;
    let bestInflectionDetail = "";
    let prevECE = 0;

    const roundTricks = engine.roundTricks || [];
    for (let i = 0; i < roundTricks.length; i++) {
        let t = roundTricks[i];
        let snap = (engine.trickSnapshots && engine.trickSnapshots[i]) ? engine.trickSnapshots[i] : null;
        let trickNum = t.trickNum || (i + 1);

        let t1PtsSoFar = t.t1TotalAfter || 0;
        let remainingPar = 0;
        if (snap && snap.hands && i < roundTricks.length - 1 && trumpIdx >= 0) {
            try {
                let nextLead = (t.winningPlayer !== undefined) ? t.winningPlayer : (t.plays && t.plays[0] ? t.plays[0].player : 0);
                remainingPar = TwentyEightDDS.solvePar(snap.hands, nextLead, trumpIdx, engine.trumpRevealed);
            } catch (e) {}
        }
        let currentECE = (t1PtsSoFar + remainingPar) - team1Target;
        let deltaECE = currentECE - prevECE;
        prevECE = currentECE;

        let totalPts = (t.t1TotalAfter || 0) + (t.t2TotalAfter || 0);
        let legacyPace = t1PtsSoFar - (team1Target * (totalPts / 28.0));

        paceGraph.push({
            trickNum: trickNum,
            ece: Math.round(currentECE * 10) / 10,
            paceDelta: Math.round(legacyPace * 10) / 10,
            deltaChange: Math.round(deltaECE * 10) / 10,
            pointsInTrick: t.points,
            winningTeam: t.winningTeam
        });

        // Multi-Trick Regret Evaluation for Human Player
        if (snap && snap.hands && snap.hands[hSeat] && trumpIdx >= 0) {
            let humanHandAtTrick = snap.hands[hSeat];
            let humanPlay = t.plays ? t.plays.find(p => p.player === hSeat) : null;
            let cardPlayedStr = humanPlay && humanPlay.card ? `${humanPlay.card.rank}${humanPlay.card.suit}` : null;

            if (cardPlayedStr && humanHandAtTrick.length > 1) {
                let leadSuit = (t.plays && t.plays.length > 0 && t.plays[0].card) ? t.plays[0].card.suit : null;
                let legalCards = humanHandAtTrick;
                if (leadSuit && humanHandAtTrick.some(c => c.suit === leadSuit)) {
                    legalCards = humanHandAtTrick.filter(c => c.suit === leadSuit);
                }

                if (legalCards.length > 1) {
                    try {
                        let playsBeforeHuman = [];
                        if (t.plays) {
                            for (let p of t.plays) {
                                if (p.player === hSeat) break;
                                playsBeforeHuman.push({ player: p.player, card: p.card });
                            }
                        }
                        let equities = TwentyEightDDS.evaluateMoveEquities(
                            snap.hands,
                            hSeat,
                            playsBeforeHuman,
                            trumpIdx,
                            engine.trumpRevealed,
                            legalCards
                        );

                        let playedVal = equities[cardPlayedStr] !== undefined ? equities[cardPlayedStr] : -Infinity;
                        let maxVal = -Infinity;
                        let optCard = cardPlayedStr;

                        for (let cKey in equities) {
                            if (equities[cKey] > maxVal) {
                                maxVal = equities[cKey];
                                optCard = cKey;
                            }
                        }

                        let trickRegret = (maxVal > -Infinity && playedVal > -Infinity) ? (maxVal - playedVal) : 0;
                        if (trickRegret > maxRegret) {
                            maxRegret = trickRegret;
                            bestInflectionTrick = trickNum;
                            bestCardPlayed = cardPlayedStr;
                            bestOptimalCard = optCard;
                        }
                    } catch (e) {
                        console.warn("DDS regret eval error:", e);
                    }
                }
            }
        }
    }

    // Fallback / Alignment for Turning Point
    let trickBlunder = engine.humanBlunders && engine.humanBlunders.length > 0 ? engine.humanBlunders[0] : null;
    if (maxRegret <= 0.5) {
        if (trickBlunder) {
            bestInflectionTrick = trickBlunder.trickNum || 1;
            bestCardPlayed = trickBlunder.cardPlayed || null;
            bestOptimalCard = trickBlunder.optimalCard || bestCardPlayed;
        } else if (roundTricks.length > 0) {
            let decisive = roundTricks[0];
            let bestScore = -1;
            for (let t of roundTricks) {
                let hasHonor = (t.plays || []).some(p => p.card && (p.card.rank === 'J' || p.card.rank === '9'));
                let sc = (t.points || 0) * 10 + (hasHonor ? 1 : 0);
                if (sc > bestScore) {
                    bestScore = sc;
                    decisive = t;
                }
            }
            bestInflectionTrick = decisive.trickNum || (roundTricks.indexOf(decisive) + 1);
            let hp = (decisive.plays || []).find(p => p.player === hSeat);
            bestCardPlayed = (hp && hp.card) ? `${hp.card.rank}${hp.card.suit}` : null;
            bestOptimalCard = bestCardPlayed;
        }
    } else if (engine.roundEventLog && engine.roundEventLog.swingMoments && engine.roundEventLog.swingMoments.length === 0 && bestCardPlayed) {
        engine.roundEventLog.swingMoments.push({
            trickNum: bestInflectionTrick,
            player: hSeat,
            cardPlayed: bestCardPlayed,
            optimalCard: bestOptimalCard,
            regret: Math.round(maxRegret * 10) / 10
        });
    }

    let dropPct = maxRegret > 0.5
        ? Math.min(65, Math.max(15, Math.round((maxRegret / (team1Target || 16)) * 100)))
        : 0;
    let winProbDropStr = dropPct > 0 ? `-${dropPct}%` : `0%`;

    // Partner Synergy calculation
    let partnerSeat = (hSeat + 2) % 4;
    let smearsGiftingPoints = 0;
    let totalSmearsOpportunities = 0;
    for (let t of roundTricks) {
        if (t.winningPlayer === hSeat && t.plays) {
            let pPlay = t.plays.find(p => p.player === partnerSeat);
            if (pPlay && pPlay.card) {
                totalSmearsOpportunities++;
                let pts = (pPlay.card.rank === 'J' ? 3 : (pPlay.card.rank === '9' ? 2 : ((pPlay.card.rank === 'A' || pPlay.card.rank === '10') ? 1 : 0)));
                if (pts > 0) smearsGiftingPoints += pts;
            }
        }
    }
    let partnerSynergyScore = totalSmearsOpportunities > 0 
        ? Math.min(95, Math.max(45, Math.round(50 + (smearsGiftingPoints * 12))))
        : (engine.roundSuccess ? 82 : 60);

    return {
        overallGrade: (maxRegret <= 0.5 && engine.roundSuccess) ? 'A+' : (engine.roundSuccess ? 'A-' : (maxRegret > 2.0 ? 'C-' : 'B')),
        parPoints,
        paceGraph,
        turning_point: {
            trickNumber: bestInflectionTrick,
            cardPlayed: bestCardPlayed,
            optimalCard: bestOptimalCard,
            paceDrop: winProbDropStr,
            pointRegret: Math.round(maxRegret * 10) / 10
        },
        partner_synergy: {
            score: partnerSynergyScore,
            note: isHi ? `साझेदार के साथ तालमेल: ${partnerSynergyScore}%` : `Partner Cohesion: ${partnerSynergyScore}%`
        },
        event_log: engine.roundEventLog || null
    };
}
