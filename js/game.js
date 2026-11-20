// Falling-notes game engine: timing, scoring and canvas rendering.

const HAND_COLORS = {
  rh: { fill: '#4cc9f0', glow: 'rgba(76,201,240,0.55)', dim: 'rgba(76,201,240,0.35)' },
  lh: { fill: '#f72585', glow: 'rgba(247,37,133,0.55)', dim: 'rgba(247,37,133,0.35)' },
};
const WRONG_COLOR = '#ff5c5c';
const LEAD_IN = 2.5; // seconds of song time before the first note
const VIEW_REAL_SECONDS = 2.6; // how long a note takes to fall across the screen (real time)
const PLAY_WINDOW = 0.2; // seconds (real time) on each side of a note that count as a hit
const PERFECT_WINDOW = 0.07;

class Game {
  constructor(canvas, song, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.song = song;
    this.mode = opts.mode; // 'learn' | 'play'
    this.hands = opts.hands; // { rh: 'you'|'auto'|'off', lh: ... }
    this.speed = opts.speed || 1;
    this.showNames = opts.showNames !== false;
    this.synth = opts.synth;
    this.cb = opts.callbacks || {};

    this.guitar = opts.instrument === 'guitar';
    let notes = song.notes
      .filter((n) => this.hands[n.hand] !== 'off')
      .map((n) => ({ ...n, user: this.hands[n.hand] === 'you', state: 'pending', autoOn: false }));
    if (this.guitar) notes = this.prepareGuitar(notes);
    notes.forEach((n, i) => (n.id = i));
    this.notes = notes;
    this.userTotal = this.notes.filter((n) => n.user).length;

    this.computeRange();
    this.pressed = new Map(); // midi -> {color}
    this.autoKeys = new Map(); // midi -> hand
    this.effects = [];
    this.loop = { a: null, b: null };
    this.running = false;
    this.paused = false;
    this.finished = false;
    this.resetStats();
    this.t = -LEAD_IN;
    this.inputLatency = opts.inputLatency || 0; // extra grace for delayed inputs (microphone)

    this._frame = this.frame.bind(this);
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  // Fit every note into guitar range, drop duplicates, and work out strings/frets and chord groups.
  prepareGuitar(notes) {
    // Same octave shift for the whole song so the melody keeps its shape, then fit any stragglers.
    const shift = chooseOctaveShift(notes.filter((n) => n.user && n.string === undefined).map((n) => n.midi));
    for (const n of notes) if (n.string === undefined) n.midi = fitToGuitar(n.midi + shift);
    const seen = new Set();
    notes = notes.filter((n) => {
      const key = `${n.user}|${n.midi}|${Math.round(n.start * 30)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    assignGuitarPositions(notes.filter((n) => n.user));
    assignGuitarPositions(notes.filter((n) => !n.user));
    this.groups = [];
    let last = -1;
    for (const n of notes) {
      if (!n.user) continue;
      if (last < 0 || n.start - this.groups[last][0].start >= 0.03) { this.groups.push([]); last++; }
      this.groups[last].push(n);
      n.group = last;
    }
    this.fretBase = 1;
    return notes;
  }

  resetStats() {
    this.stats = { perfect: 0, good: 0, missed: 0, wrong: 0, combo: 0, maxCombo: 0 };
  }

  computeRange() {
    const src = this.song.notes.length ? this.song.notes : [{ midi: 60 }];
    let lo = src.reduce((m, n) => Math.min(m, n.midi), 127);
    let hi = src.reduce((m, n) => Math.max(m, n.midi), 0);
    lo = Math.floor((lo - 2) / 12) * 12; // down to a C
    hi = Math.ceil((hi + 2) / 12) * 12; // up to a C
    while (hi - lo < 24) { lo -= 6; hi += 6; lo = Math.floor(lo / 12) * 12; hi = Math.ceil(hi / 12) * 12; }
    this.lo = Math.max(21, lo);
    this.hi = Math.min(108, hi);
    if (isBlackKey(this.lo)) this.lo--;
    if (isBlackKey(this.hi)) this.hi++;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!isBlackKey(m)) whites.push(m);
    const ww = this.W / whites.length;
    this.whiteW = ww;
    this.kbH = Math.min(this.H * 0.3, ww * 5.2);
    this.hitY = this.H - this.kbH;
    const bw = ww * 0.6;
    this.keys = new Map();
    whites.forEach((m, i) => this.keys.set(m, { x: i * ww, w: ww, black: false }));
    for (let m = this.lo; m <= this.hi; m++) {
      if (!isBlackKey(m)) continue;
      const left = this.keys.get(m - 1);
      if (left) this.keys.set(m, { x: left.x + ww - bw / 2, w: bw, black: true });
    }
    if (this.guitar) {
      this.laneW = Math.min(this.W / 6.4, 120);
      this.x0 = (this.W - this.laneW * 6) / 2;
      this.diagH = Math.min(this.H * 0.36, 280);
      this.hitY = this.H - this.diagH;
      this.openH = Math.max(18, this.diagH * 0.12);
      this.rowH = (this.diagH - this.openH - 4) / 5;
      this.whiteW = this.laneW * 0.6;
    }
    if (!this.running) this.draw();
  }

  // ---------- lifecycle ----------
  start() {
    this.running = true;
    this.paused = false;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.stopAuto();
    else this.last = performance.now();
  }

  destroy() {
    this.running = false;
    this.stopAuto();
    window.removeEventListener('resize', this._resize);
  }

  setSpeed(s) {
    this.speed = Math.max(0.25, Math.min(2, Math.round(s * 100) / 100));
    return this.speed;
  }

  seek(t) {
    this.t = Math.max(-LEAD_IN, Math.min(t, this.song.duration));
    this.stopAuto();
    for (const n of this.notes) {
      if (n.start >= this.t - 0.001) n.state = 'pending';
      else if (n.state === 'pending') n.state = n.user ? 'skipped' : 'done';
      n.autoOn = false;
    }
    this.finished = false;
  }

  restart() {
    this.resetStats();
    this.seek(-LEAD_IN);
    this.effects = [];
  }

  toggleLoopPoint() {
    const L = this.loop;
    if (L.a === null) L.a = Math.max(0, this.t);
    else if (L.b === null) {
      if (this.t > L.a + 0.5) L.b = this.t;
      else { L.a = null; }
      if (L.b !== null) this.seek(L.a - 1);
    } else { L.a = L.b = null; }
    return L;
  }

  // ---------- input ----------
  // Notes the player should be pressing right now (used to guide microphone detection).
  expectedNotes() {
    const out = new Set();
    const back = this.mode === 'learn' ? Infinity : (PLAY_WINDOW + 0.25) * this.speed;
    const ahead = (this.mode === 'learn' ? 0.3 : PLAY_WINDOW + 0.1) * this.speed;
    for (const n of this.notes) {
      if (n.start > this.t + ahead) break;
      if (n.user && n.state === 'pending' && n.start >= this.t - back) out.add(n.midi);
    }
    return out;
  }

  // latency: how many seconds ago the note was actually played (microphone input is delayed).
  // chordOk: the input heard the chord as a whole, so a mostly-played chord may be fully credited.
  noteOn(midi, latency = 0, chordOk = true) {
    let target = null;
    const windowS = PLAY_WINDOW * this.speed;
    const tNow = this.t - (this.mode === 'play' ? latency * this.speed : 0);
    for (const n of this.notes) {
      if (!n.user || n.state !== 'pending' || n.midi !== midi) continue;
      const early = n.start - tNow;
      const ok = this.mode === 'learn' ? early <= 0.3 * this.speed : Math.abs(early) <= windowS;
      if (ok) { target = n; break; }
      if (n.start > this.t + 1) break;
    }
    const k = this.keys.get(midi);
    if (!target && latency > 0 && this.echoOfRecentHit(midi)) return;
    if (target) {
      target.state = 'hit';
      target.hitAt = performance.now();
      const perfect = this.mode === 'learn' || Math.abs(target.start - tNow) <= PERFECT_WINDOW * this.speed;
      if (perfect) this.stats.perfect++; else this.stats.good++;
      this.stats.combo++;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
      const color = this.guitar ? STRING_COLORS[target.string] : HAND_COLORS[target.hand].fill;
      this.pressed.set(midi, { color });
      const label = this.mode === 'play' ? (perfect ? 'Perfect' : 'Good') : '';
      if (this.guitar) {
        this.effects.push({ x: this.x0 + (target.string + 0.5) * this.laneW, color, t0: performance.now(), label });
        if (chordOk) this.chordAssist(target, perfect);
      } else if (k) {
        this.effects.push({ x: k.x + k.w / 2, color, t0: performance.now(), label });
      }
    } else {
      this.stats.wrong++;
      this.stats.combo = 0;
      this.pressed.set(midi, { color: WRONG_COLOR });
      if (this.guitar) this.heard = { text: `Heard ${midiToName(midi)}`, t0: performance.now() };
    }
    this.emitStats();
  }

  // Microphone only: a note that is just a still-ringing string or overtone of something
  // played correctly a moment ago is not a mistake.
  echoOfRecentHit(midi) {
    const now = performance.now();
    return this.notes.some((n) => {
      if (n.state !== 'hit' || !n.hitAt || now - n.hitAt > 700) return false;
      const ratio = Math.pow(2, (midi - n.midi) / 12);
      const h = Math.round(ratio);
      return h >= 1 && h <= 8 && Math.abs(1200 * Math.log2(ratio / h)) < 40;
    });
  }

  // Strummed chords: once most of the strings are heard, count the whole chord.
  chordAssist(target, perfect) {
    const grp = this.groups[target.group];
    if (!grp || grp.length < 3) return;
    const hits = grp.filter((n) => n.state === 'hit').length;
    if (hits / grp.length < 0.6) return;
    for (const n of grp) {
      if (n.state !== 'pending') continue;
      n.state = 'hit';
      n.hitAt = performance.now();
      if (perfect) this.stats.perfect++; else this.stats.good++;
      this.stats.combo++;
    }
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
  }

  noteOff(midi) {
    this.pressed.delete(midi);
  }

  emitStats() {
    if (this.cb.onStats) this.cb.onStats(this.stats, this.score());
  }

  score() {
    if (!this.userTotal) return null;
    const s = this.stats;
    if (this.mode === 'learn') {
      const hits = s.perfect + s.good;
      return hits + s.wrong === 0 ? 100 : Math.round((100 * hits) / (hits + s.wrong));
    }
    return Math.round((100 * (s.perfect + 0.8 * s.good)) / (this.userTotal + 0.5 * s.wrong));
  }

  // ---------- timing ----------
  stopAuto() {
    for (const n of this.notes) {
      if (n.autoOn) { this.synth.noteOff('a' + n.id); n.autoOn = false; }
    }
    this.autoKeys.clear();
  }

  waitingNotes() {
    const out = [];
    for (const n of this.notes) {
      if (n.start > this.t + 0.0001) break;
      if (n.user && n.state === 'pending') out.push(n);
    }
    return out;
  }

  update(dt) {
    let next = this.t + dt * this.speed;

    if (this.mode === 'learn') {
      // Freeze time at the first unplayed note until it is played.
      for (const n of this.notes) {
        if (n.start > next) break;
        if (n.user && n.state === 'pending') { next = Math.max(this.t, n.start); break; }
      }
    }
    this.t = next;

    const windowS = PLAY_WINDOW * this.speed;
    for (const n of this.notes) {
      if (n.start > this.t) break;
      if (n.user) {
        if (this.mode === 'play' && n.state === 'pending' && this.t > n.start + windowS + this.inputLatency * this.speed) {
          n.state = 'missed';
          this.stats.missed++;
          this.stats.combo = 0;
          this.emitStats();
        }
      } else if (n.state === 'pending') {
        n.state = 'playing';
        n.autoOn = true;
        this.synth.noteOn(n.midi, 0.65, 'a' + n.id);
        this.autoKeys.set(n.midi, n.hand);
      }
      if (n.autoOn && this.t >= n.start + n.dur) {
        n.autoOn = false;
        n.state = 'done';
        this.synth.noteOff('a' + n.id);
        if (this.autoKeys.get(n.midi) === n.hand) this.autoKeys.delete(n.midi);
      }
    }

    // Loop handling
    if (this.loop.a !== null && this.loop.b !== null && this.t >= this.loop.b) {
      this.seek(this.loop.a - 0.6 * this.speed);
    }

    if (this.t >= this.song.duration + 0.6 && !this.finished) {
      this.finished = true;
      this.stopAuto();
      if (this.cb.onFinish) this.cb.onFinish(this.stats, this.score());
    }
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused && !this.finished) this.update(dt);
    this.draw();
    if (this.cb.onProgress) this.cb.onProgress(Math.max(0, this.t) / this.song.duration, this.t);
    requestAnimationFrame(this._frame);
  }

  // ---------- rendering ----------
  draw() {
    if (this.guitar) return this.drawGuitar();
    const { ctx, W, H, hitY } = this;
    if (!this.keys) return;
    ctx.clearRect(0, 0, W, H);

    // Lane background
    const bg = ctx.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, '#0b0d1a');
    bg.addColorStop(1, '#141833');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, hitY);
    for (let m = this.lo; m <= this.hi; m++) {
      const k = this.keys.get(m);
      if (!k) continue;
      if (k.black) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(k.x, 0, k.w, hitY);
      }
      if (m % 12 === 0 || m % 12 === 5) {
        ctx.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(Math.round(k.x), 0, 1, hitY);
      }
    }

    // Loop region
    const view = VIEW_REAL_SECONDS * this.speed;
    const yOf = (time) => hitY - ((time - this.t) / view) * hitY;
    if (this.loop.a !== null) {
      const ya = yOf(this.loop.a);
      const yb = this.loop.b !== null ? yOf(this.loop.b) : -10;
      ctx.fillStyle = 'rgba(255,214,10,0.06)';
      ctx.fillRect(0, Math.max(0, yb), W, Math.min(hitY, ya) - Math.max(0, yb));
      ctx.fillStyle = 'rgba(255,214,10,0.7)';
      if (ya >= 0 && ya <= hitY) ctx.fillRect(0, ya, W, 2);
      if (this.loop.b !== null && yb >= 0 && yb <= hitY) ctx.fillRect(0, yb, W, 2);
    }

    // Notes
    const waiting = new Set(this.mode === 'learn' ? this.waitingNotes().map((n) => n.id) : []);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of this.notes) {
      if (n.start > this.t + view) break;
      if (n.start + n.dur < this.t - 0.5) continue;
      const k = this.keys.get(n.midi);
      if (!k) continue;
      const yBottom = yOf(n.start);
      const yTop = yOf(n.start + n.dur);
      const h = Math.max(8, yBottom - yTop);
      const pad = k.black ? 1 : 2;
      const x = k.x + pad, w = k.w - pad * 2;
      const col = HAND_COLORS[n.hand];
      let fill = col.fill, alpha = 1;
      if (!n.user) alpha = 0.45;
      if (n.state === 'hit') alpha = 0.35;
      if (n.state === 'missed' || n.state === 'skipped') fill = '#555b78';
      ctx.globalAlpha = alpha;
      if (waiting.has(n.id)) {
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 12 + 14 * pulse;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, x, yBottom - h, w, h, Math.min(6, w / 3));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (this.showNames && w >= 14 && h >= 16 && n.state !== 'hit') {
        ctx.fillStyle = 'rgba(10,12,30,0.85)';
        ctx.font = `600 ${Math.min(13, w * 0.5)}px system-ui, sans-serif`;
        ctx.fillText(midiToName(n.midi, false), x + w / 2, yBottom - Math.min(h / 2, 10));
      }
    }

    // Hit line
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0, '#f72585');
    lineGrad.addColorStop(1, '#4cc9f0');
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, hitY - 3, W, 3);

    // Hit effects
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.t0 < 500);
    for (const e of this.effects) {
      const p = (now - e.t0) / 500;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, hitY - 2, 6 + p * this.whiteW * 1.2, 0, Math.PI * 2);
      ctx.fill();
      if (e.label) {
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.fillText(e.label, e.x, hitY - 24 - p * 30);
      }
      ctx.globalAlpha = 1;
    }

    this.drawKeyboard(waiting);
  }

  drawKeyboard(waiting) {
    const { ctx, hitY, kbH } = this;
    const hint = new Map();
    if (waiting.size) for (const n of this.notes) if (waiting.has(n.id)) hint.set(n.midi, n.hand);

    const keyColor = (m) => {
      if (this.pressed.has(m)) return this.pressed.get(m).color;
      if (this.autoKeys.has(m)) return HAND_COLORS[this.autoKeys.get(m)].fill;
      return null;
    };

    for (const pass of [false, true]) {
      for (let m = this.lo; m <= this.hi; m++) {
        const k = this.keys.get(m);
        if (!k || k.black !== pass) continue;
        const h = k.black ? kbH * 0.62 : kbH;
        const c = keyColor(m);
        if (!k.black) {
          ctx.fillStyle = c || '#f4f4f8';
          roundRect(ctx, k.x + 0.5, hitY, k.w - 1, h, [0, 0, 5, 5]);
          ctx.fill();
          if (!c) {
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            ctx.fillRect(k.x + 0.5, hitY, k.w - 1, 6);
          }
        } else {
          ctx.fillStyle = c || '#1b1d2b';
          roundRect(ctx, k.x, hitY, k.w, h, [0, 0, 4, 4]);
          ctx.fill();
          if (!c) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(k.x + 2, hitY + h - 8, k.w - 4, 3);
          }
        }
        if (hint.has(m) && !c) {
          const col = HAND_COLORS[hint.get(m)].fill;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(k.x + k.w / 2, hitY + h - Math.min(14, k.w * 0.45), Math.min(6, k.w * 0.25), 0, Math.PI * 2);
          ctx.fill();
        }
        if (!k.black && m % 12 === 0 && k.w > 16) {
          ctx.fillStyle = '#9a9cb0';
          ctx.font = `500 ${Math.min(11, k.w * 0.4)}px system-ui, sans-serif`;
          ctx.fillText(midiToName(m), k.x + k.w / 2, hitY + kbH - 10);
        }
      }
    }
  }

  // ---------- guitar rendering ----------
  drawGuitar() {
    const { ctx, W, H, hitY, laneW, x0 } = this;
    if (!laneW) return;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, '#0b0d1a');
    bg.addColorStop(1, '#141833');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, hitY);

    // Lanes with a string down the middle of each
    for (let s = 0; s < 6; s++) {
      const x = x0 + s * laneW;
      ctx.fillStyle = s % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, laneW, hitY);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + laneW / 2 - (1 + (5 - s) * 0.3) / 2, 0, 1 + (5 - s) * 0.3, hitY);
    }

    const view = VIEW_REAL_SECONDS * this.speed;
    const yOf = (time) => hitY - ((time - this.t) / view) * hitY;
    if (this.loop.a !== null) {
      const ya = yOf(this.loop.a);
      const yb = this.loop.b !== null ? yOf(this.loop.b) : -10;
      ctx.fillStyle = 'rgba(255,214,10,0.06)';
      ctx.fillRect(0, Math.max(0, yb), W, Math.min(hitY, ya) - Math.max(0, yb));
    }

    // Note gems: colour = string, number = fret
    const waiting = new Set(this.mode === 'learn' ? this.waitingNotes().map((n) => n.id) : []);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    const gemH = Math.min(34, laneW * 0.55);
    const gemW = laneW * 0.72;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of this.notes) {
      if (n.start > this.t + view) break;
      if (!n.user || n.start + n.dur < this.t - 0.5) continue;
      const cx = x0 + (n.string + 0.5) * laneW;
      const yBottom = yOf(n.start);
      const tail = Math.max(0, yBottom - yOf(n.start + n.dur) - gemH);
      const col = n.state === 'missed' || n.state === 'skipped' ? '#555b78' : STRING_COLORS[n.string];
      ctx.globalAlpha = n.state === 'hit' ? 0.25 : 1;
      if (tail > 4) {
        ctx.fillStyle = col;
        ctx.globalAlpha *= 0.35;
        ctx.fillRect(cx - 3, yBottom - gemH - tail, 6, tail);
        ctx.globalAlpha = n.state === 'hit' ? 0.25 : 1;
      }
      if (waiting.has(n.id)) { ctx.shadowColor = col; ctx.shadowBlur = 12 + 14 * pulse; }
      ctx.fillStyle = col;
      roundRect(ctx, cx - gemW / 2, yBottom - gemH, gemW, gemH, gemH / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0d1a';
      ctx.font = `800 ${Math.round(gemH * 0.6)}px system-ui, sans-serif`;
      ctx.fillText(String(n.fret), cx, yBottom - gemH / 2 + 1);
      ctx.globalAlpha = 1;
    }

    const lineGrad = ctx.createLinearGradient(x0, 0, x0 + 6 * laneW, 0);
    STRING_COLORS.forEach((c, i) => lineGrad.addColorStop(i / 5, c));
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, hitY - 3, W, 3);

    this.drawFretboard(waiting);

    // Hit effects
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.t0 < 500);
    for (const e of this.effects) {
      const p = (now - e.t0) / 500;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, hitY - 2, 6 + p * laneW * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (e.label) { ctx.font = '700 14px system-ui, sans-serif'; ctx.fillText(e.label, e.x, hitY - 24 - p * 30); }
      ctx.globalAlpha = 1;
    }
    if (this.heard && now - this.heard.t0 < 900) {
      ctx.globalAlpha = 1 - (now - this.heard.t0) / 900;
      ctx.fillStyle = WRONG_COLOR;
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText(this.heard.text, W / 2, hitY - 40);
      ctx.globalAlpha = 1;
    }
  }

  // Chord-diagram style fretboard under the highway: strings vertical, frets horizontal.
  drawFretboard(waiting) {
    const { ctx, H, hitY, laneW, x0, openH, rowH } = this;
    const nutY = hitY + openH;
    const soon = this.notes.filter(
      (n) => n.user && n.state === 'pending' && (waiting.has(n.id) || (n.start <= this.t + 0.8 * this.speed && n.start >= this.t - PLAY_WINDOW * this.speed))
    );

    // Pick which 5 frets to show (stay put while the notes still fit).
    const fretted = soon.map((n) => n.fret).filter((f) => f > 0);
    if (fretted.length) {
      const lo = Math.min(...fretted), hi = Math.max(...fretted);
      if (lo < this.fretBase || hi > this.fretBase + 4) this.fretBase = hi <= 5 ? 1 : lo;
    }
    const base = this.fretBase;

    const left = x0 - 8, width = laneW * 6 + 16;
    const wood = ctx.createLinearGradient(0, hitY, 0, H);
    wood.addColorStop(0, '#3a2718');
    wood.addColorStop(1, '#22160d');
    ctx.fillStyle = '#0b0d1a';
    ctx.fillRect(0, hitY, this.W, H - hitY);
    ctx.fillStyle = wood;
    ctx.fillRect(left, nutY, width, H - nutY);

    // Frets, nut and inlays
    ctx.fillStyle = base === 1 ? '#efe6d2' : '#9a8f7e';
    ctx.fillRect(left, nutY - (base === 1 ? 4 : 1), width, base === 1 ? 5 : 2);
    for (let r = 1; r <= 5; r++) {
      ctx.fillStyle = '#b8bcc8';
      ctx.fillRect(left, nutY + r * rowH - 1, width, 2);
      const f = base + r - 1;
      const iy = nutY + (r - 0.5) * rowH;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      if ([3, 5, 7, 9].includes(f)) { ctx.beginPath(); ctx.arc(x0 + 3 * laneW, iy, 5, 0, Math.PI * 2); ctx.fill(); }
      if (f === 12) {
        [2, 4].forEach((sx) => { ctx.beginPath(); ctx.arc(x0 + sx * laneW, iy, 5, 0, Math.PI * 2); ctx.fill(); });
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e2d4';
    ctx.font = '700 12px system-ui, sans-serif';
    if (base > 1) ctx.fillText(`${base}fr`, left + 4, nutY + rowH / 2);
    ctx.textAlign = 'center';

    // Strings
    for (let s = 0; s < 6; s++) {
      const cx = x0 + (s + 0.5) * laneW;
      const lit = this.pressed.size && [...this.pressed.values()].some((p) => p.color === STRING_COLORS[s]);
      ctx.fillStyle = lit ? STRING_COLORS[s] : '#d9d4c7';
      const w = 1 + (5 - s) * 0.45;
      ctx.fillRect(cx - w / 2, nutY, w, H - nutY);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(STRING_NAMES[s], cx, hitY + openH / 2);
    }

    // Finger positions for the next notes
    const r = Math.min(laneW * 0.32, rowH * 0.4);
    for (const n of soon) {
      const cx = x0 + (n.string + 0.5) * laneW;
      const now = waiting.has(n.id) || Math.abs(n.start - this.t) < 0.2 * this.speed;
      ctx.globalAlpha = now ? 1 : 0.4;
      const col = STRING_COLORS[n.string];
      if (n.fret === 0) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, hitY + openH / 2, Math.min(openH * 0.38, r), 0, Math.PI * 2);
        ctx.stroke();
      } else if (n.fret >= base && n.fret <= base + 4) {
        const cy = nutY + (n.fret - base + 0.5) * rowH;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0b0d1a';
        ctx.font = `800 ${Math.round(r)}px system-ui, sans-serif`;
        ctx.fillText(String(n.fret), cx, cy + 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Hit-test a point on the canvas keyboard -> midi or null
  keyAt(x, y) {
    if (this.guitar) {
      if (y < this.hitY) return null;
      const s = Math.floor((x - this.x0) / this.laneW);
      if (s < 0 || s > 5) return null;
      const nutY = this.hitY + this.openH;
      const fret = y < nutY ? 0 : this.fretBase + Math.min(4, Math.floor((y - nutY) / this.rowH));
      return GUITAR_TUNING[s] + fret;
    }
    if (y < this.hitY) return null;
    for (let m = this.lo; m <= this.hi; m++) {
      const k = this.keys.get(m);
      if (k && k.black && y <= this.hitY + this.kbH * 0.62 && x >= k.x && x <= k.x + k.w) return m;
    }
    for (let m = this.lo; m <= this.hi; m++) {
      const k = this.keys.get(m);
      if (k && !k.black && x >= k.x && x < k.x + k.w) return m;
    }
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
