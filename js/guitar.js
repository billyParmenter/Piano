// Guitar support: tuning, chord shapes, automatic tab (string/fret) placement, tuner pitch detection.

const GUITAR_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (low → high)
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
const STRING_COLORS = ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#4cc9f0', '#b388ff'];
const GUITAR_MAX_FRET = 12;
const GUITAR_LOW = GUITAR_TUNING[0];
const GUITAR_HIGH = GUITAR_TUNING[5] + GUITAR_MAX_FRET;

// Chord shapes, low E → high e. "x" = string not played.
const CHORD_SHAPES = {
  G: '320003', C: 'x32010', D: 'xx0232', Em: '022000', Am: 'x02210', E: '022100',
  A: 'x02220', Dm: 'xx0231', Fmaj7: 'xx3210', E7: '020100', A7: 'x02020', D7: 'xx0212',
  G7: '320001', C7: 'x32310', Cadd9: 'x32033', Asus2: 'x02200', Dsus4: 'xx0233', B7: 'x21202',
};

function chordNotes(name) {
  const shape = CHORD_SHAPES[name];
  if (!shape) throw new Error(`Unknown chord "${name}"`);
  const out = [];
  [...shape].forEach((c, s) => {
    if (c === 'x') return;
    const fret = parseInt(c, 10);
    out.push({ string: s, fret, midi: GUITAR_TUNING[s] + fret });
  });
  return out;
}

// Shift a pitch by octaves until a guitar can play it.
function fitToGuitar(midi) {
  while (midi < GUITAR_LOW) midi += 12;
  while (midi > GUITAR_HIGH) midi -= 12;
  return midi;
}

function positionsFor(midi) {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const fret = midi - GUITAR_TUNING[s];
    if (fret >= 0 && fret <= GUITAR_MAX_FRET) out.push({ string: s, fret });
  }
  return out;
}

// Pick one octave shift for a whole part so the melody sits in a comfortable guitar range.
function chooseOctaveShift(midis) {
  let best = 0, bestCost = Infinity;
  for (const k of [-24, -12, 0, 12]) {
    let cost = Math.abs(k) * 0.01;
    for (const m0 of midis) {
      const m = m0 + k;
      if (m < GUITAR_LOW || m > GUITAR_HIGH) cost += 10;
      else if (m > 69) cost += (m - 69) * 0.4; // high up the neck
    }
    if (cost < bestCost) { bestCost = cost; best = k; }
  }
  return best;
}

/**
 * Give every note a string and fret like a guitarist would: the fretting hand sits in a
 * 4-fret position (index finger at fret h covers h..h+3, open strings are free) and moves
 * as rarely as possible. Solved with dynamic programming over hand positions.
 * Notes that already have string/fret (from chord shapes) are kept as written.
 * Mutates the notes (expects them sorted by start).
 */
const HAND_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function bestInWindow(free, fixed, h) {
  const used = new Set(fixed.map((n) => n.string));
  const ok = (f) => f === 0 || (f >= h && f <= h + 3);
  if (!fixed.every((n) => ok(n.fret))) return null;
  let best = null, bestCost = Infinity;
  const pick = new Array(free.length);
  const search = (k, cost) => {
    if (cost >= bestCost) return;
    if (k === free.length) { bestCost = cost; best = pick.slice(); return; }
    for (const p of positionsFor(free[k].midi)) {
      if (used.has(p.string) || !ok(p.fret)) continue;
      used.add(p.string);
      pick[k] = p;
      search(k + 1, cost + (p.fret === 0 ? 0 : 0.05 + p.fret * 0.01));
      used.delete(p.string);
    }
  };
  search(0, 0);
  return best ? { pick: best, cost: bestCost } : null;
}

function assignGuitarPositions(notes) {
  const groups = [];
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && notes[j].start - notes[i].start < 0.03) j++;
    groups.push(notes.slice(i, j));
    i = j;
  }
  if (!groups.length) return notes;

  // local[g][h] = { cost, pick } for hand position h, or null if impossible there
  const local = groups.map((group) => {
    const fixed = group.filter((n) => n.string !== undefined);
    const free = group.filter((n) => n.string === undefined).slice(0, 6);
    const row = HAND_POSITIONS.map((h) => {
      const r = bestInWindow(free, fixed, h);
      return r && { cost: r.cost + h * 0.03, pick: r.pick };
    });
    if (row.every((r) => !r)) {
      // Too wide for any one position: lowest fret for each note, no position constraint.
      const pick = free.map((n) => positionsFor(n.midi).sort((a, b) => a.fret - b.fret)[0] || { string: 0, fret: 0 });
      return HAND_POSITIONS.map(() => ({ cost: 0, pick }));
    }
    return row;
  });

  const H = HAND_POSITIONS.length;
  const move = (a, b) => (a === b ? 0 : 1.5 + Math.abs(a - b) * 0.4);
  let cost = local[0].map((r) => (r ? r.cost : Infinity));
  const back = [];
  for (let g = 1; g < groups.length; g++) {
    const next = new Array(H).fill(Infinity);
    const from = new Array(H).fill(0);
    for (let b = 0; b < H; b++) {
      const r = local[g][b];
      if (!r) continue;
      for (let a = 0; a < H; a++) {
        const c = cost[a] + move(HAND_POSITIONS[a], HAND_POSITIONS[b]) + r.cost;
        if (c < next[b]) { next[b] = c; from[b] = a; }
      }
    }
    back.push(from);
    cost = next;
  }
  let h = cost.indexOf(Math.min(...cost));
  for (let g = groups.length - 1; g >= 0; g--) {
    const free = groups[g].filter((n) => n.string === undefined).slice(0, 6);
    const { pick } = local[g][h];
    free.forEach((n, k) => { n.string = pick[k].string; n.fret = pick[k].fret; });
    if (g > 0) h = back[g - 1][h];
  }
  // Any note beyond six in a group: lowest fret.
  for (const n of notes) {
    if (n.string === undefined) {
      const p = positionsFor(n.midi).sort((a, b) => a.fret - b.fret)[0] || { string: 0, fret: 0 };
      n.string = p.string; n.fret = p.fret;
    }
  }
  return notes;
}

// ---------- tuner: YIN pitch detection on a time-domain buffer ----------
function detectPitch(buf, sampleRate) {
  // Downsample ×2 to keep it light on phones.
  const n = Math.floor(buf.length / 2);
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) { x[i] = 0.5 * (buf[2 * i] + buf[2 * i + 1]); energy += x[i] * x[i]; }
  const sr = sampleRate / 2;
  if (Math.sqrt(energy / n) < 0.0015) return null;
  const maxLag = Math.floor(sr / 60), minLag = Math.floor(sr / 1100);
  const W = n - maxLag;
  if (W < 256) return null;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    d[tau] = s;
  }
  const c = new Float32Array(maxLag + 2);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) { run += d[tau]; c[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (c[t] < 0.12) { while (t + 1 <= maxLag && c[t + 1] < c[t]) t++; tau = t; break; }
  }
  if (tau < 0) {
    let m = Infinity;
    for (let t = minLag; t <= maxLag; t++) if (c[t] < m) { m = c[t]; tau = t; }
    if (m > 0.3) return null;
  }
  const a = c[tau - 1], b = c[tau], cc = c[tau + 1];
  const den = a - 2 * b + cc;
  const shift = den > 0 ? (0.5 * (a - cc)) / den : 0;
  return { freq: sr / (tau + shift), clarity: 1 - b };
}

if (typeof module !== 'undefined') {
  module.exports = { GUITAR_TUNING, CHORD_SHAPES, chordNotes, fitToGuitar, chooseOctaveShift, assignGuitarPositions, detectPitch };
}
