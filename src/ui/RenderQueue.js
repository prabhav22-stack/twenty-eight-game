/**
 * RenderQueue - Serialized Presentation & Authoritative State Reconciliation
 * Eliminates race-prone boolean mutexes (animatingTrick, dealingAnimationActive, etc.)
 * by serializing visual transitions into typed Promise tasks with hard failsafe timeouts.
 */
export class RenderQueue {
    constructor(uiController = null) {
        this.ui = uiController;
        this.queue = [];
        this.isProcessing = false;
        this.latestAuthoritativeState = null;
        this.currentTask = null;
        this.taskTimeoutId = null;

        // Auto-reconcile on visibility change (mobile app background / foreground)
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => this.reconcileOnVisibilityChange());
        }
    }

    setUIController(uiController) {
        this.ui = uiController;
    }

    /**
     * Stores incoming authoritative state from WebRTC/Engine immediately.
     * Never dropped even if animations are currently running.
     */
    pushAuthoritativeState(state) {
        if (!state) return;
        const currentSeq = this.latestAuthoritativeState ? (this.latestAuthoritativeState.stateSeq || 0) : -1;
        const newSeq = (state.stateSeq !== undefined) ? state.stateSeq : (currentSeq + 1);

        if (!this.latestAuthoritativeState || newSeq >= currentSeq) {
            this.latestAuthoritativeState = state;
        }
    }

    /**
     * Enqueues a visual transition task.
     * @param {string} taskType - 'DEAL_1' | 'BID_UPDATE' | 'DEAL_2' | 'PLAY_CARD' | 'REVEAL_TRUMP' | 'SWEEP_TRICK' | 'ROUND_OVER'
     * @param {Function} taskFn - Function returning a Promise (e.g. GSAP timeline completion)
     * @param {object} options - { timeoutMs, stateSeq }
     */
    enqueue(taskType, taskFn, options = {}) {
        const timeoutMs = options.timeoutMs || 4000;
        const stateSeq = (options.stateSeq !== undefined) 
            ? options.stateSeq 
            : (this.latestAuthoritativeState ? (this.latestAuthoritativeState.stateSeq || 0) : 0);

        const task = {
            id: Math.random().toString(36).substring(2, 9),
            type: taskType,
            fn: taskFn,
            timeoutMs,
            stateSeq
        };

        this.queue.push(task);
        if (!this.isProcessing) {
            this.processNext();
        }
    }

    async processNext() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            this.currentTask = null;
            return;
        }

        this.isProcessing = true;
        this.currentTask = this.queue.shift();

        // If client skipped multiple states (e.g. browser throttled rAF while tabbed out),
        // flush stale intermediate animations and snap directly to the latest state.
        if (this.latestAuthoritativeState && (this.latestAuthoritativeState.stateSeq - this.currentTask.stateSeq > 2)) {
            console.warn(`[RenderQueue] State skipped ahead (${this.currentTask.stateSeq} -> ${this.latestAuthoritativeState.stateSeq}). Flushing stale animation queue.`);
            this.clear();
            if (this.ui && typeof this.ui.renderStaticBoard === 'function') {
                this.ui.renderStaticBoard(this.latestAuthoritativeState);
            }
            this.isProcessing = false;
            return;
        }

        let completed = false;
        const done = () => {
            if (completed) return;
            completed = true;
            if (this.taskTimeoutId) {
                clearTimeout(this.taskTimeoutId);
                this.taskTimeoutId = null;
            }
            this.processNext();
        };

        // Hard failsafe timeout: background tabs in iOS Safari / Android Chrome will never deadlock
        this.taskTimeoutId = setTimeout(() => {
            console.warn(`[RenderQueue] Task '${this.currentTask.type}' timed out after ${this.currentTask.timeoutMs}ms. Resuming queue.`);
            done();
        }, this.currentTask.timeoutMs);

        try {
            const res = this.currentTask.fn();
            if (res && typeof res.then === 'function') {
                res.then(done).catch(err => {
                    console.error(`[RenderQueue] Error in '${this.currentTask.type}':`, err);
                    done();
                });
            } else {
                done();
            }
        } catch (err) {
            console.error(`[RenderQueue] Exception in '${this.currentTask.type}':`, err);
            done();
        }
    }

    clear() {
        if (this.taskTimeoutId) {
            clearTimeout(this.taskTimeoutId);
            this.taskTimeoutId = null;
        }
        this.queue = [];
        this.isProcessing = false;
        this.currentTask = null;
    }

    reconcileOnVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            if (this.latestAuthoritativeState) {
                this.clear();
                if (typeof window !== 'undefined' && window.gsap) {
                    window.gsap.killTweensOf('.card, .card-flyer, #trick-meta-cluster, #dramatic-reveal');
                }
                if (this.ui && typeof this.ui.renderStaticBoard === 'function') {
                    this.ui.renderStaticBoard(this.latestAuthoritativeState);
                }
            }
        }
    }

    whenIdle() {
        if (!this.isProcessing && this.queue.length === 0) return Promise.resolve();
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!this.isProcessing && this.queue.length === 0) {
                    clearInterval(check);
                    resolve();
                }
            }, 50);
        });
    }
}
