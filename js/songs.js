// Built-in song library (all public-domain melodies, simplified arrangements).
//
// Notation, one string per voice:  "PITCH:BEATS" tokens separated by spaces.
//   Pitch:  C4, F#3, Bb4 ...   Chord: C4+E4+G4:2   Rest: r:1
//   Beats are quarter notes (0.5 = eighth, 0.25 = sixteenth). "|" is ignored (bar line).
// A hand may be a string or an array of strings (several voices played by that hand).

const SONG_DEFS = [
  {
    id: 'c-major-scale',
    title: 'C Major Scale',
    composer: 'Warm-up',
    difficulty: 'Beginner',
    bpm: 80,
    rh: 'C4 D4 E4 F4 G4 A4 B4 C5 | C5 B4 A4 G4 F4 E4 D4 C4:2',
    lh: 'C3 D3 E3 F3 G3 A3 B3 C4 | C4 B3 A3 G3 F3 E3 D3 C3:2',
  },
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle Little Star',
    composer: 'Traditional',
    difficulty: 'Beginner',
    bpm: 96,
    rh:
      'C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | ' +
      'G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | ' +
      'C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2',
    lh:
      'C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2 | ' +
      'C3:2 G2:2 | C3:2 G2:2 | C3:2 G2:2 | C3:2 G2:2 | ' +
      'C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    difficulty: 'Beginner',
    bpm: 100,
    rh:
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:.5 D4:2 | ' +
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2',
    lh:
      'C3:4 | G2:4 | C3:4 | G2:4 | ' +
      'C3:4 | G2:4 | C3:4 | G2:2 C3:2',
  },
  {
    id: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Patty & Mildred Hill',
    difficulty: 'Beginner',
    bpm: 100,
    rh:
      'G4:.75 G4:.25 | A4 G4 C5 | B4:2 G4:.75 G4:.25 | A4 G4 D5 | C5:2 G4:.75 G4:.25 | ' +
      'G5 E5 C5 | B4 A4:2 | F5:.75 F5:.25 E5 C5 | D5 C5:2',
    lh: 'r:1 | C3:3 | G2:3 | G2:3 | C3:3 | C3:3 | F3:3 | C3:3 | G2 C3:2',
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Christian Petzold',
    difficulty: 'Intermediate',
    bpm: 110,
    rh:
      'D5 G4:.5 A4:.5 B4:.5 C5:.5 | D5 G4 G4 | E5 C5:.5 D5:.5 E5:.5 F#5:.5 | G5 G4 G4 | ' +
      'C5 D5:.5 C5:.5 B4:.5 A4:.5 | B4 C5:.5 B4:.5 A4:.5 G4:.5 | F#4 G4:.5 A4:.5 B4:.5 G4:.5 | A4:3',
    lh:
      'G3+B3:2 A3 | B3:3 | C4:3 | B3:3 | ' +
      'A3:3 | G3:3 | D4 B3 G3 | D4:2 D3',
  },
  {
    id: 'prelude-in-c',
    title: 'Prelude in C (opening)',
    composer: 'J. S. Bach',
    difficulty: 'Intermediate',
    bpm: 66,
    rh: (() => {
      const fig = (a, b, c) => `r:.5 ${a}:.25 ${b}:.25 ${c}:.25 ${a}:.25 ${b}:.25 ${c}:.25`;
      const bar = (a, b, c) => `${fig(a, b, c)} ${fig(a, b, c)} |`;
      return [bar('G4', 'C5', 'E5'), bar('A4', 'D5', 'F5'), bar('G4', 'D5', 'F5'), bar('G4', 'C5', 'E5')].join(' ');
    })(),
    lh: [
      'C3:2 C3:2 | C3:2 C3:2 | B2:2 B2:2 | C3:2 C3:2',
      (() => {
        const half = (n) => `r:.25 ${n}:1.75`;
        return ['E3', 'D3', 'D3', 'E3'].map((n) => `${half(n)} ${half(n)}`).join(' | ');
      })(),
    ],
  },
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    difficulty: 'Intermediate',
    bpm: 66,
    rh: (() => {
      const a1 = 'E5:.25 D#5:.25 E5:.25 B4:.25 D5:.25 C5:.25';
      const body =
        `${a1} | A4:.5 r:.25 C4:.25 E4:.25 A4:.25 | B4:.5 r:.25 E4:.25 G#4:.25 B4:.25 | ` +
        `C5:.5 r:.25 E4:.25 E5:.25 D#5:.25 | ${a1} | A4:.5 r:.25 C4:.25 E4:.25 A4:.25 | ` +
        'B4:.5 r:.25 E4:.25 C5:.25 B4:.25 |';
      return `E5:.25 D#5:.25 | ${body} A4:.5 r:.5 E5:.25 D#5:.25 | ${body} A4:1.5`;
    })(),
    lh: (() => {
      const am = 'A2:.25 E3:.25 A3:.25 r:.75';
      const e = 'E2:.25 E3:.25 G#3:.25 r:.75';
      const body = `r:1.5 | ${am} | ${e} | ${am} | r:1.5 | ${am} | ${e} |`;
      return `r:.5 | ${body} ${am} | ${body} A2:.25 E3:.25 A3:1`;
    })(),
  },
];

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + NOTE_BASE[m[1]] + acc;
}

function midiToName(midi, withOctave = true) {
  const n = NOTE_NAMES[midi % 12];
  return withOctave ? n + (Math.floor(midi / 12) - 1) : n;
}

function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

function parseVoice(str, hand, secPerBeat, out) {
  let beat = 0;
  for (const tok of str.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [pitch, durStr] = tok.split(':');
    const dur = durStr === undefined ? 1 : parseFloat(durStr);
    if (pitch !== 'r') {
      for (const p of pitch.split('+')) {
        out.push({
          midi: noteToMidi(p),
          start: beat * secPerBeat,
          dur: dur * secPerBeat * 0.95,
          hand,
        });
      }
    }
    beat += dur;
  }
}

function finalizeSong(song, notes) {
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const duration = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return { ...song, notes, duration };
}

function buildSong(def) {
  const spb = 60 / def.bpm;
  const notes = [];
  for (const hand of ['rh', 'lh']) {
    const voices = Array.isArray(def[hand]) ? def[hand] : def[hand] ? [def[hand]] : [];
    voices.forEach((v) => parseVoice(v, hand, spb, notes));
  }
  const { rh, lh, ...meta } = def;
  return finalizeSong(meta, notes);
}

const BUILTIN_SONGS = SONG_DEFS.map(buildSong);
