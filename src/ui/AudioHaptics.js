/**
 * AudioHaptics - Web Audio Synthesis & Mobile Haptics Manager
 * Zero-asset procedural audio generation and tactile device vibrations.
 */
let audioCtx = null;
let noiseBuffer = null;
let soundEnabled = true;

function triggerHaptic(type) {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator) || typeof navigator.vibrate !== 'function') return;
    try {
        if (type === 'turn') {
            // Short, multiple crisp pulse (25ms) when it becomes Your Turn to play or bid
            navigator.vibrate([25, 40, 25]);
        } else if (type === 'pair') {
            // Double-pulse (40ms) when a Royal Pair (K+Q) is declared
            navigator.vibrate([40, 50, 40]);
        } else if (type === 'reveal') {
            // Dramatic heavy vibration (80ms) when the Secret Trump is Revealed
            navigator.vibrate([80, 50, 120]);
        }
    } catch(e) {}
}


function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}
if (typeof window !== 'undefined') {
    ['click', 'touchstart', 'touchend', 'keydown'].forEach(evt => {
        window.addEventListener(evt, () => {
            unlockAudio();
        }, { passive: true });
    });
}

function getNoiseBuffer(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const bufferSize = ctx.sampleRate * 1.0;
    noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
}

function playSound(type) {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        const now = ctx.currentTime;
        if (type === 'rustle') {
            // Subtle paper card slide/lift in fingers
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1400, now);
            filter.Q.setValueAtTime(3.0, now);
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.001, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.07, now + 0.005);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(now);
            noise.stop(now + 0.045);
        } else if (type === 'deal') {
            // Realistic card flick and slide across felt table
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            const centerFreq = 1900 + (Math.random() - 0.5) * 320;
            filter.frequency.setValueAtTime(centerFreq, now);
            filter.Q.setValueAtTime(2.2, now);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.001, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(now);
            noise.stop(now + 0.06);

            // Subtle low-end flex snap of the card (130Hz -> 45Hz)
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(130, now);
            osc.frequency.exponentialRampToValueAtTime(45, now + 0.035);
            oscGain.gain.setValueAtTime(0.08, now);
            oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.04);
        } else if (type === 'shuffle') {
            // Realistic 3D Riffle Shuffle: 14 rapid micro card-snaps and deck squaring slap
            const snapCount = 14;
            const duration = 0.38;
            for (let i = 0; i < snapCount; i++) {
                const noteTime = now + (i / snapCount) * duration + (Math.random() - 0.5) * 0.01;
                const noise = ctx.createBufferSource();
                noise.buffer = getNoiseBuffer(ctx);
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(2200 + i * 40 + (Math.random() - 0.5) * 200, noteTime);
                filter.Q.setValueAtTime(3.5, noteTime);

                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.001, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.14, noteTime + 0.002);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.025);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(ctx.destination);
                noise.start(noteTime);
                noise.stop(noteTime + 0.03);
            }
            const slapTime = now + duration + 0.12;
            const slapNoise = ctx.createBufferSource();
            slapNoise.buffer = getNoiseBuffer(ctx);
            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(2400, slapTime);
            const slapGain = ctx.createGain();
            slapGain.gain.setValueAtTime(0.001, slapTime);
            slapGain.gain.exponentialRampToValueAtTime(0.2, slapTime + 0.003);
            slapGain.gain.exponentialRampToValueAtTime(0.001, slapTime + 0.035);
            slapNoise.connect(highpass);
            highpass.connect(slapGain);
            slapGain.connect(ctx.destination);
            slapNoise.start(slapTime);
            slapNoise.stop(slapTime + 0.04);
        } else if (type === 'play') {
            // Authentic card slap / snap on green felt casino table
            const noise = ctx.createBufferSource();
            noise.buffer = getNoiseBuffer(ctx);
            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(2800, now);

            const snapGain = ctx.createGain();
            snapGain.gain.setValueAtTime(0.001, now);
            snapGain.gain.exponentialRampToValueAtTime(0.22, now + 0.002);
            snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

            noise.connect(highpass);
            highpass.connect(snapGain);
            snapGain.connect(ctx.destination);
            noise.start(now);
            noise.stop(now + 0.03);

            // Resonant table body impact (felt/wood thump)
            const osc = ctx.createOscillator();
            const lowpass = ctx.createBiquadFilter();
            const thumpGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(185, now);
            osc.frequency.exponentialRampToValueAtTime(55, now + 0.065);

            lowpass.type = 'lowpass';
            lowpass.frequency.setValueAtTime(400, now);

            thumpGain.gain.setValueAtTime(0.28, now);
            thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

            osc.connect(lowpass);
            lowpass.connect(thumpGain);
            thumpGain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === 'reveal') {
            // Majestic Royal Trump Reveal: Warm celestial arpeggio chime & sub-bass swell
            const chord = [523.25, 659.25, 783.99, 987.77, 1046.50];
            chord.forEach((freq, idx) => {
                const noteTime = now + idx * 0.045;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const filter = ctx.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(2600, noteTime);

                gain.gain.setValueAtTime(0.001, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.16, noteTime + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.65);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.68);
            });

            // Sub-bass cinematic boom
            const bass = ctx.createOscillator();
            const bassGain = ctx.createGain();
            bass.type = 'sine';
            bass.frequency.setValueAtTime(95, now);
            bass.frequency.exponentialRampToValueAtTime(42, now + 0.35);
            bassGain.gain.setValueAtTime(0.2, now);
            bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
            bass.connect(bassGain);
            bassGain.connect(ctx.destination);
            bass.start(now);
            bass.stop(now + 0.4);
        } else if (type === 'trick') {
            // Card gather sweep & victory chip collect
            [0, 0.035, 0.07].forEach((delay) => {
                const noise = ctx.createBufferSource();
                noise.buffer = getNoiseBuffer(ctx);
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1600 + Math.random() * 200, now + delay);
                filter.Q.setValueAtTime(3.0, now + delay);

                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.001, now + delay);
                gain.gain.exponentialRampToValueAtTime(0.12, now + delay + 0.004);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.04);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(ctx.destination);
                noise.start(now + delay);
                noise.stop(now + delay + 0.045);
            });

            // Affirmative chime (E5 -> A5)
            [659.25, 880.00].forEach((freq, idx) => {
                const noteTime = now + 0.09 + idx * 0.06;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.001, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.15, noteTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.36);
            });
        } else if (type === 'bid') {
            // Crisp wooden auction gavel / clay chip click
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(540, now);
            osc.frequency.exponentialRampToValueAtTime(180, now + 0.035);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.045);
        } else if (type === 'tick') {
            // Subtle crisp countdown tick
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1760, now + 0.02);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.03);
        } else if (type === 'tick_urgent') {
            // Urgent final-second warning tick
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(2400, now + 0.03);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.04);
        } else if (type === 'pass') {
            // Soft, discreet felt tap
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.exponentialRampToValueAtTime(70, now + 0.04);
            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'trump_select') {
            // Velvet lock / secret trump chosen
            [392.00, 523.25].forEach((freq, idx) => {
                const noteTime = now + idx * 0.06;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.12, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.32);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.34);
            });
        } else if (type === 'pair') {
            // Royal K-Q Pair Fanfare
            [392.00, 523.25, 659.25, 783.99].forEach((freq, idx) => {
                const noteTime = now + idx * 0.06;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.16, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.45);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.48);
            });
        } else if (type === 'win') {
            // Celebratory match triumph fanfare
            [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, idx) => {
                const noteTime = now + idx * 0.07;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.18, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.55);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.58);
            });
        } else if (type === 'lose') {
            // Somber defeat phrase
            [392.00, 311.13, 261.63].forEach((freq, idx) => {
                const noteTime = now + idx * 0.12;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, noteTime);
                gain.gain.setValueAtTime(0.15, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.5);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(noteTime);
                osc.stop(noteTime + 0.52);
            });
        }
    } catch(e) {}
}

function toggleAudio() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('sound-btn');
    if (btn) btn.innerText = soundEnabled ? '🔊' : '🔇';
}



export {
    audioCtx,
    soundEnabled,
    getAudioContext,
    unlockAudio,
    getNoiseBuffer,
    playSound,
    toggleAudio,
    triggerHaptic
};
