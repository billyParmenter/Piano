// Small additive piano-ish synth built on the Web Audio API.
class PianoSynth {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.volume = 0.8;
    this.timbre = 'piano'; // or 'guitar'
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noteOn(midi, velocity = 0.8, key = midi) {
    const ctx = this.ensure();
    this.noteOff(key, 0.02);
    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const vel = Math.max(0.1, Math.min(1, velocity));
    const guitar = this.timbre === 'guitar';
    const ring = guitar ? 0.5 + Math.max(0, 90 - midi) / 40 : 0.8 + Math.max(0, 96 - midi) / 28; // low notes ring longer

    const out = ctx.createGain();
    const peak = 0.22 * vel;
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(peak, now + 0.004);
    out.gain.setTargetAtTime(peak * (guitar ? 0.3 : 0.4), now + 0.004, guitar ? 0.06 : 0.12);
    out.gain.setTargetAtTime(0, now + 0.3, ring / 2.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    filter.frequency.setValueAtTime(Math.min(15000, freq * 6 + 2500 * vel), now);
    filter.frequency.setTargetAtTime(Math.max(freq * 2, 500), now, guitar ? 0.25 : 0.6);
    filter.connect(out);
    out.connect(this.master);

    const partials = guitar ? [
      [1, 'sawtooth', 0.45, 0],
      [1, 'triangle', 0.7, 3],
      [2, 'sine', 0.35, -2],
      [3, 'sine', 0.2, 0],
    ] : [
      [1, 'triangle', 1, 0],
      [1, 'sine', 0.5, 4],
      [2, 'sine', 0.25, -3],
      [3, 'sine', 0.08, 2],
      [4, 'sine', 0.04, 0],
    ];
    const oscs = [];
    const stopAt = now + ring * 3 + 0.5;
    for (const [mult, type, amp, detune] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(filter);
      o.start(now);
      o.stop(stopAt);
      oscs.push(o);
    }
    this.voices.set(key, { out, oscs });
  }

  noteOff(key, release = 0.18) {
    const v = this.voices.get(key);
    if (!v || !this.ctx) return;
    this.voices.delete(key);
    const now = this.ctx.currentTime;
    const g = v.out.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
    else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.setTargetAtTime(0, now, release / 4);
    for (const o of v.oscs) {
      try {
        o.stop(now + release + 0.1);
      } catch (e) {
        /* already stopped */
      }
    }
  }

  allOff() {
    for (const key of [...this.voices.keys()]) this.noteOff(key, 0.08);
  }
}
