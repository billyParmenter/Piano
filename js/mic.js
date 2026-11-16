// Microphone note detection: hear an acoustic/digital piano through the phone's mic.
//
// How it works
//  1. A small FFT (fast) watches for note *onsets* using spectral flux on the log spectrum.
//  2. ~70 ms after an onset, a large FFT (precise) is analysed. We subtract the spectrum from
//     just before the onset so notes that are still ringing don't get detected again.
//  3. Each candidate pitch gets a harmonic "salience" score. Notes the song expects right now are
//     checked first (this makes chords and octave confusions much more reliable); if none match,
//     the strongest plausible pitch is reported (counts as a wrong note in the game).

const MIC_MIN_MIDI = 36; // C2
const MIC_MAX_MIDI = 96; // C7
const HARMONIC_WEIGHTS = [0, 1, 0.8, 0.65, 0.5, 0.4, 0.3];
const SENSITIVITY = { low: 7, normal: 4.5, high: 3 };

const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- pure analysis helpers (exported for testing) ----
// mag: current spectrum. pre (optional): spectrum from just before the onset.
// With `pre`, every peak height becomes "how much it grew", so notes that were already
// ringing contribute almost nothing and only newly struck notes stand out.
function makeSpectrum(mag, binHz, pre) {
  const N = mag.length;
  // Height of a spectral peak at frequency f, or 0 if there is no peak close enough to f.
  // tolCents grows for higher partials because piano strings are slightly inharmonic.
  const pk = (f, tolCents = 45) => {
    const i = Math.round(f / binHz);
    if (i < 2 || i >= N - 2) return 0;
    let j = i;
    if (mag[i - 1] > mag[j]) j = i - 1;
    if (mag[i + 1] > mag[j]) j = i + 1;
    if (mag[j] < mag[j - 1] || mag[j] < mag[j + 1]) return 0; // not a local peak
    const a = Math.log(mag[j - 1] + 1e-12), b = Math.log(mag[j] + 1e-12), c = Math.log(mag[j + 1] + 1e-12);
    const den = a - 2 * b + c;
    const delta = den < 0 ? (0.5 * (a - c)) / den : 0;
    const pf = (j + delta) * binHz;
    const tol = Math.max(tolCents, 1200 * Math.log2(1 + (0.5 * binHz) / f));
    if (Math.abs(1200 * Math.log2(pf / f)) > tol) return 0;
    if (!pre) return mag[j];
    const before = Math.max(pre[j - 1], pre[j], pre[j + 1]);
    return Math.max(0, mag[j] - 0.85 * before);
  };
  const B = 0.0004; // typical string inharmonicity
  const partial = (f, h) => pk(h * f * Math.sqrt(1 + B * h * h), 45 + 15 * (h - 1));
  const sal = (m) => {
    const f = midiFreq(m);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += HARMONIC_WEIGHTS[h] * partial(f, h);
    return s;
  };
  return { pk, partial, sal };
}

function spectrumFloor(mag, binHz) {
  const lo = Math.max(1, Math.floor(60 / binHz));
  const hi = Math.min(mag.length - 1, Math.ceil(4000 / binHz));
  const arr = Array.prototype.slice.call(mag, lo, hi).sort((a, b) => a - b);
  return arr[Math.floor(arr.length * 0.6)] || 1e-9;
}

// Is note m really sounding (not just an overtone of a different note)?
// `allowed` = notes that are expected together (a chord), whose overtones may legitimately overlap.
function plausibleNote(spec, m, floor, k, allowed) {
  const f = midiFreq(m);
  const a1 = spec.partial(f, 1), a2 = spec.partial(f, 2), a3 = spec.partial(f, 3), a4 = spec.partial(f, 4);
  const odd = Math.max(a1, a3);
  const even = Math.max(a2, a4);
  // Phone mics barely pick up low frequencies, so bass notes may show mostly upper partials.
  const lowNeed = f < 200 ? 0.5 : 1;
  if (Math.max(a1, a2) < floor * k * lowNeed) return false; // nothing at the low harmonics
  if (odd < floor * k * 0.6) return false;
  if (odd < 0.12 * even && !allowed.has(m + 12) && !allowed.has(m + 24)) return false; // it's really the octave above
  const main = Math.max(a1, a2);
  // Evidence that the octave below (m-12) is what's playing: peaks at f/2 or 1.5f.
  if (!allowed.has(m - 12)) {
    const lower = Math.max(spec.pk(0.5 * f), allowed.has(m + 7) ? 0 : spec.pk(1.5 * f));
    if (lower > 0.45 * main) return false;
  }
  // Evidence that m is the 3rd harmonic of m-19.
  if (!allowed.has(m - 19)) {
    const lower = Math.max(spec.pk(f / 3), allowed.has(m - 7) ? 0 : spec.pk((2 / 3) * f));
    if (lower > 0.45 * main) return false;
  }
  return true;
}

/**
 * Decide which notes were played.
 * @param mag      linear magnitude spectrum ~70 ms after the onset
 * @param pre      linear magnitude spectrum just before the onset
 * @param expected Set of MIDI notes the song expects now
 * @param ignored  Set of MIDI notes to ignore (e.g. notes the app itself is playing)
 */
function detectNotes(mag, pre, binHz, expected, ignored, k) {
  const spec = makeSpectrum(mag, binHz, pre);
  const floor = spectrumFloor(mag, binHz);
  let best = null, bestSal = 0, maxSal = 0;
  const empty = new Set();
  for (let m = MIC_MIN_MIDI; m <= MIC_MAX_MIDI; m++) {
    if (ignored.has(m)) continue;
    const s = spec.sal(m);
    if (s > maxSal) maxSal = s;
    if (s > bestSal && plausibleNote(spec, m, floor, k, empty)) { best = m; bestSal = s; }
  }
  const hits = [];
  for (const m of expected) {
    if (ignored.has(m)) continue;
    if (plausibleNote(spec, m, floor, k, expected) && spec.sal(m) >= 0.3 * maxSal) hits.push(m);
  }
  if (hits.length) return hits;
  // An overtone of an expected note is more likely a re-strike we couldn't confirm than a
  // wrong key, so stay quiet instead of punishing the player.
  const OVERTONES = [12, 19, 24, 28, 31];
  if (best !== null && [...expected].some((m) => OVERTONES.includes(best - m))) return [];
  if (best !== null && bestSal > floor * k * 2.5) return [best];
  return [];
}

class MicListener {
  constructor({ onNotes, onLevel, getExpected, getIgnored }) {
    this.onNotes = onNotes;
    this.onLevel = onLevel || (() => {});
    this.getExpected = getExpected || (() => new Set());
    this.getIgnored = getIgnored || (() => new Set());
    this.sensitivity = 'normal';
    this.running = false;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start(ctx) {
    if (this.running) return;
    if (!MicListener.supported()) throw new Error('This browser cannot use the microphone.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.source = ctx.createMediaStreamSource(this.stream);
    this.fast = ctx.createAnalyser();
    this.fast.fftSize = 2048;
    this.fast.smoothingTimeConstant = 0;
    this.slow = ctx.createAnalyser();
    this.slow.fftSize = 8192;
    this.slow.smoothingTimeConstant = 0;
    this.source.connect(this.fast);
    this.source.connect(this.slow);

    this.fastDb = new Float32Array(this.fast.frequencyBinCount);
    this.prevFastDb = new Float32Array(this.fast.frequencyBinCount).fill(-120);
    this.slowDb = new Float32Array(this.slow.frequencyBinCount);
    this.preOnset = new Float32Array(this.slow.frequencyBinCount);
    this.lastSlow = new Float32Array(this.slow.frequencyBinCount);
    this.timeBuf = new Float32Array(this.fast.fftSize);
    this.fluxHist = [];
    this.noise = 0.002;
    this.lastOnset = 0;
    this.pending = null;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 12);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    if (this.source) this.source.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onLevel(0);
  }

  tick() {
    const now = performance.now();
    // Level (RMS) with a slowly adapting noise floor
    this.fast.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);
    this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.999 + rms * 0.001;
    this.onLevel(Math.min(1, rms * 6));

    // Remember the precise spectrum so we have a "before" picture when an onset happens.
    this.slow.getFloatFrequencyData(this.slowDb);
    const before = this.lastSlow;
    this.lastSlow = this.slowDb;
    this.slowDb = before;

    // Spectral flux on the log spectrum (fast FFT)
    this.fast.getFloatFrequencyData(this.fastDb);
    const binHz = this.ctx.sampleRate / this.fast.fftSize;
    const hi = Math.min(this.fastDb.length, Math.ceil(5000 / binHz));
    let flux = 0;
    for (let i = 2; i < hi; i++) {
      const a = Math.max(this.fastDb[i], -100), b = Math.max(this.prevFastDb[i], -100);
      if (a > b) flux += a - b;
    }
    const tmp = this.prevFastDb;
    this.prevFastDb = this.fastDb;
    this.fastDb = tmp;
    flux /= hi;

    const hist = this.fluxHist;
    const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : flux;
    hist.push(flux);
    if (hist.length > 25) hist.shift();

    const loudEnough = rms > Math.max(0.004, this.noise * 2.5);
    const k = SENSITIVITY[this.sensitivity] || SENSITIVITY.normal;
    if (!this.pending && loudEnough && flux > Math.max(1.2, mean * 1.9) && now - this.lastOnset > 70) {
      this.lastOnset = now;
      this.preOnset.set(before);
      this.pending = { at: now, k };
    }

    if (this.pending && now - this.pending.at >= 70) {
      const { at, k: kk } = this.pending;
      this.pending = null;
      this.slow.getFloatFrequencyData(this.slowDb);
      const n = this.slowDb.length;
      const cur = new Float32Array(n);
      const pre = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        cur[i] = Math.pow(10, this.slowDb[i] / 20);
        pre[i] = Math.pow(10, this.preOnset[i] / 20);
      }
      const notes = detectNotes(cur, pre, this.ctx.sampleRate / this.slow.fftSize, this.getExpected(), this.getIgnored(), kk);
      if (notes.length) this.onNotes(notes, (performance.now() - at) / 1000 + 0.04);
    }
  }
}

if (typeof module !== 'undefined') module.exports = { detectNotes, plausibleNote, makeSpectrum, spectrumFloor, midiFreq, MicListener };
