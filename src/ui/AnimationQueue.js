/**
 * AnimationQueue
 * Sequential Promise-based queue that guarantees GSAP timelines and DOM card
 * animations complete gracefully before state transitions or trick evaluations advance.
 */
export class AnimationQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.onIdleCallbacks = [];
    }

    /**
     * Enqueue an async animation task (e.g. a GSAP timeline or deal glide).
     * @param {() => Promise<void>} animationTask 
     * @returns {Promise<void>} resolves when this specific animation task finishes
     */
    enqueue(animationTask) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    await animationTask();
                    resolve();
                } catch (err) {
                    console.error('[AnimationQueue] Task error:', err);
                    reject(err);
                }
            });

            if (!this.isProcessing) {
                this.processNext();
            }
        });
    }

    async processNext() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try {
                await task();
            } catch (err) {
                console.error('[AnimationQueue] Execution failed:', err);
            }
        }

        this.isProcessing = false;
        while (this.onIdleCallbacks.length > 0) {
            const cb = this.onIdleCallbacks.shift();
            try { cb(); } catch (e) {}
        }
    }

    /**
     * Wait for all queued animations to complete.
     */
    whenIdle() {
        if (!this.isProcessing && this.queue.length === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.onIdleCallbacks.push(resolve);
        });
    }

    clear() {
        this.queue = [];
        this.isProcessing = false;
        this.onIdleCallbacks = [];
    }
}
