// Standard MIDI File (.mid) parser -> Keyfall song.

function parseMidiFile(buffer) {
  const d = new DataView(buffer);
  let p = 0;
  const u8 = () => d.getUint8(p++);
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('This is not a MIDI file.');
  const hlen = u32();
  u16(); // format
  const ntracks = u16();
  const division = u16();
  p += hlen - 6;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');

  const tempos = [{ tick: 0, uspq: 500000 }];
  const tracks = [];

  for (let t = 0; t < ntracks && p + 8 <= buffer.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = Math.min(p + len, buffer.byteLength);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, running = 0, name = '';
    const open = new Map();
    const notes = [];

    const channelMsg = (status) => {
      const type = status & 0xf0, ch = status & 0x0f;
      if (type === 0x80 || type === 0x90) {
        const n = u8(), v = u8();
        if (ch === 9) return; // drums
        const k = ch * 128 + n;
        if (type === 0x90 && v > 0) {
          if (!open.has(k)) open.set(k, []);
          open.get(k).push({ tick, vel: v });
        } else {
          const arr = open.get(k);
          if (arr && arr.length) {
            const s = arr.shift();
            notes.push({ midi: n, startTick: s.tick, endTick: tick, vel: s.vel });
          }
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    };

    while (p < end) {
      tick += vlq();
      const b = d.getUint8(p);
      if (b & 0x80) {
        p++;
        if (b === 0xff) {
          const type = u8();
          const l = vlq();
          if (type === 0x51 && l === 3) {
            tempos.push({ tick, uspq: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
          } else if (type === 0x03 && !name) {
            name = str(l);
            continue;
          }
          p += l;
        } else if (b === 0xf0 || b === 0xf7) {
          p += vlq();
        } else {
          running = b;
          channelMsg(b);
        }
      } else if (running) {
        channelMsg(running);
      } else {
        throw new Error('Corrupt MIDI track.');
      }
    }
    // Close any notes left hanging at the end of the track.
    for (const [k, arr] of open) {
      for (const s of arr) notes.push({ midi: k % 128, startTick: s.tick, endTick: Math.max(tick, s.tick + division / 2), vel: s.vel });
    }
    p = end;
    if (notes.length) tracks.push({ name, notes });
  }

  if (!tracks.length) throw new Error('No notes found in this MIDI file.');

  // Tempo map: tick -> seconds
  tempos.sort((a, b) => a.tick - b.tick);
  const segs = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    const prev = segs[segs.length - 1];
    if (prev) sec += ((tempos[i].tick - prev.tick) * prev.uspq) / 1e6 / division;
    segs.push({ tick: tempos[i].tick, uspq: tempos[i].uspq, sec });
  }
  const toSec = (tick) => {
    let s = segs[0];
    for (const seg of segs) { if (seg.tick <= tick) s = seg; else break; }
    return s.sec + ((tick - s.tick) * s.uspq) / 1e6 / division;
  };

  // Hand assignment: two biggest tracks -> RH (higher average pitch) / LH, otherwise split at middle C.
  const avg = (tr) => tr.notes.reduce((a, n) => a + n.midi, 0) / tr.notes.length;
  let assign;
  if (tracks.length === 2) {
    const [a, b] = tracks;
    const rhTrack = avg(a) >= avg(b) ? a : b;
    assign = (tr, n) => (tr === rhTrack ? 'rh' : 'lh');
  } else {
    assign = (tr, n) => (n.midi >= 60 ? 'rh' : 'lh');
  }

  const notes = [];
  for (const tr of tracks) {
    for (const n of tr.notes) {
      const start = toSec(n.startTick);
      const dur = Math.max(0.05, toSec(n.endTick) - start);
      notes.push({ midi: n.midi, start, dur, hand: assign(tr, n) });
    }
  }
  // Trim leading silence
  const first = notes.reduce((m, n) => Math.min(m, n.start), Infinity);
  notes.forEach((n) => (n.start -= first));
  return notes;
}
