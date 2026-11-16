# Keyfall 🎹

A falling-notes piano trainer that runs in the browser. Connect a real MIDI keyboard to your phone or computer, choose a song, and play the notes as they fall onto the keyboard.

## Features

- **Song library** with search, difficulty filters, recently played songs and best scores.
- **Learn mode**: the song waits until you press the right key. The next keys glow on the keyboard.
- **Play mode**: the song runs in real time and scores Perfect, Good and Missed hits, plus your streak.
- **Per-hand control**: set each hand to *Me* (you play it), *Auto* (the app plays it) or *Off*.
- **Speed control** from 25% to 200%, **section looping** (tap ⟲ to set the start, again to set the end, again to clear), and **seeking** by tapping the progress bar.
- **Results screen** with a star rating. Your best score is saved for each song and mode.
- **Import any `.mid` file**. Two-track files are split into right and left hand. Other files are split at middle C.
- **🎤 Microphone mode: no cable needed.** Tap **🎤 Mic off** at the top to switch it on, and the phone listens to your real piano (acoustic or digital) to work out which keys you play. Chords work too. Settings has a live level meter, a "Heard: …" readout for testing, and a sensitivity setting. It also works on iPhone and iPad.
- **More ways to play**:
  - A USB or Bluetooth **MIDI keyboard** (Web MIDI: Chrome, Edge, Opera on desktop and Android).
  - **Touch or mouse** on the on-screen keyboard.
  - A **computer keyboard**: `A S D F G H J K L ;` are white keys, `W E T Y U O P` are black keys, `Z`/`X` change the octave, and `Space` pauses.
- Built-in piano synth. In Settings you can mute it for MIDI input if your keyboard has its own speakers.

Built-in songs (public domain, simplified): C Major Scale, Twinkle Twinkle, Ode to Joy, Happy Birthday, Minuet in G, Bach's Prelude in C (opening) and Für Elise.

## Running it

There is no build step. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Web MIDI needs a secure context (`https://` or `localhost`). To use it on a phone, host the folder somewhere with HTTPS, for example GitHub Pages: *Settings → Pages → Deploy from branch*. Then open the URL in Chrome on Android and use "Add to Home screen" to install it like an app.

> iPhone/iPad: Safari does not support Web MIDI, so use **microphone mode** (or the on-screen keys) there.
>
> The microphone also needs HTTPS (or `localhost`). For the best results, put the phone on the music stand, play in a fairly quiet room, and use headphones or set the other hand to *Off*, so the mic only hears your piano. Mic detection lags MIDI by roughly 0.1 s; Play mode allows for this automatically.

## Adding songs

Add an entry to `SONG_DEFS` in `js/songs.js`:

```js
{
  id: 'my-song', title: 'My Song', composer: 'Me', difficulty: 'Beginner', bpm: 90,
  rh: 'C4 E4 G4:2 | C4+E4+G4:4',   // PITCH:BEATS, chords with +, rests with r:BEATS
  lh: 'C3:4 | C3:4',
}
```

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Screens: library, song setup, game, pause, results, settings |
| `css/style.css` | Styling (mobile first) |
| `js/songs.js` | Song notation parser and built-in songs |
| `js/audio.js` | Web Audio piano synth |
| `js/midi-file.js` | `.mid` file parser |
| `js/mic.js` | Microphone note detection (onset detection + harmonic pitch analysis) |
| `js/game.js` | Falling-notes engine: timing, scoring, canvas rendering |
| `js/app.js` | UI, input (MIDI, touch, keyboard), storage |
