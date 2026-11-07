/**
 * PeerManager & State Redaction
 * Enforces host-authoritative state projections so connected peers
 * cannot inspect opponent hands or secret trumps via Chrome DevTools.
 */
export class PeerManager {
    /**
     * Projects a strictly sanitized, player-specific view of the game state.
     * @param {object} masterEngine - The authoritative TwentyEightEngine on the host
     * @param {number} clientSeat - The seat index of the recipient (0: South, 1: East, 2: North, 3: West, 99: Spectator)
     * @returns {object} Sanitized state projection safe to transmit across WebRTC
     */
    static getSanitizedStateForPeer(masterEngine, clientSeat) {
        if (!masterEngine) return null;

        // 1. Hand Sizes only for all seats
        const handSizes = [
            (masterEngine.players[0] || []).length,
            (masterEngine.players[1] || []).length,
            (masterEngine.players[2] || []).length,
            (masterEngine.players[3] || []).length
        ];

        // 2. Private Hand Projection: ONLY recipient's own cards are included
        let clientHand = [];
        if (clientSeat !== 99 && clientSeat >= 0 && clientSeat < 4) {
            clientHand = (masterEngine.players[clientSeat] || []).map(card => ({
                suit: card.suit,
                rank: card.rank,
                value: card.value,
                power: card.power
            }));
        }

        // 3. Secret Trump Redaction:
        // Only revealed if explicitly requested/cut OR if the recipient is the bid winner
        const canSeeTrump = masterEngine.trumpRevealed || (clientSeat === masterEngine.highestBidder);
        const projectedTrumpSuit = canSeeTrump ? masterEngine.trumpSuit : null;

        return {
            t1TrickPts: masterEngine.t1TrickPts,
            t2TrickPts: masterEngine.t2TrickPts,
            t1GamePts: masterEngine.t1GamePts,
            t2GamePts: masterEngine.t2GamePts,
            currentBid: masterEngine.currentBid,
            currentTurn: masterEngine.currentTurn,
            phase: masterEngine.phase,
            trickCards: (masterEngine.trickCards || []).map(tc => ({
                card: { suit: tc.card.suit, rank: tc.card.rank, value: tc.card.value, power: tc.card.power },
                player: tc.player
            })),
            leadSuit: masterEngine.leadSuit,
            myHand: clientHand,
            handSizes: handSizes,
            trumpRevealed: masterEngine.trumpRevealed,
            trumpSuit: projectedTrumpSuit,
            highestBidder: masterEngine.highestBidder,
            hasHiddenTrump: false, // Never expose raw token
            hasPassed: masterEngine.hasPassed || [false, false, false, false],
            playerBids: masterEngine.playerBids || [null, null, null, null],
            tricksWonByTeam: masterEngine.tricksWonByTeam,
            roundSuccess: masterEngine.roundSuccess,
            gamePointsWon: masterEngine.gamePointsWon,
            pairDeclared: masterEngine.pairDeclared,
            pairDeclaringTeam: masterEngine.pairDeclaringTeam
        };
    }
}
