// The video side of Footage (web/footage.js), on a thread of its own so the engine never waits for it:
// the page sends each frame as the core made it (pr_screen, 0x00RRGGBB words), and this makes the video
// frame from it and encodes it, while the page runs the engine on to the next frame. The encoded chunks
// go back to the page, which writes the file.
//
// Messages in:  { type: 'start', w, h, scale, W, H, config }   once, before any frame
//               { type: 'frame', screen, index, key }         screen: an ArrayBuffer, handed back when used
//               { type: 'flush' }                             after the last frame
// Messages out: { type: 'chunk', bytes, timestamp, duration, key, description }
//               { type: 'used', screen }                     the frame is with the encoder: the page may refill it
//               { type: 'flushed' } | { type: 'error', message }
//
// The frame is I420 in BT.709 limited range, each game pixel a scale x scale square, W x H (both even; the
// last game column and row fill any spare). Each 2x2 chroma sample takes the game pixel under its top-left,
// so colours never blend across a pixel's edge. Only the game rows that changed since the frame before are
// made again: most of a match is a board that hardly moves.
const FPS = 30;
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

let enc = null, maker = null, sent = false, failed = false;

const fail = e => {
  if (failed) return;
  failed = true;
  postMessage({ type: 'error', message: e && e.message || String(e) });
};

onmessage = async ({ data: m }) => {
  if (failed) return;
  try {
    if (m.type === 'start') {
      maker = i420Maker(m.w, m.h, m.scale, m.W, m.H);
      enc = new VideoEncoder({
        output: (chunk, meta) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          // The codec's setup (decoderConfig.description) comes with the first chunk; the file's track needs it
          const description = !sent ? descriptionOf(meta) : null;
          sent = true;
          postMessage({ type: 'chunk', bytes, timestamp: chunk.timestamp, duration: chunk.duration || 1e6 / FPS,
                        key: chunk.type === 'key', description }, [bytes.buffer]);
        },
        error: fail,
      });
      enc.configure(m.config);
    } else if (m.type === 'frame') {
      const yuv = maker(new Uint32Array(m.screen));
      const frame = new VideoFrame(yuv, { format: 'I420', codedWidth: maker.W, codedHeight: maker.H,
                                          timestamp: Math.round(m.index * 1e6 / FPS), duration: Math.round(1e6 / FPS),
                                          colorSpace: BT709 });
      enc.encode(frame, { keyFrame: m.key });
      frame.close();
      // The encoder works on threads of its own; when it falls behind, the page waits for it through this
      while (enc.encodeQueueSize > 4) await new Promise(r => enc.addEventListener('dequeue', r, { once: true }));
      postMessage({ type: 'used', screen: m.screen }, [m.screen]);
    } else if (m.type === 'flush') {
      await enc.flush();
      postMessage({ type: 'flushed' });
    }
  } catch (e) { fail(e); }
};

// A function that makes the I420 frame for a w x h screen into the same buffer each time
function i420Maker(w, h, scale, W, H) {
  const n = w * h, cw = W / 2, ch = H / 2;
  const out = new Uint8Array(W * H + 2 * cw * ch);
  const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];   // Y, U, V at the game's size
  const prev = new Uint32Array(n), dirty = new Uint8Array(h);
  // The game column and row under each output sample, for a plane whose samples are step pixels wide
  const under = (count, step, limit) => Int32Array.from({ length: count }, (_, i) => Math.min(Math.floor(i * step / scale), limit - 1));
  const layout = [
    { plane: planes[0], at: 0, dw: W, dh: H, cols: under(W, 1, w), rows: under(H, 1, h) },
    { plane: planes[1], at: W * H, dw: cw, dh: ch, cols: under(cw, 2, w), rows: under(ch, 2, h) },
    { plane: planes[2], at: W * H + cw * ch, dw: cw, dh: ch, cols: under(cw, 2, w), rows: under(ch, 2, h) },
  ];
  let first = true;
  const make = src => {
    const [py, pu, pv] = planes;
    let changed = false;
    for (let y = 0; y < h; y++) {
      let same = !first;
      for (let i = y * w, end = i + w; same && i < end; i++) same = src[i] === prev[i];
      dirty[y] = !same;
      if (same) continue;
      changed = true;
      for (let i = y * w, end = i + w; i < end; i++) {
        const p = prev[i] = src[i], r = p >>> 16 & 0xFF, g = p >>> 8 & 0xFF, b = p & 0xFF;
        py[i] = 16 + ((47 * r + 157 * g + 16 * b + 128) >> 8);
        pu[i] = 128 + ((-26 * r - 87 * g + 113 * b + 128) >> 8);
        pv[i] = 128 + ((112 * r - 102 * g - 10 * b + 128) >> 8);
      }
    }
    first = false;
    if (!changed) return out;
    // Rows that land on the same game row are copies of the one before
    for (const { plane, at, dw, dh, cols, rows } of layout) {
      for (let y = 0, last = -1; y < dh; y++) {
        const sy = rows[y];
        if (!dirty[sy]) continue;
        const row = at + y * dw;
        if (sy === last) { out.copyWithin(row, row - dw, row); continue; }
        last = sy;
        for (let x = 0, s = sy * w; x < dw; x++) out[row + x] = plane[s + cols[x]];
      }
    }
    return out;
  };
  make.W = W;
  make.H = H;
  return make;
}

function descriptionOf(meta) {
  const d = meta && meta.decoderConfig && meta.decoderConfig.description;
  if (!d) return null;
  return d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}
