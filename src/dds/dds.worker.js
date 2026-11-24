/**
 * dds.worker.js - Web Worker for TwentyEightDDS Minimax Solving
 * Offloads heavy par and counterfactual equity calculations off the main UI thread.
 */
import { TwentyEightDDS } from './TwentyEightDDS.js';

self.onmessage = function (e) {
    const { id, type, payload } = e.data;
    try {
        if (type === 'SOLVE_PAR') {
            const { hands, lead, trumpSuitIdx, trumpRevealed } = payload;
            const par = TwentyEightDDS.solvePar(hands, lead, trumpSuitIdx, trumpRevealed);
            self.postMessage({ id, success: true, result: par });
        } else if (type === 'EVAL_EQUITIES') {
            const { hands, trickCards, leadSuitIdx, trumpSuitIdx, trumpRevealed, candidateCards, parBaseline } = payload;
            const equities = TwentyEightDDS.evaluateMoveEquities(
                hands, trickCards, leadSuitIdx, trumpSuitIdx, trumpRevealed, candidateCards, parBaseline
            );
            self.postMessage({ id, success: true, result: equities });
        } else if (type === 'EVAL_TRICK_INCREMENTAL') {
            // Incremental evaluation of a single trick during the round
            const { hands, lead, trumpSuitIdx, trumpRevealed } = payload;
            const par = TwentyEightDDS.solvePar(hands, lead, trumpSuitIdx, trumpRevealed);
            self.postMessage({ id, success: true, result: { par } });
        } else {
            self.postMessage({ id, success: false, error: `Unknown worker task type: ${type}` });
        }
    } catch (err) {
        self.postMessage({ id, success: false, error: err.message || String(err) });
    }
};
