// Tiny synthesized sound engine — no audio files, everything is WebAudio.
// Must be unlocked by a user gesture first (client calls resume() on first tap).
let ctx, master, sizzle;
let on = true;

function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
}
export function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function setEnabled(v) { on = v; if (!v) stopSizzle(); }
export function isEnabled() { return on; }

function noiseBuffer(dur = 0.4) {
  const n = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function env(node, t0, a, peak, d) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + a);
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function tone(freq, t0, dur, type = 'sine', peak = 0.4) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  env(g, t0, 0.01, peak, dur);
  o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}

export function play(name) {
  if (!on) return;
  ensure(); if (!ctx) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'step': {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.06);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 340;
      const g = ctx.createGain(); env(g, t, 0.005, 0.25, 0.05);
      s.connect(f).connect(g).connect(master); s.start(t);
      break;
    }
    case 'pour': {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.5); s.loop = false;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.45); f.Q.value = 1.2;
      const g = ctx.createGain(); env(g, t, 0.03, 0.35, 0.45);
      s.connect(f).connect(g).connect(master); s.start(t);
      break;
    }
    case 'splash': {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.2);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 600;
      const g = ctx.createGain(); env(g, t, 0.005, 0.3, 0.18);
      s.connect(f).connect(g).connect(master); s.start(t);
      break;
    }
    case 'stir': {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.3);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.8;
      const g = ctx.createGain(); env(g, t, 0.05, 0.18, 0.25);
      s.connect(f).connect(g).connect(master); s.start(t);
      break;
    }
    case 'slap': {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.12);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.7;
      const g = ctx.createGain(); env(g, t, 0.002, 0.9, 0.1);
      s.connect(f).connect(g).connect(master); s.start(t);
      tone(180, t + 0.01, 0.1, 'triangle', 0.3); // thud
      break;
    }
    case 'ding': { tone(880, t, 0.18, 'sine', 0.4); tone(1320, t + 0.09, 0.2, 'sine', 0.3); break; }
    case 'buzz': {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
      env(g, t, 0.01, 0.3, 0.3); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
      break;
    }
    case 'win': { [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.3, 'triangle', 0.35)); break; }
    case 'click': { tone(660, t, 0.06, 'square', 0.18); break; }
    case 'knob': { tone(300, t, 0.08, 'square', 0.2); tone(420, t + 0.06, 0.08, 'square', 0.18); break; }
    case 'bubble': {
      const f = 200 + Math.random() * 400;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.08);
      env(g, t, 0.005, 0.12, 0.08); o.connect(g).connect(master); o.start(t); o.stop(t + 0.15);
      break;
    }
  }
}

export function startSizzle() {
  if (!on) return;
  ensure(); if (!ctx || sizzle) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(1.0); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.6;
  const g = ctx.createGain(); g.gain.value = 0.0; g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.5);
  s.connect(f).connect(g).connect(master); s.start();
  sizzle = { s, g };
}
export function stopSizzle() {
  if (!sizzle) return;
  try { sizzle.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3); sizzle.s.stop(ctx.currentTime + 0.35); } catch {}
  sizzle = null;
}
