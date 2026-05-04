/**
 * Procedural Web Audio engine. No external assets — every sound is synthesized
 * from oscillators + filtered noise + envelope gains. Lazy-init AudioContext on
 * first user gesture (browsers require this).
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let volume = 0.6;

const VOLUME_KEY = 'arena.volume';
const MUTE_KEY = 'arena.muted';

try {
  const raw = localStorage.getItem(VOLUME_KEY);
  const v = raw === null ? NaN : Number(raw);
  // Ignore stale volume=0 (otherwise everything is silent and user can't tell why).
  if (Number.isFinite(v) && v > 0 && v <= 1) volume = v;
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* ignore */
}

function ensure(): AudioContext | null {
  if (ctx) {
    // Best-effort: resume on every sound call — browsers often suspend after a while.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  }
  try {
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
    if (!Ctor) {
      // eslint-disable-next-line no-console
      console.warn('[audio] AudioContext not supported');
      return null;
    }
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(ctx.destination);
    // Attach persistent resume on any user gesture (autoplay policy).
    const resumeOnGesture = () => {
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeOnGesture);
    window.addEventListener('keydown', resumeOnGesture);
    window.addEventListener('touchstart', resumeOnGesture, { passive: true });
    // eslint-disable-next-line no-console
    console.info('[audio] context created, state=', ctx.state, 'muted=', muted, 'volume=', volume);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audio] ensure failed', e);
    ctx = null;
  }
  return ctx;
}

/** Should be wired to first user gesture (click/tap) to satisfy autoplay policies. */
export function unlockAudio(): void {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') {
    void c.resume()
      .then(() => {
        // eslint-disable-next-line no-console
        console.info('[audio] resumed, state=', c.state);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[audio] resume failed', e);
      });
  }
  // If user is unlocking, override stale persisted mute=true ONLY if explicit click on mute button.
  // (Don't auto-unmute here; setMuted handles that.)
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* ignore */
  }
  if (masterGain && !muted) masterGain.gain.value = volume;
}

export function getVolume(): number {
  return volume;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (masterGain) masterGain.gain.value = m ? 0 : volume;
}

export function isMuted(): boolean {
  return muted;
}

// ───── Helpers ─────
function noiseBuffer(c: AudioContext, durationS: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * durationS)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(c: AudioContext, attack: number, peak: number, decay: number): GainNode {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

// ───── Sounds ─────
export function shoot(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  // Bright noise burst + downward sweep tonal click
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 0.12);
  const bp = c.createBiquadFilter();
  bp.type = 'highpass';
  bp.frequency.value = 1200;
  const ng = envGain(c, 0.002, 0.4, 0.1);
  noise.connect(bp).connect(ng).connect(masterGain);
  noise.start();
  noise.stop(c.currentTime + 0.12);

  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(900, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.1);
  const og = envGain(c, 0.002, 0.18, 0.1);
  osc.connect(og).connect(masterGain);
  osc.start();
  osc.stop(c.currentTime + 0.12);
}

export function hit(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  // Metallic "thwack" — pitched ring + body + snap
  const t0 = c.currentTime;

  // 1. Short pitched ring (metallic ping)
  const ring = c.createOscillator();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(1200, t0);
  ring.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
  const ringGain = c.createGain();
  ringGain.gain.setValueAtTime(0.0001, t0);
  ringGain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.004);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  ring.connect(ringGain).connect(masterGain);
  ring.start(t0);
  ring.stop(t0 + 0.25);

  // 2. Body thump — low sine thud
  const thud = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(200, t0);
  thud.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
  const thudGain = c.createGain();
  thudGain.gain.setValueAtTime(0.0001, t0);
  thudGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.005);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  thud.connect(thudGain).connect(masterGain);
  thud.start(t0);
  thud.stop(t0 + 0.18);

  // 3. Snap noise burst
  const snap = c.createBufferSource();
  snap.buffer = noiseBuffer(c, 0.06);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const snapGain = c.createGain();
  snapGain.gain.setValueAtTime(0.0001, t0);
  snapGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.002);
  snapGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  snap.connect(hp).connect(snapGain).connect(masterGain);
  snap.start(t0);
  snap.stop(t0 + 0.07);
}

export function hitObstacle(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  const ng = envGain(c, 0.001, 0.35, 0.08);
  noise.connect(lp).connect(ng).connect(masterGain);
  noise.start();
  noise.stop(c.currentTime + 0.1);
}

export function death(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  // Descending sine sweep + low noise burst
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(440, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.6);
  const og = envGain(c, 0.005, 0.4, 0.55);
  o.connect(og).connect(masterGain);
  o.start();
  o.stop(c.currentTime + 0.65);

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 0.6);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, c.currentTime);
  lp.frequency.exponentialRampToValueAtTime(150, c.currentTime + 0.5);
  const ng = envGain(c, 0.005, 0.3, 0.55);
  noise.connect(lp).connect(ng).connect(masterGain);
  noise.start();
  noise.stop(c.currentTime + 0.65);
}

export function dash(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 0.2);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2000, c.currentTime);
  bp.frequency.exponentialRampToValueAtTime(400, c.currentTime + 0.18);
  bp.Q.value = 2;
  const ng = envGain(c, 0.005, 0.3, 0.18);
  noise.connect(bp).connect(ng).connect(masterGain);
  noise.start();
  noise.stop(c.currentTime + 0.22);
}

export function uiClick(): void {
  const c = ensure();
  if (!c || !masterGain) return;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 880;
  const og = envGain(c, 0.002, 0.18, 0.04);
  o.connect(og).connect(masterGain);
  o.start();
  o.stop(c.currentTime + 0.06);
}

export function beep(freq: number, durationS = 0.15, peak = 0.3): void {
  const c = ensure();
  if (!c || !masterGain) return;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const og = envGain(c, 0.005, peak, durationS - 0.005);
  o.connect(og).connect(masterGain);
  o.start();
  o.stop(c.currentTime + durationS + 0.02);
}

export function matchStartTick(n: number): void {
  // n=3,2,1 → ascending tones, n=0 → "FIGHT" chord
  if (n > 0) {
    const freq = n === 3 ? 440 : n === 2 ? 523 : 659;
    beep(freq, 0.18, 0.35);
  } else {
    beep(660, 0.4, 0.25);
    beep(880, 0.4, 0.25);
    beep(1320, 0.5, 0.2);
  }
}

export function matchEnd(win: boolean): void {
  if (win) {
    beep(660, 0.18, 0.3);
    setTimeout(() => beep(880, 0.18, 0.3), 180);
    setTimeout(() => beep(1320, 0.4, 0.25), 360);
  } else {
    beep(440, 0.2, 0.25);
    setTimeout(() => beep(330, 0.2, 0.25), 200);
    setTimeout(() => beep(220, 0.5, 0.2), 400);
  }
}
