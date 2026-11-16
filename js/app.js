// Keyfall app shell: library, song setup, input sources, results.

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('keyfall.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('keyfall.' + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  const settings = Object.assign({ midiSound: true, showNames: true, volume: 0.8, micEnabled: false, micSensitivity: 'normal' }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);

  const synth = new PianoSynth();
  synth.setVolume(settings.volume);

  // ---------- songs ----------
  function loadImported() {
    return store.get('imports', []).map((s) =>
      finalizeSong(
        { id: s.id, title: s.title, composer: 'Imported MIDI', difficulty: 'Custom', imported: true },
        s.notes.map(([midi, start, dur, h]) => ({ midi, start, dur, hand: h ? 'lh' : 'rh' }))
      )
    );
  }
  let songs = [...BUILTIN_SONGS, ...loadImported()];
  const songById = (id) => songs.find((s) => s.id === id);

  const bestKey = (id, mode) => `best.${id}.${mode}`;
  const getBest = (id, mode) => store.get(bestKey(id, mode), null);

  // ---------- library ----------
  let filter = 'all';
  let query = '';

  function coverStyle(song) {
    let h = 0;
    for (const c of song.id) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `background: linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 60) % 360} 75% 30%))`;
  }
  const initials = (song) =>
    song.title.replace(/[^A-Za-zÀ-ÿ ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function songCard(song) {
    const el = document.createElement('button');
    el.className = 'song-card';
    const best = Math.max(getBest(song.id, 'learn') ?? -1, getBest(song.id, 'play') ?? -1);
    const mins = Math.floor(song.duration / 60), secs = Math.round(song.duration % 60);
    el.innerHTML = `
      <div class="cover" style="${coverStyle(song)}"><span>${initials(song)}</span></div>
      <div class="song-info">
        <b></b><small></small>
        <div class="tags"><span class="tag ${song.difficulty.toLowerCase()}">${song.difficulty}</span>
        <span class="tag">${mins}:${String(secs).padStart(2, '0')}</span>
        ${best >= 0 ? `<span class="tag best">★ ${best}%</span>` : ''}</div>
      </div>`;
    el.querySelector('b').textContent = song.title;
    el.querySelector('small').textContent = song.composer;
    el.addEventListener('click', () => openDetail(song.id));
    return el;
  }

  function renderLibrary() {
    const list = $('#song-list');
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const shown = songs.filter(
      (s) =>
        (filter === 'all' || s.difficulty === filter) &&
        (!q || s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
    );
    shown.forEach((s) => list.appendChild(songCard(s)));
    if (!shown.length) list.innerHTML = '<p class="muted empty">No songs here yet.</p>';

    const recent = store.get('recent', []).map(songById).filter(Boolean);
    const rl = $('#recent-list');
    rl.innerHTML = '';
    $('#recent-title').hidden = !recent.length || !!q || filter !== 'all';
    rl.hidden = $('#recent-title').hidden;
    recent.slice(0, 6).forEach((s) => rl.appendChild(songCard(s)));
  }

  $('#search').addEventListener('input', (e) => { query = e.target.value; renderLibrary(); });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.filter');
    if (!b) return;
    filter = b.dataset.filter;
    $$('.filter').forEach((x) => x.classList.toggle('active', x === b));
    renderLibrary();
  });

  // ---------- MIDI import ----------
  $('#import-midi').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const notes = parseMidiFile(await file.arrayBuffer());
      const id = 'imp-' + Date.now();
      const title = file.name.replace(/\.midi?$/i, '').replace(/[_-]+/g, ' ');
      const compact = notes.map((n) => [n.midi, +n.start.toFixed(3), +n.dur.toFixed(3), n.hand === 'lh' ? 1 : 0]);
      const imports = store.get('imports', []);
      imports.push({ id, title, notes: compact });
      if (!store.set('imports', imports)) toast('Imported for this session only (storage is full).');
      songs.push(
        finalizeSong({ id, title, composer: 'Imported MIDI', difficulty: 'Custom', imported: true }, notes)
      );
      toast(`Imported "${title}" — ${notes.length} notes`);
      renderLibrary();
      openDetail(id);
    } catch (err) {
      toast(err.message || 'Could not read that file.');
    }
  });

  // ---------- song detail ----------
  let current = null;
  const setup = { mode: 'learn', hands: { rh: 'you', lh: 'you' }, speed: 1 };

  function openDetail(id) {
    const song = songById(id);
    if (!song) return;
    current = song;
    const saved = store.get('setup.' + id, null);
    if (saved) Object.assign(setup, JSON.parse(JSON.stringify(saved)));
    else Object.assign(setup, { mode: 'learn', hands: { rh: 'you', lh: 'you' }, speed: song.difficulty === 'Intermediate' ? 0.7 : 1 });
    if (!song.notes.some((n) => n.hand === 'lh')) setup.hands.lh = 'off';
    if (!song.notes.some((n) => n.hand === 'rh')) setup.hands.rh = 'off';

    $('#detail-title').textContent = song.title;
    $('#detail-composer').textContent = song.composer;
    const lhCount = song.notes.filter((n) => n.hand === 'lh').length;
    $('#detail-meta').textContent = `${song.difficulty} · ${song.notes.length - lhCount} right-hand notes · ${lhCount} left-hand notes`;
    $('#detail-cover').setAttribute('style', coverStyle(song));
    $('#detail-cover').innerHTML = `<span>${initials(song)}</span>`;
    $('#btn-delete-song').hidden = !song.imported;
    syncDetail();
    $('#detail').hidden = false;
  }

  function syncDetail() {
    $$('#mode-switch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === setup.mode));
    $$('.hand-row[data-hand]').forEach((row) => {
      const v = setup.hands[row.dataset.hand];
      row.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    });
    $('#speed-val').textContent = Math.round(setup.speed * 100) + '%';
    const best = getBest(current.id, setup.mode);
    $('#ring-value').textContent = best === null ? '—' : best + '%';
    const C = 2 * Math.PI * 52;
    const fg = $('#ring-fg');
    fg.style.strokeDasharray = C;
    fg.style.strokeDashoffset = C * (1 - (best || 0) / 100);
    store.set('setup.' + current.id, setup);
  }

  $('#mode-switch').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setup.mode = b.dataset.mode;
    syncDetail();
  });
  $$('.hand-row[data-hand]').forEach((row) =>
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setup.hands[row.dataset.hand] = b.dataset.v;
      syncDetail();
    })
  );
  const stepSpeed = (s, d) => Math.max(0.25, Math.min(2, Math.round((s + d) * 100) / 100));
  $('#speed-down').onclick = () => { setup.speed = stepSpeed(setup.speed, -0.1); syncDetail(); };
  $('#speed-up').onclick = () => { setup.speed = stepSpeed(setup.speed, 0.1); syncDetail(); };

  $('#btn-delete-song').onclick = () => {
    if (!current || !current.imported || !confirm(`Delete "${current.title}"?`)) return;
    store.set('imports', store.get('imports', []).filter((s) => s.id !== current.id));
    store.set('recent', store.get('recent', []).filter((id) => id !== current.id));
    songs = songs.filter((s) => s.id !== current.id);
    closeSheets();
    renderLibrary();
  };

  function closeSheets() {
    $('#detail').hidden = true;
    $('#settings').hidden = true;
  }
  $$('.sheet-backdrop').forEach((bd) =>
    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('[data-close]')) bd.hidden = true;
    })
  );

  // ---------- game ----------
  let game = null;

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  $('#btn-start').onclick = () => {
    synth.ensure(); // unlock audio on a user gesture
    if (settings.micEnabled && !mic.running) setMic(true);
    startGame();
  };

  function startGame() {
    if (game) game.destroy();
    closeSheets();
    $('#results').hidden = true;
    $('#pause').hidden = true;
    showScreen('game');
    const recent = [current.id, ...store.get('recent', []).filter((id) => id !== current.id)].slice(0, 8);
    store.set('recent', recent);

    game = new Game($('#stage'), current, {
      mode: setup.mode,
      hands: { ...setup.hands },
      speed: setup.speed,
      showNames: settings.showNames,
      synth,
      callbacks: {
        onProgress: (p) => { $('#progress-fill').style.width = Math.min(100, p * 100) + '%'; },
        onStats: updateHud,
        onFinish: showResults,
      },
    });
    game.inputLatency = mic.running ? 0.15 : 0;
    if (mic.running && (setup.hands.lh === 'auto' || setup.hands.rh === 'auto')) {
      toast('Tip: use headphones so the mic only hears your piano, not the Auto hand.');
    }
    window.__game = game; // handy for debugging from the console
    $('#hud-mode').textContent = setup.mode === 'learn' ? 'Learn' : 'Play';
    $('#g-speed-val').textContent = Math.round(game.speed * 100) + '%';
    updateHud(game.stats, game.score());
    updateLoopUi();
    updateOctaveLabel();
    requestAnimationFrame(() => { game.resize(); game.start(); });
  }

  function updateHud(stats, score) {
    $('#hud-score').textContent = score === null ? 'Listening' : `${score}%`;
    $('#hud-combo').textContent = stats.combo >= 5 ? `${stats.combo} streak` : '';
  }

  function quitGame() {
    if (game) { game.destroy(); game = null; }
    $('#pause').hidden = true;
    $('#results').hidden = true;
    showScreen('library');
    renderLibrary();
  }

  function togglePause(force) {
    if (!game || game.finished) return;
    const p = force === undefined ? !game.paused : force;
    game.setPaused(p);
    $('#pause').hidden = !p;
  }

  $('#game-back').onclick = () => togglePause(true);
  $('#btn-pause').onclick = () => togglePause();
  $('#p-resume').onclick = () => togglePause(false);
  $('#p-restart').onclick = () => { game.restart(); updateHud(game.stats, game.score()); togglePause(false); };
  $('#p-quit').onclick = quitGame;
  $('#r-back').onclick = quitGame;
  $('#r-retry').onclick = () => startGame();
  document.addEventListener('visibilitychange', () => { if (document.hidden && game) togglePause(true); });

  $('#g-speed-down').onclick = () => {
    setup.speed = game.setSpeed(game.speed - 0.1);
    $('#g-speed-val').textContent = Math.round(game.speed * 100) + '%';
  };
  $('#g-speed-up').onclick = () => {
    setup.speed = game.setSpeed(game.speed + 0.1);
    $('#g-speed-val').textContent = Math.round(game.speed * 100) + '%';
  };

  $('#btn-loop').onclick = () => {
    const L = game.toggleLoopPoint();
    toast(L.a === null ? 'Loop cleared' : L.b === null ? 'Loop start set — tap again to set the end' : 'Looping section');
    updateLoopUi();
  };
  function updateLoopUi() {
    const el = $('#progress-loop');
    const L = game ? game.loop : { a: null };
    $('#btn-loop').classList.toggle('active', L.a !== null);
    if (L.a === null) { el.style.display = 'none'; return; }
    const d = game.song.duration;
    const b = L.b === null ? L.a + 0.01 * d : L.b;
    el.style.display = 'block';
    el.style.left = (L.a / d) * 100 + '%';
    el.style.width = Math.max(0.5, ((b - L.a) / d) * 100) + '%';
  }

  $('#progress').addEventListener('click', (e) => {
    if (!game) return;
    const r = e.currentTarget.getBoundingClientRect();
    game.seek(((e.clientX - r.left) / r.width) * game.song.duration - 1);
  });

  function showResults(stats, score) {
    const song = game.song;
    const mode = game.mode;
    $('#r-title').textContent = `${song.title} · ${mode === 'learn' ? 'Learn' : 'Play'}`;
    let isBest = false;
    if (score !== null) {
      const prev = getBest(song.id, mode);
      if (prev === null || score > prev) { store.set(bestKey(song.id, mode), score); isBest = true; }
    }
    $('#r-score').textContent = score === null ? '♪' : score + '%';
    $('#r-best').hidden = !isBest;
    const stars = score === null ? 0 : score >= 95 ? 3 : score >= 80 ? 2 : score >= 50 ? 1 : 0;
    $('#r-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    $('#r-perfect').textContent = stats.perfect;
    $('#r-perfect-label').textContent = mode === 'learn' ? 'Correct' : 'Perfect';
    $('#r-good').parentElement.hidden = mode === 'learn';
    $('#r-missed').parentElement.hidden = mode === 'learn';
    $('#r-good').textContent = stats.good;
    $('#r-missed').textContent = stats.missed;
    $('#r-wrong').textContent = stats.wrong;
    $('#r-combo').textContent = stats.maxCombo;
    $('#results').hidden = false;
  }

  // ---------- input: shared ----------
  const held = new Map(); // inputId -> midi

  function press(inputId, midi, velocity, source, latency = 0) {
    if (held.has(inputId)) release(inputId);
    held.set(inputId, midi);
    // The mic hears a real piano, so never add our own sound on top of it.
    const sound = source === 'midi' ? settings.midiSound : source !== 'mic';
    if (sound) synth.noteOn(midi, velocity, 'u' + inputId);
    if (game && !game.paused && !game.finished) game.noteOn(midi, latency);
  }
  function release(inputId) {
    const midi = held.get(inputId);
    if (midi === undefined) return;
    held.delete(inputId);
    synth.noteOff('u' + inputId);
    if (game && ![...held.values()].includes(midi)) game.noteOff(midi);
  }

  // ---------- input: Web MIDI ----------
  let midiAccess = null;
  async function connectMidi(userInitiated) {
    if (!navigator.requestMIDIAccess) {
      $('#midi-chip').textContent = 'MIDI: unsupported';
      $('#midi-devices').textContent = 'This browser has no Web MIDI. Use Chrome or Edge on desktop/Android. On iPhone/iPad, use the on-screen keys.';
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      midiAccess.onstatechange = refreshMidi;
      refreshMidi();
    } catch (e) {
      $('#midi-chip').textContent = 'MIDI: blocked';
      if (userInitiated) toast('MIDI access was blocked by the browser.');
    }
  }
  function refreshMidi() {
    const inputs = [...midiAccess.inputs.values()];
    inputs.forEach((inp) => {
      inp.onmidimessage = (ev) => {
        const [st, note, vel] = ev.data;
        const type = st & 0xf0;
        const id = `m${st & 0x0f}-${note}`;
        if (type === 0x90 && vel > 0) press(id, note, vel / 127, 'midi');
        else if (type === 0x80 || (type === 0x90 && vel === 0)) release(id);
      };
    });
    const chip = $('#midi-chip');
    chip.textContent = inputs.length ? `🎹 ${inputs.length > 1 ? inputs.length + ' devices' : 'Connected'}` : 'MIDI: none';
    chip.classList.toggle('ok', inputs.length > 0);
    $('#midi-devices').textContent = inputs.length ? inputs.map((i) => i.name).join(', ') : 'No keyboard found — plug one in via USB or Bluetooth MIDI.';
    $('#btn-midi').textContent = inputs.length ? 'Rescan' : 'Connect';
  }
  $('#btn-midi').onclick = () => connectMidi(true);
  $('#midi-chip').onclick = () => openSettings();
  // Try silently on load (works without a prompt in most browsers).
  connectMidi(false);

  // ---------- input: microphone ----------
  const micTimers = new Map();
  const mic = new MicListener({
    onNotes: (notes, latency) => {
      for (const m of notes) {
        const id = 'mic' + m;
        press(id, m, 0.8, 'mic', latency);
        clearTimeout(micTimers.get(id));
        micTimers.set(id, setTimeout(() => release(id), 220));
      }
      $('#mic-heard').textContent = notes.map((m) => midiToName(m)).join(' + ');
      (window.__micLog = window.__micLog || []).push(notes.map((m) => midiToName(m)).join('+'));
      if (window.__micLog.length > 200) window.__micLog.shift();
    },
    onLevel: (v) => {
      $('#mic-meter').style.width = v * 100 + '%';
      $('#mic-ind').style.setProperty('--lvl', v);
    },
    getExpected: () => (game && !game.paused && !game.finished ? game.expectedNotes() : new Set()),
    getIgnored: () => (game ? new Set(game.autoKeys.keys()) : new Set()),
  });
  mic.sensitivity = settings.micSensitivity;

  function updateMicUi() {
    const on = mic.running;
    const chip = $('#mic-chip');
    chip.textContent = on ? '🎤 Listening' : '🎤 Mic off';
    chip.classList.toggle('on', on);
    $('#opt-mic').checked = on;
    $('#mic-test').hidden = !on;
    $('#mic-ind').hidden = !on;
    if (game) game.inputLatency = on ? 0.15 : 0;
  }

  async function setMic(on) {
    if (on) {
      try {
        await mic.start(synth.ensure());
        settings.micEnabled = true;
        $('#mic-heard').textContent = 'play a key…';
      } catch (e) {
        settings.micEnabled = false;
        toast(e && e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings.' : (e.message || 'Could not start the microphone.'));
      }
    } else {
      mic.stop();
      settings.micEnabled = false;
    }
    saveSettings();
    updateMicUi();
  }

  $('#mic-chip').onclick = () => {
    if (!mic.running) { setMic(true).then(() => { if (mic.running) toast('Listening! Play your piano — check Settings to test it.'); }); }
    else setMic(false);
  };
  $('#opt-mic').onchange = (e) => setMic(e.target.checked);
  $('#opt-mic-sens').onchange = (e) => { settings.micSensitivity = mic.sensitivity = e.target.value; saveSettings(); };

  // ---------- input: computer keyboard ----------
  const KEYMAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
    KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
  };
  let kbOctave = 4;
  function updateOctaveLabel() {
    $('#kb-octave').textContent = `⌨ A = C${kbOctave}`;
  }
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('#game').classList.contains('active')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePause(); return; }
    if (e.code === 'Escape') { togglePause(true); return; }
    if (e.repeat) return;
    if (e.code === 'KeyZ') { kbOctave = Math.max(1, kbOctave - 1); updateOctaveLabel(); return; }
    if (e.code === 'KeyX') { kbOctave = Math.min(7, kbOctave + 1); updateOctaveLabel(); return; }
    if (e.code in KEYMAP) {
      synth.ensure();
      press('k' + e.code, (kbOctave + 1) * 12 + KEYMAP[e.code], 0.8, 'keys');
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code in KEYMAP) release('k' + e.code); });
  window.addEventListener('blur', () => { for (const id of [...held.keys()]) release(id); });

  // ---------- input: touch / mouse on the on-screen keyboard ----------
  const stage = $('#stage');
  const pointerKey = (e) => {
    const r = stage.getBoundingClientRect();
    return game ? game.keyAt(e.clientX - r.left, e.clientY - r.top) : null;
  };
  stage.addEventListener('pointerdown', (e) => {
    const m = pointerKey(e);
    if (m === null) return;
    e.preventDefault();
    synth.ensure();
    stage.setPointerCapture(e.pointerId);
    press('p' + e.pointerId, m, 0.8, 'touch');
  });
  stage.addEventListener('pointermove', (e) => {
    const id = 'p' + e.pointerId;
    if (!held.has(id)) return;
    const m = pointerKey(e);
    if (m !== null && m !== held.get(id)) press(id, m, 0.7, 'touch');
  });
  ['pointerup', 'pointercancel'].forEach((ev) => stage.addEventListener(ev, (e) => release('p' + e.pointerId)));

  // ---------- settings ----------
  function openSettings() {
    $('#opt-midi-sound').checked = settings.midiSound;
    $('#opt-names').checked = settings.showNames;
    $('#opt-volume').value = settings.volume;
    $('#opt-mic-sens').value = settings.micSensitivity;
    updateMicUi();
    $('#settings').hidden = false;
  }
  $('#btn-settings').onclick = openSettings;
  $('#opt-midi-sound').onchange = (e) => { settings.midiSound = e.target.checked; saveSettings(); };
  $('#opt-names').onchange = (e) => { settings.showNames = e.target.checked; saveSettings(); if (game) game.showNames = settings.showNames; };
  $('#opt-volume').oninput = (e) => { settings.volume = +e.target.value; synth.setVolume(settings.volume); saveSettings(); };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  renderLibrary();
})();
