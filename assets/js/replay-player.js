/* The replay page (app/watch/page.tsx): watch an online match again, in the visitor's browser.

   The game's own replay player runs here, as WebAssembly (public/player/player.js and player.wasm, built
   from native-port/port by scripts/publish-web-to-site.sh; native-port/docs/WEB_BUILD.md). The visitor
   brings their copy of the game: it is read from their disk into this browser's storage (IndexedDB) and
   never uploaded. The match list and each replay come from the server's public API
   (legacy-server/src/Admin/PublicReplayApi.cs, native-port/docs/REPLAY.md), fetched here, by the browser:
   the site itself is static.

   Derived from native-port/port/web/player.html, the developer's test page, without the single-player
   game, the server-address box and the key and pointer input (a replay takes none). Keep the two in step
   where they share code: the sound, the clock, the replay controls and Save as video. The page loads
   /player/config.js, then /player/player.js, then this file (components/builder-scripts.tsx). */
(() => {
'use strict';
const ROOT = '/data', GAMES = ROOT + '/games', CACHE = ROOT + '/cache', SAVES = ROOT + '/saves';
const KIND_PC = 1, KIND_NGAGE = 2;
const FPS = 30;
const C_KEYBOARD = 0;   // RG_CONTROLS_*; a replay takes no input, so the page never changes it
const PAGE = 20;        // matches asked for at a time
const FILTER_DELAY = 350;   // ms after the last keystroke before the list is asked for

const $ = id => document.getElementById(id);
let M, FS;

function status(text, error) {
  $('status').textContent = text || '';
  $('status').className = error ? 'status is-error' : 'status';
}
function listStatus(text, error) {
  $('list-status').textContent = text || '';
  $('list-status').className = error ? 'status is-error' : 'status';
}
// Lets the page paint (a status line) before a long call into the core blocks it.
const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

function exists(path) { try { FS.stat(path); return true; } catch (e) { return false; } }
function rmrf(path) {
  if (!exists(path)) return;
  if (FS.isDir(FS.stat(path).mode)) {
    for (const n of FS.readdir(path)) if (n !== '.' && n !== '..') rmrf(path + '/' + n);
    FS.rmdir(path);
  } else FS.unlink(path);
}
function mkdirs(path) {
  let p = '';
  for (const part of path.split('/').filter(Boolean)) { p += '/' + part; if (!exists(p)) FS.mkdir(p); }
}
let syncing = false;
function save() {   // the browser's storage, from the files the core wrote
  return new Promise(resolve => {
    if (syncing) return resolve();
    syncing = true;
    FS.syncfs(false, err => { syncing = false; if (err) console.warn('saving failed', err); resolve(); });
  });
}

// ---------------------------------------------------------------- the server

/* Where the API is: /player/config.js sets window.REPLAY_API. ?api=URL replaces it for testing, but only
   with a server on this machine: a link must not be able to point the page at someone else's server. */
const params = new URLSearchParams(location.search);
function apiBase() {
  const asked = params.get('api');
  if (asked) {
    try {
      const u = new URL(asked);
      if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return asked.replace(/\/+$/, '');
    } catch (e) { /* not an address */ }
  }
  return String(window.REPLAY_API || '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------- the imported game

function imported() {
  for (const [kind, name] of [[KIND_PC, 'pc'], [KIND_NGAGE, 'ngage']])
    if (exists(GAMES + '/' + name)) return { kind, dir: GAMES + '/' + name };
  return null;
}

function forgetGames() {   // the imported game, its widescreen layouts and the unpacked cache
  if (exists(GAMES)) for (const n of FS.readdir(GAMES)) if (n !== '.' && n !== '..') rmrf(GAMES + '/' + n);
  rmrf(CACHE);
}

function showGame() {
  const g = imported();
  $('have').textContent = g ? 'Ready: ' + (g.kind === KIND_PC ? 'the PC version' : 'the N-Gage version') + ' is in this browser.'
                            : 'No game yet. Choose your copy: the PC version\'s folder (the one with ResetGeneration-Win32-Web.dll), or an N-Gage .n-gage file.';
  $('have').className = g ? 'have is-ready' : 'have';
  $('forget').disabled = !g;
  const offered = g && M.ccall('pr_licence_offered', 'number', ['string'], [g.dir]);
  $('licence-row').hidden = !offered;
  try { $('licence').checked = localStorage.getItem('licence') === '1'; } catch (e) {}
}

async function importFrom(files, src) {
  status('Reading your files…');
  await paint();
  rmrf('/tmp/import');
  mkdirs('/tmp/import');
  for (const [path, file] of files) {
    const full = '/tmp/import/' + path;
    mkdirs(full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, new Uint8Array(await file.arrayBuffer()));
  }
  const kind = M.ccall('pr_probe', 'number', ['string'], [src]);
  if (!kind) { rmrf('/tmp/import'); return status(M.UTF8ToString(M._pr_error()) || 'Not a game this player knows.', true); }
  const name = kind === KIND_PC ? 'pc' : 'ngage';
  status('Importing…');
  await paint();
  forgetGames();
  mkdirs(GAMES); mkdirs(CACHE);
  const n = M.ccall('pr_import', 'number', ['string', 'string'], [src, GAMES + '/' + name]);
  rmrf('/tmp/import');
  if (n < 0) { rmrf(GAMES + '/' + name); return status('Import failed: ' + M.UTF8ToString(M._pr_error()), true); }
  status('Saving to this browser…');
  await save();
  status('Imported ' + n + ' files. They stay in this browser.');
  showGame();
}

$('pick-folder').addEventListener('change', async e => {
  const all = [...e.target.files];
  e.target.value = '';
  // Only the folder that holds the DLL, wherever it is in what was picked
  const dll = all.find(f => /(^|\/)ResetGeneration-Win32-Web\.dll$/i.test(f.webkitRelativePath));
  if (!dll) return status('That folder has no ResetGeneration-Win32-Web.dll.', true);
  const base = dll.webkitRelativePath.slice(0, dll.webkitRelativePath.lastIndexOf('/') + 1);
  const files = all.filter(f => f.webkitRelativePath.startsWith(base) && !f.webkitRelativePath.slice(base.length).includes('/'))
                   .map(f => ['pc/' + f.name, f]);
  await importFrom(files, '/tmp/import/pc');
});
$('pick-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await importFrom([[f.name, f]], '/tmp/import/' + f.name);
});
$('forget').addEventListener('click', async () => {
  forgetGames();
  await save();
  status('Removed from this browser.');
  showGame();
});
$('licence').addEventListener('change', () => {
  try { localStorage.setItem('licence', $('licence').checked ? '1' : '0'); } catch (e) {}
});

// ---------------------------------------------------------------- sound

// The core makes 48 kHz mono; the worklet plays it from a queue, resampling if the device's rate
// differs. The game's frames are paced by this clock while it runs (see loop), so the queue holds
// what was made ahead and no more.
const WORKLET = `
class Out extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = new Float32Array(1 << 17); this.r = 0; this.w = 0; this.pos = 0;
    this.step = 48000 / sampleRate;
    this.port.onmessage = e => {
      if (e.data === 'flush') { this.r = this.w; this.pos = 0; return; }
      const s = e.data, m = this.q.length - 1;
      for (let i = 0; i < s.length; i++) this.q[(this.w + i) & m] = s[i];
      this.w += s.length;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0], m = this.q.length - 1;
    for (let i = 0; i < out.length; i++) {
      if (this.w - this.r < 2) { out[i] = 0; continue; }
      const a = this.q[this.r & m], b = this.q[(this.r + 1) & m];
      out[i] = a + (b - a) * this.pos;
      this.pos += this.step;
      while (this.pos >= 1) { this.pos -= 1; this.r++; }
    }
    return true;
  }
}
registerProcessor('out', Out);`;

let ctx = null, node = null;
async function startSound() {
  if (ctx) return;
  try {
    ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    node = new AudioWorkletNode(ctx, 'out', { outputChannelCount: [1] });
    node.connect(ctx.destination);
    await ctx.resume();
  } catch (e) {
    console.warn('no sound', e);
    ctx = node = null;
  }
}
const soundOn = () => ctx && node && ctx.state === 'running';

// ---------------------------------------------------------------- the game

let running = false, paused = false;
let startClock = 0, ticks = 0, produced = 0;  // frames run and samples made since startClock
let image, cv2d;
const perf = { t: 0, n: 0, ms: 0 };

// The clock frames are paced by: the sound's, when there is sound, so the two never drift apart.
const now = () => soundOn() ? ctx.currentTime : performance.now() / 1000;

function resetClock() {
  startClock = now(); ticks = 0; produced = 0;
  if (node) node.port.postMessage('flush');
}

// A whole number of times the game's size where there is room for that, the screen's width otherwise
function fit() {
  const w = M._pr_width(), h = M._pr_height(), c = $('screen');
  const room = Math.min($('stage').clientWidth || innerWidth - 32, (innerHeight - 160) * w / h);
  const s = room >= w ? Math.floor(room / w) : room / w;
  c.style.width = Math.floor(w * s) + 'px';
}

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  // saving: the video maker runs the game (see 'Save as video'); a replay not started yet waits for Play
  if (paused || saving || (replay && !replay.started)) return;
  const due = Math.floor((now() - startClock) * FPS);
  if (due - ticks > 6) { ticks = due - 1; produced = ticks * 1600; }  // far behind (a stall): skip ahead
  let ran = 0;
  const t0 = performance.now();
  while (ticks < due && ran < 4) {
    const r = M._pr_tick(C_KEYBOARD);
    ticks++; ran++;
    if (r !== 1) return stopped(r);
  }
  if (!ran) return;
  perf.ms += performance.now() - t0; perf.n += ran;
  // Sound for every frame run, 100 ms ahead: 1600 samples a frame at 48 kHz
  const bytes = M._pr_audio_bytes();
  while (produced < ticks * 1600 + 4800) {
    const p = M._pr_audio();
    const s16 = new Int16Array(M.HEAPU8.buffer, p, bytes / 2), f = new Float32Array(s16.length);
    for (let i = 0; i < s16.length; i++) f[i] = s16[i] / 32768;
    if (soundOn()) node.port.postMessage(f, [f.buffer]);
    produced += s16.length;
  }
  image.data.set(new Uint8ClampedArray(M.HEAPU8.buffer, M._pr_frame(), image.data.length));
  cv2d.putImageData(image, 0, 0);
  if (replay) showReplayTime();
  const t = performance.now();
  if (t - perf.t > 1000) {
    $('stats').textContent = `${(perf.n * 1000 / (t - perf.t)).toFixed(0)} fps` + (soundOn() ? '' : ' · no sound');
    perf.t = t; perf.n = 0; perf.ms = 0;
  }
}

function stopped(r) {
  running = false;
  const why = M.UTF8ToString(M._pr_error());
  save();
  $('stage').style.display = 'none';
  $('setup').style.display = '';
  $('watch').style.display = '';
  if (r === 2) listStatus('The replay was closed. Reload the page to watch another.');
  else listStatus('The replay stopped: ' + why, true);
  replay = null;
}

// The screen, the loop and the saving, once the core has a game
function begin() {
  const c = $('screen');
  c.width = M._pr_width(); c.height = M._pr_height();
  cv2d = c.getContext('2d');
  image = cv2d.createImageData(c.width, c.height);
  $('setup').style.display = 'none';
  $('watch').style.display = 'none';
  $('stage').style.display = 'flex';
  fit();
  running = true;
  resetClock();
  perf.t = performance.now();
  requestAnimationFrame(loop);
  setInterval(() => { if (running) save(); }, 15000);
}

// In the background the game is paused, as the phone apps pause it; it goes on where it was.
function background(hidden) {
  if (!running || saving || hidden === paused) return;   // a video goes on being made in the background
  paused = hidden;
  M._pr_release_all();
  M._pr_pause(hidden ? 1 : 0);
  if (hidden) { save(); if (ctx) ctx.suspend(); }
  else { (ctx ? ctx.resume() : Promise.resolve()).then(resetClock); }
}
document.addEventListener('visibilitychange', () => background(document.hidden));
addEventListener('pagehide', () => { if (running) save(); });
addEventListener('resize', () => { if (running) fit(); });

// ---------------------------------------------------------------- watching a match again

// Replays are watched in 16:9: the game's layout for a 568x320 screen (the recipes step by 8, so
// 568, not 569), made once from the recipe that ships beside the engine (public/player/*.rgr, landscape-mod)
// on the player's own copy, and kept in the browser's storage. If anything fails the replay plays at the
// original 240x320.
const WIDE = { w: 568, h: 320 };
async function wideLayout(g) {
  const none = { dir: '' };
  const name = g.kind === KIND_PC ? 'pc' : 'ngage';
  const dir = `${GAMES}/${name}-${WIDE.w}x${WIDE.h}`;
  try {
    if (!exists(dir)) {
      listStatus('Laying the game out for widescreen… (once)');
      await paint();
    }
    const r = await fetch(`public/player/${name}.rgr`);
    if (!r.ok) throw new Error(`${name}.rgr: ${r.status}`);
    FS.writeFile('/tmp/recipe.rgr', new Uint8Array(await r.arrayBuffer()));
    const ok = M.ccall('pr_layout', 'number', ['string', 'string', 'string', 'number', 'number'],
                       ['/tmp/recipe.rgr', g.dir, dir, WIDE.w, WIDE.h]);
    if (ok < 0) throw new Error(M.UTF8ToString(M._pr_error()));
    await save();
    return { dir };
  } catch (e) {
    console.warn('no widescreen layout, using 240x320:', e);
    rmrf(dir);
    return none;
  }
}

// The server's public replay API: GET /api/matches and /api/matches/{id}/replay. The page gives the
// replay to the core through a file (pr_start_replay).
const R_TIME = 0, R_LENGTH = 1, R_PLAY = 2, R_SEEK = 3, R_MODE = 4, R_BUSY = 5, R_VOICE = 6;
let replay = null, nextPage = null, seeking = false;

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const heroName = h => (h || '?').toLowerCase().replace(/_/g, ' ');
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

// A match as lines of text; player names are other people's input, so they only ever become text nodes
function describe(m, lookedFor) {
  const root = el('div', 'match__text');
  const who = el('div', 'match__who');
  m.players.forEach((p, i) => {
    if (i) who.append(' · ');
    const hit = lookedFor && !p.bot && p.name.toLowerCase().includes(lookedFor);
    who.append(el('span', hit ? 'match__name is-hit' : 'match__name', p.name), ' ', el('span', 'match__hero', `(${heroName(p.hero)})`));
  });
  const rules = m.itemRules && m.itemRules !== 'legacy' ? ' · ' + m.itemRules : '';
  const won = m.winner ? ' · won by ' + m.winner : '';
  root.append(who, el('div', 'match__what', `#${m.id} · ${m.map || 'unknown map'} · ${new Date(m.date).toLocaleString()} · ${clock(m.seconds)}${won}${rules}`));
  return root;
}

let listRequest = 0;   // the newest request; an answer to an older one (typing goes on) is dropped
function filterText() { return $('player-filter').value.trim(); }

async function loadMatches(more) {
  const base = apiBase();
  if (!base) return listStatus('The match list is not connected to a server yet.', true);
  const mine = ++listRequest;
  const lookedFor = filterText().toLowerCase();
  let url = `${base}/api/matches?limit=${PAGE}`;
  if (lookedFor) url += `&player=${encodeURIComponent(filterText())}`;
  if (more && nextPage) url += `&before=${nextPage}`;
  listStatus(lookedFor ? `Looking for ${filterText()}…` : 'Asking the server for its matches…');
  let d;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status === 429 ? 'too many requests, try again in a minute' : `${r.status} ${r.statusText}`);
    d = await r.json();
  } catch (e) {
    if (mine === listRequest) listStatus('The server did not answer: ' + e.message, true);
    return;
  }
  if (mine !== listRequest) return;
  listStatus('');
  if (!more) $('matches').replaceChildren();
  // The server filters; this guards against a server that does not know the filter yet
  const shown = d.matches.filter(m => !lookedFor || m.players.some(p => !p.bot && p.name.toLowerCase().includes(lookedFor)));
  for (const m of shown) {
    const row = el('div', 'match');
    row.append(describe(m, lookedFor));
    const b = el('button', 'btn btn--small', 'Watch');
    b.type = 'button';
    b.addEventListener('click', () => watch(m.id));
    row.append(b);
    $('matches').append(row);
  }
  if (!$('matches').children.length)
    listStatus(lookedFor ? `No recorded match with a player whose name contains "${filterText()}".` : 'The server has no recorded matches yet.');
  nextPage = d.next;
  $('older').hidden = !nextPage;
  syncAddress();
}

// The address names the filter (and the match being watched), so a link shares a player's matches
function syncAddress(matchId) {
  const q = new URLSearchParams();
  if (filterText()) q.set('player', filterText());
  if (matchId) q.set('match', matchId);
  if (params.get('api')) q.set('api', params.get('api'));
  const query = q.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
}

let filterTimer = 0;
$('player-filter').addEventListener('input', () => {
  $('player-clear').hidden = !filterText();
  clearTimeout(filterTimer);
  nextPage = null;
  filterTimer = setTimeout(() => loadMatches(false), FILTER_DELAY);
});
$('player-form').addEventListener('submit', e => {
  e.preventDefault();
  clearTimeout(filterTimer);
  nextPage = null;
  loadMatches(false);
});
$('player-clear').addEventListener('click', () => {
  $('player-filter').value = '';
  $('player-clear').hidden = true;
  nextPage = null;
  loadMatches(false);
  $('player-filter').focus();
});

// The engine on the replay, at its first frame: pr_start_replay's arguments. False with pr_error.
// Again after pr_stop, it starts the replay over (see 'Save as video').
const startEngine = args =>
  M.ccall('pr_start_replay', 'number', ['string', 'string', 'string', 'string', 'string', 'number', 'number'], args) >= 0;

// A match by id (from the server), or a replay already in hand (a file the API gave earlier)
async function watch(id, given) {
  const g = imported();
  if (!g) {
    status('Choose your copy of the game first: the replay is shown by the game itself.', true);
    $('setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return listStatus('Watching needs the game imported first (step 1).', true);
  }
  await startSound();   // first, inside the click: browsers start sound only on a user gesture
  let d = given;
  if (!d) {
    const base = apiBase();
    if (!base) return listStatus('The match list is not connected to a server yet.', true);
    listStatus(`Fetching match ${id}…`);
    try {
      const r = await fetch(`${base}/api/matches/${id}/replay`);
      d = await r.json();
      if (!r.ok) throw new Error(d.message || `${r.status} ${r.statusText}`);
    } catch (e) { return listStatus('No replay: ' + e.message, true); }
  }
  listStatus('Starting the replay… (the first start unpacks the game, which takes a moment)');
  await paint();
  mkdirs(CACHE); mkdirs(SAVES); mkdirs('/tmp');
  const layout = await wideLayout(g);
  FS.writeFile('/tmp/replay.txt', [d.engine, d.start || '', d.itemRules || '', d.keepsHoles ? '1' : '0'].join('\n'));
  const args = [g.dir, CACHE, SAVES, '/tmp/replay.txt', layout.dir, WIDE.w, WIDE.h];
  if (!startEngine(args))
    return listStatus('Could not start the replay: ' + M.UTF8ToString(M._pr_error()), true);
  // Nothing runs until Play (the cover's or the bar's): the engine makes its replay session, and starts
  // playing it, on its first frames. Save as video runs the game itself, so it works before that too.
  replay = { match: d.match, playing: false, done: false, started: false, args };
  $('replay-title').replaceChildren(d.match ? describe(d.match, filterText().toLowerCase()) : '');
  $('replay-bar').style.display = 'flex';
  $('cover').hidden = false;
  $('seek').disabled = true;   // nothing to seek in before the session exists
  if (d.notes && d.notes.length) console.info('replay notes:', d.notes);
  syncAddress(d.match ? d.match.id : '');
  begin();
  $('stage').scrollIntoView({ block: 'start' });
}

function showReplayTime() {
  mode();
  const t = M._pr_replay(R_TIME, 0, 0), len = M._pr_replay(R_LENGTH, 0, 0);
  if (!seeking) { $('seek').max = len; $('seek').value = Math.min(t, len); }
  $('clock').textContent = `${clock(Math.min(t, len))} / ${clock(len)}`;
  // As the 2008 player screen (PlayerInterfaceScreen.java): over when its time is up and the board is still
  if (!replay.done && len > 0 && t >= len && !M._pr_replay(R_BUSY, 0, 0)) {
    replay.done = true;
    $('clock').textContent += ' · finished';
  }
}

function setPlaying(on) {
  replay.playing = on;
  M._pr_replay(R_PLAY, on ? 1 : 0, 0);
  $('replay-play').textContent = on ? 'Pause' : 'Play';
  $('replay-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
}

// The first Play: the cover goes and the game runs from here, on a fresh clock. A video saved before
// left the session at its start, paused (see 'Save as video'), so it is told to play.
function startReplay() {
  if (!replay || replay.started || saving) return;
  replay.started = true;
  $('cover').hidden = true;
  $('seek').disabled = false;
  setPlaying(true);
  if (ctx) ctx.resume().catch(() => {});   // inside the click, as the browsers want
  resetClock();
}
$('replay-start').addEventListener('click', startReplay);

$('replay-play').addEventListener('click', () => {
  if (!replay.started) return startReplay();
  if (replay.done) { M._pr_replay(R_SEEK, 0, 0); replay.done = false; return setPlaying(true); }
  setPlaying(!replay.playing);
});
// The engine takes the mode only once its replay session exists, and a seek puts it back to its default, so the
// page sets it with every frame it runs (a few bytes) instead of on a click.
const mode = () => {
  M._pr_replay(R_MODE, $('replay-skip').checked ? 1 : 0, $('replay-fast').checked ? 1 : 0);
  M._pr_replay(R_VOICE, $('replay-voice').checked ? 1 : 0, 0);
};
$('seek').addEventListener('input', () => { seeking = true; $('clock').textContent = `${clock(+$('seek').value)} / ${clock(+$('seek').max)}`; });
$('seek').addEventListener('change', async () => {
  const to = +$('seek').value;   // before the wait: the loop moves the slider with the time
  seeking = true;
  $('clock').textContent = `${clock(to)} / ${clock(+$('seek').max)} · finding it…`;
  await paint();
  // The engine starts the match again from its first world and runs to there without showing it (0x10006270)
  M._pr_replay(R_SEEK, to, 0);
  replay.done = false;
  seeking = false;
});
$('replay-back').addEventListener('click', () => {
  save().then(() => { location.href = location.pathname + (filterText() ? '?player=' + encodeURIComponent(filterText()) : ''); });
});

// Saving the replay as an MP4 (public/player/footage.js, written by our own mp4.js): the whole match from
// its start at normal speed, as fast as the device can make it, then back to where the viewer was watching. The match is
// never shown while it is made: a panel with the progress covers the screen, which keeps the frame it had.
let saving = null;   // the AbortController while a video is being made
const REPLAY_CONTROLS = ['seek', 'replay-play', 'replay-skip', 'replay-voice', 'replay-fast', 'replay-back', 'replay-save'];
function showSaving(on) {
  for (const id of REPLAY_CONTROLS) $(id).disabled = on;
  $('seek').disabled = on || !replay.started;
  $('saving').hidden = !on;
  // A replay not started gets its cover back after
  $('cover').hidden = on || replay.started;
  if (on) {
    $('save-bar').value = 0;
    $('save-progress').textContent = 'Starting…';
    $('save-status').textContent = '';
  }
}
const duration = s => s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
$('replay-save').addEventListener('click', async () => {
  if (saving || !replay) return;
  $('save-status').textContent = 'Checking what this browser can encode…';
  let footage, support;
  try {
    footage = await import(new URL('public/player/footage.js', document.baseURI).href);
    support = await footage.footageSupport(M._pr_width(), M._pr_height());
  } catch (e) { $('save-status').textContent = 'The video maker could not load: ' + e.message; return; }
  if (support.why) { $('save-status').textContent = support.why; return; }
  const was = { t: M._pr_replay(R_TIME, 0, 0), playing: replay.playing };
  saving = new AbortController();
  showSaving(true);
  if (ctx) ctx.suspend();
  $('save-note').textContent = support.video.kind === 'vp9'
    ? 'As VP9, slowly: this browser has no H.264 encoder that works. Chrome makes it several times faster.' : '';
  const t0 = performance.now();
  let blob = null, err = null;
  try {
    // From the engine's first frame, not a seek to 0: the match's opening plays only then (footage.js)
    M._pr_stop();
    if (!startEngine(replay.args)) throw new Error('the replay did not start again: ' + M.UTF8ToString(M._pr_error()));
    blob = await footage.renderFootage(M, support, {
      signal: saving.signal,
      skip: $('replay-skip').checked,      // as the viewer has them: the same idle time cut as on screen
      voiceWaits: $('replay-voice').checked,
      progress: fraction => {
        const spent = (performance.now() - t0) / 1000;
        $('save-bar').value = fraction;
        // Time left once there is enough to go on; the speed is the match's seconds made a second
        const left = fraction >= 0.03 ? ` · about ${duration(Math.ceil(spent / fraction * (1 - fraction)))} left` : '';
        const speed = fraction >= 0.03 ? ` · ${(fraction * M._pr_replay(R_LENGTH, 0, 0) / spent).toFixed(1)}× real time` : '';
        $('save-progress').textContent = fraction > 0 ? `${Math.floor(fraction * 100)}%${left}${speed}` : 'Starting…';
      },
    });
  } catch (e) { err = e; }
  replay.done = false;
  if (replay.started) {
    // Back to where the viewer was (the engine runs there again without showing it)
    M._pr_replay(R_SEEK, was.t, 0);
    setPlaying(was.playing);
  } else {
    // Never started: the engine at its first frame again, so that Play shows the opening too, and a
    // black screen under the cover, not the match's last frame. Should it not start, Play says why
    // (pr_tick stops with pr_error).
    M._pr_stop();
    startEngine(replay.args);
    cv2d.fillStyle = '#000'; cv2d.fillRect(0, 0, $('screen').width, $('screen').height);
  }
  // Not awaited, and `saving` held until here: nothing may start a second video, or run the game, while this
  // one is being put away. A paused sound context can take a while to answer.
  if (ctx) ctx.resume().catch(() => {});
  resetClock();
  saving = null;
  showSaving(false);
  if (!blob) {
    $('save-status').textContent = err && err.name === 'AbortError' ? 'Stopped: no video saved.'
                                                                    : 'The video could not be made: ' + (err && err.message || err);
    if (err && err.name !== 'AbortError') console.warn('video', err);
    return;
  }
  const name = replay.match ? `match-${replay.match.id}.mp4` : 'replay.mp4';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  $('save-status').textContent = `Saved ${name}: ${(blob.size / 1048576).toFixed(1)} MB, made in ` +
    `${Math.round((performance.now() - t0) / 1000)} s${support.audio ? '' : ', without sound (this browser has no sound encoder)'}.`;
});
$('replay-save-cancel').addEventListener('click', () => { if (saving) saving.abort(); });

$('older').addEventListener('click', () => loadMatches(true));
$('watch-id').addEventListener('click', () => { const id = +$('match-id').value; if (id > 0) watch(id); });
$('match-id').addEventListener('keydown', e => { if (e.key === 'Enter') $('watch-id').click(); });
$('pick-replay').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch (err) { return listStatus('That is not a replay file.', true); }
  if (!d.engine) return listStatus('That is not a replay file.', true);
  watch(0, d);
});

// ---------------------------------------------------------------- start

if (!window.isSecureContext)
  status('This page needs a secure connection (https) for sound and video.', true);

if (typeof createPlayer !== 'function') {
  status('The player could not load.', true);
} else {
  createPlayer({ print: t => console.log(t), printErr: t => console.log(t) }).then(m => {
    M = m; FS = m.FS;
    FS.mkdir(ROOT);
    FS.mount(m.IDBFS, {}, ROOT);
    FS.syncfs(true, err => {
      if (err) status('This browser\'s storage could not be read: ' + err, true);
      showGame();
      $('import-controls').hidden = false;
      $('player-filter').value = params.get('player') || '';
      $('player-clear').hidden = !filterText();
      if (params.get('match')) $('match-id').value = params.get('match');
      loadMatches(false);
    });
  }).catch(e => status('The player could not load: ' + e, true));
}
})();
