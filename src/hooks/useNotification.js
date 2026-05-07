// Web Audio API notification sounds — no external files needed
// AudioContext starts suspended until user gesture — we resume on first interaction

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let resumed = false;

function getCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (!resumed && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => { resumed = true; }).catch(() => {});
  }
  return audioCtx;
}

// Resume on first user gesture
document.addEventListener('mousedown', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => { resumed = true; }).catch(() => {});
  }
}, { once: true });

function playTone(freq, duration, type = 'sine', volume = 0.3) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* audio not available */ }
}

// Pleasant ascending chime for task completion
export function playCompletionSound() {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.12);
    gain.gain.setValueAtTime(0.25, now + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.3);
  });
}

// Attention sound for errors
export function playErrorSound() {
  playTone(220, 0.4, 'square', 0.15);
  setTimeout(() => playTone(180, 0.4, 'square', 0.15), 200);
}

// Short click for new messages
export function playMessageSound() {
  playTone(880, 0.08, 'sine', 0.15);
}

// Rising notification for new session detected
export function playNewSessionSound() {
  const ctx = getCtx();
  const now = ctx.currentTime;
  [440, 554.37, 659.25].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + i * 0.1);
    gain.gain.setValueAtTime(0.2, now + i * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.1);
    osc.stop(now + i * 0.1 + 0.25);
  });
}
