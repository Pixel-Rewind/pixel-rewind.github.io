// Footage: the replay being watched, rendered to an MP4 file in the browser (docs/REPLAY.md). The
// engine runs on the fixed clock (web/player.c), so it is stepped as fast as the device allows rather
// than in real time: every engine frame is one video frame at exactly 30 a second, and the sound for
// it is the core's own 48 kHz output, 1600 samples a frame, as the page plays it. WebCodecs encodes
// both and web/mp4.js, our own writer, puts them in the file; no library and nothing leaves the page.
//
// Video is H.264 (VP9 where a browser has none that works: Firefox on Fedora), the game's pixels scaled
// up three times without smoothing so they stay square. Each frame is made at that size in the encoder's
// own format, I420, and encoded on a thread of its own (web/footage-worker.js), so no canvas and no GPU
// are involved and the engine runs on while the frame before is encoded: the page's thread only runs the
// engine. Sound is AAC, or Opus where the browser has no AAC encoder (Chrome and Firefox on Linux).
import { Mp4Writer } from './mp4.js';

const FPS = 30, RATE = 48000, PER_FRAME = RATE / FPS;
const SCALE = 3;
const KEY_EVERY = 2 * FPS;         // a key frame every 2 s, so editors seek quickly
const HOLD = FPS;                  // a second after the end, a clean tail to cut on
const LIMIT = 3 * 60 * 60 * FPS;   // never more than 3 hours, whatever the replay says
const WARMUP = 2 * 60 * FPS;       // the engine's own way to its replay session: never more than 2 minutes
const YIELD_MS = 50;              // the page gets the main thread back this often (progress, Cancel)
const SCREENS = 6;                 // frames on their way to the video thread at most
const R_TIME = 0, R_LENGTH = 1, R_PLAY = 2, R_SEEK = 3, R_MODE = 4, R_BUSY = 5, R_VOICE = 6;   // pr_replay (web/player.c)
// The video frames' colours (web/footage-worker.js), for the encoder to write into the file
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

const VIDEO = [
  { codec: 'avc1.640028', kind: 'avc', avc: { format: 'avc' } },   // High, level 4.0
  { codec: 'avc1.4d0028', kind: 'avc', avc: { format: 'avc' } },   // Main
  { codec: 'avc1.42e028', kind: 'avc', avc: { format: 'avc' } },   // Baseline
  { codec: 'vp09.00.40.08', kind: 'vp9' },
];
const AUDIO = [
  { codec: 'mp4a.40.2', kind: 'aac', aac: { format: 'aac' } },
  { codec: 'opus', kind: 'opus' },
];

// The video's size for a w x h game screen: three times larger, and even, as I420 needs
const videoSize = (w, h) => [(w * SCALE + 1) & ~1, (h * SCALE + 1) & ~1];

// The settings this browser can encode for a w x h game screen, or a reason it can't. Each one is
// tried on a frame first: Firefox on Fedora says yes to H.264 and then fails on the first frame
// ("The given encoding is not supported"), because its system codec library has no H.264 encoder.
export async function footageSupport(w, h) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined')
    return { why: 'This browser cannot make videos (it has no WebCodecs).' };
  if (!isSecureContext)
    return { why: 'Saving a video needs the page on https or localhost.' };
  const [width, height] = videoSize(w, h);
  const bitrate = Math.round(width * height * FPS * 0.05);   // about 2.5 Mbit/s at 1704x960: flat pixel art needs little
  let video = null, audio = null;
  for (const v of VIDEO) {
    const config = { ...v, width, height, bitrate, framerate: FPS };
    delete config.kind;
    if (await encodes(VideoEncoder, config, () => blankFrame(width, height))) { video = { kind: v.kind, config }; break; }
  }
  for (const a of AUDIO) {
    const config = { ...a, sampleRate: RATE, numberOfChannels: 1, bitrate: 128000 };
    delete config.kind;
    if (await encodes(AudioEncoder, config, () => new AudioData({ format: 'f32', sampleRate: RATE, numberOfChannels: 1,
                                                                   numberOfFrames: PER_FRAME, timestamp: 0, data: new Float32Array(PER_FRAME) }))) {
      audio = { kind: a.kind, config };
      break;
    }
  }
  if (!video) return { why: 'This browser has no video encoder for H.264 or VP9.' };
  return { video, audio };   // audio null: a silent video
}

// Whether an encoder takes this config and makes something of one input: the browser says so, and it does
async function encodes(Encoder, config, input) {
  try {
    if (!(await Encoder.isConfigSupported(config)).supported) return false;
  } catch (e) { return false; }
  let chunks = 0, failed = false, encoder = null;
  try {
    encoder = new Encoder({ output: () => chunks++, error: () => { failed = true; } });
    encoder.configure(config);
    const item = input();
    encoder.encode(item, Encoder === VideoEncoder ? { keyFrame: true } : undefined);
    item.close();
    // An encoder that has failed may never settle its flush
    await Promise.race([encoder.flush(), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 10000))]);
  } catch (e) { failed = true; }
  if (encoder && encoder.state !== 'closed') try { encoder.close(); } catch (e) {}
  return !failed && chunks > 0;
}

// A black frame in I420
function blankFrame(width, height) {
  const data = new Uint8Array(width * height * 3 / 2);
  data.fill(16, 0, width * height);
  data.fill(128, width * height);
  return new VideoFrame(data, { format: 'I420', codedWidth: width, codedHeight: height, timestamp: 0, colorSpace: BT709 });
}

// Renders the replay that M (the player module) has just started, no frame run yet, and resolves with
// the MP4 as a Blob. The replay is left playing at its end; the page puts it back where the viewer was.
// signal: an AbortSignal (Cancel); progress(fraction, frames) every time the page gets the thread back;
// skip, fast: the replay player's two modes (skip the waits, twice the speed). skip jumps the replay's clock over
// the time nobody did anything, to half a second before the next move, while the board is still; the frames go
// on being made, so the video shows a still board for that half second and moves on (checked 2026-10-25).
// voiceWaits: the original's pacing, each phase waiting for the announcer to finish (replay_set_voice_waits).
// The mode is always set here: left alone, the engine's own defaults apply and a seek resets them.
export async function renderFootage(M, support, { signal, progress, skip = true, fast = false, voiceWaits = false }) {
  const w = M._pr_width(), h = M._pr_height(), [W, H] = videoSize(w, h), SCREEN = w * h * 4;
  const mp4 = new Mp4Writer();
  let failed = null;
  const fail = e => { failed = failed || e; wake(); };

  // The video thread and the sound encoder hand their output straight to the file. The first chunk carries
  // the codec's setup (decoderConfig.description), which the file's track needs, so tracks are made then.
  let vtrack = null, atrack = null, flushed = false;
  const free = [];           // screens back from the video thread, to fill again
  let made = 0;              // screens made so far, at most SCREENS
  let waiting = null;        // the engine, waiting for the video thread
  const wake = () => { if (waiting) { waiting(); waiting = null; } };
  const video = new Worker(new URL('./footage-worker.js', import.meta.url), { type: 'module' });
  video.onmessage = ({ data: m }) => {
    if (m.type === 'chunk') {
      if (!vtrack) vtrack = mp4.addVideo({ codec: support.video.kind, width: W, height: H, config: m.description });
      mp4.add(vtrack, m.bytes, m.timestamp, m.duration, m.key);
    } else if (m.type === 'used') {
      free.push(m.screen);
      wake();
    } else if (m.type === 'flushed') {
      flushed = true;
      wake();
    } else if (m.type === 'error') fail(new Error(m.message));
  };
  video.onerror = e => fail(new Error('The video thread failed: ' + (e.message || 'it could not start')));
  video.postMessage({ type: 'start', w, h, scale: SCALE, W, H, config: support.video.config });
  const backFromVideo = () => new Promise(resolve => { waiting = resolve; });
  signal.addEventListener('abort', wake, { once: true });   // Cancel, while the engine waits for the video thread
  const aenc = support.audio && new AudioEncoder({
    output: (chunk, meta) => {
      if (!atrack) atrack = mp4.addAudio({ codec: support.audio.kind, sampleRate: RATE, channels: 1, config: description(meta) });
      mp4.add(atrack, bytesOf(chunk), chunk.timestamp, chunk.duration || 0, true);
    },
    error: fail,
  });
  if (aenc) aenc.configure(support.audio.config);

  const close = () => {
    video.terminate();
    if (aenc && aenc.state !== 'closed') try { aenc.close(); } catch (err) {}
  };
  try {
    // The engine has just been started on the replay (pr_stop, then pr_start_replay): its session is made
    // on its first frames (loading, the replay screen; 4 frames for match 68), which run here unseen and
    // unheard. The video starts with the session, so it has the match's opening: the banner, the
    // announcer, the blocks dropping. A seek to 0 would skip all that: it restores the board as the
    // first turn starts, and the video then stood still for the opening's length (2026-10-25).
    const bytes = M._pr_audio_bytes();
    for (let n = 0, yielded = performance.now(); M._pr_replay(R_LENGTH, 0, 0) <= 0; n++) {
      signal.throwIfAborted();
      if (n >= WARMUP) throw new Error('The replay did not start.');
      if (M._pr_tick(0) !== 1) throw new Error('The game stopped: ' + M.UTF8ToString(M._pr_error()));
      for (let s = 0; s < PER_FRAME; s += bytes / 2) M._pr_audio();
      if (performance.now() - yielded >= YIELD_MS) { progress(0, 0); await nextTask(); yielded = performance.now(); }
    }
    // At normal speed. The engine takes the mode only once its replay session exists, and starts the session over (back
    // to its default, skip waits) at a seek, whenever that lands. So the mode is set before every frame,
    // which costs next to nothing: set once, a video would run through the match at several times its speed.
    M._pr_replay(R_PLAY, 1, 0);
    let frames = 0, samples = 0, end = Infinity, yielded = performance.now();
    while (frames < end) {
      if (failed) throw failed;
      signal.throwIfAborted();
      M._pr_replay(R_MODE, skip ? 1 : 0, fast ? 1 : 0);
      M._pr_replay(R_VOICE, voiceWaits ? 1 : 0, 0);
      const r = M._pr_tick(0);
      if (r !== 1) throw new Error('The game stopped: ' + M.UTF8ToString(M._pr_error()));
      // The sound this frame made, then its picture: the order the page plays them in
      while (samples < (frames + 1) * PER_FRAME) {
        const p = M._pr_audio();
        const s16 = new Int16Array(M.HEAPU8.buffer, p, bytes / 2);
        if (aenc) {
          const f = new Float32Array(s16.length);
          for (let i = 0; i < s16.length; i++) f[i] = s16[i] / 32768;
          const data = new AudioData({ format: 'f32', sampleRate: RATE, numberOfChannels: 1, numberOfFrames: f.length,
                                       timestamp: Math.round(samples * 1e6 / RATE), data: f });
          aenc.encode(data);
          data.close();
        }
        samples += s16.length;
      }
      // The picture goes to the video thread in a screen it handed back, or a new one while there are few
      while (!free.length && made >= SCREENS) {
        await backFromVideo();
        if (failed) throw failed;
      }
      const screen = free.length ? free.pop() : (made++, new ArrayBuffer(SCREEN));
      const p = M._pr_screen();
      new Uint8Array(screen).set(M.HEAPU8.subarray(p, p + SCREEN));
      video.postMessage({ type: 'frame', screen, index: frames, key: frames % KEY_EVERY === 0 }, [screen]);
      frames++;

      // Over as the 2008 player screen saw it: its time is up and the board is still (web/player.html)
      const t = M._pr_replay(R_TIME, 0, 0), len = M._pr_replay(R_LENGTH, 0, 0);
      if (end === Infinity && len > 0 && t >= len && !M._pr_replay(R_BUSY, 0, 0)) end = frames + HOLD;
      if (frames >= LIMIT) throw new Error('The replay did not end within 3 hours.');

      // The sound encoder works beside the engine too; when it falls behind, the engine waits for it
      while (aenc && aenc.encodeQueueSize > 16) {
        await nextTask();
        if (failed) throw failed;
      }
      if (performance.now() - yielded >= YIELD_MS) {
        progress(len > 0 ? Math.min(t / len, 1) : 0, frames);
        await nextTask();
        yielded = performance.now();
      }
    }
    video.postMessage({ type: 'flush' });
    while (!flushed && !failed) await backFromVideo();
    if (aenc) await aenc.flush();
    if (failed) throw failed;
    signal.throwIfAborted();   // Cancel, pressed while the encoders were finishing
    if (!vtrack) throw new Error('The video encoder gave no frames.');
    return mp4.finish();
  } finally {
    close();
  }
}

function description(meta) {
  const d = meta && meta.decoderConfig && meta.decoderConfig.description;
  if (!d) return null;
  return d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

function bytesOf(chunk) {   // the sound's chunks
  const b = new Uint8Array(chunk.byteLength);
  chunk.copyTo(b);
  return b;
}

// The next task, not a timer: browsers slow timers in a hidden tab to one a second, but not messages
const nextTask = () => new Promise(resolve => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => { port1.close(); resolve(); };
  port2.postMessage(null);
});
