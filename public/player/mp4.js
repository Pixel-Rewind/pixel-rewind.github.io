// An MP4 file writer for footage (web/footage.js): our own, so the page needs no muxing library. It
// takes the encoded samples WebCodecs makes (H.264 or VP9 video; AAC or Opus sound) and writes one
// ISO BMFF file (ISO/IEC 14496-12, -14 for AAC, -15 for H.264; the VP9 and Opus "in ISOBMFF" specs):
// ftyp, then moov, then one mdat with every sample in the order it was added, so the file plays from
// its start while it downloads ("fast start") and video editors take it as it is. The samples stay in
// memory until finish().
//
//   const mp4 = new Mp4Writer();
//   const v = mp4.addVideo({ codec: 'avc', width, height, config });  // config: decoderConfig.description
//   const a = mp4.addAudio({ codec: 'opus', sampleRate, channels, config });
//   mp4.add(v, bytes, timestampUs, durationUs, keyFrame);
//   const blob = mp4.finish();

const MOVIE_TIMESCALE = 1000;
const VIDEO_TIMESCALE = 30000;   // a 30 fps frame is exactly 1000
const OPUS_PRE_SKIP = 312;       // libopus at 48 kHz, when the encoder gives no OpusHead

// ---------------------------------------------------------------- bytes

class Bytes {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 0xff); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  u24(v) { return this.u8(v >> 16).u8(v >> 8).u8(v); }
  u32(v) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
  u64(v) { return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0); }
  str(s) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  zeros(n) { for (let i = 0; i < n; i++) this.u8(0); return this; }
  bytes(b) { for (const v of b) this.u8(v); return this; }
  done() { return Uint8Array.from(this.a); }
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

function box(type, ...parts) {
  const body = concat(parts);
  return concat([new Bytes().u32(8 + body.length).str(type).done(), body]);
}
const fullBox = (type, version, flags, ...parts) => box(type, new Bytes().u8(version).u24(flags).done(), ...parts);

// The unity matrix of mvhd and tkhd
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
const matrix = b => { for (const v of MATRIX) b.u32(v); return b; };

// ---------------------------------------------------------------- tracks

export class Mp4Writer {
  constructor() {
    this.tracks = [];
    this.data = [];      // every sample's bytes, in the order added: the mdat
    this.dataSize = 0;
  }

  // codec 'avc' (config: the AVCDecoderConfigurationRecord) or 'vp9' (config unused)
  addVideo({ codec, width, height, config }) {
    return this.track({ kind: 'video', codec, width, height, config, timescale: VIDEO_TIMESCALE });
  }

  // codec 'aac' (config: the AudioSpecificConfig) or 'opus' (config: OpusHead, if the encoder gave one)
  addAudio({ codec, sampleRate, channels, config }) {
    return this.track({ kind: 'audio', codec, sampleRate, channels, config, timescale: sampleRate });
  }

  track(t) {
    t.id = this.tracks.length + 1;
    t.samples = [];      // { pts, dur, size, key, offset } in the track's timescale; offset into the mdat's data
    this.tracks.push(t);
    return t;
  }

  add(track, bytes, timestampUs, durationUs, key) {
    const ts = track.timescale;
    track.samples.push({ pts: Math.round(timestampUs * ts / 1e6), dur: Math.round(durationUs * ts / 1e6),
                         size: bytes.length, key: !!key, offset: this.dataSize });
    this.data.push(bytes);
    this.dataSize += bytes.length;
  }

  finish() {
    // Video first, whichever encoder spoke first: editors and players take track 1 as the picture
    this.tracks.sort((a, b) => (a.kind === 'video' ? 0 : 1) - (b.kind === 'video' ? 0 : 1));
    this.tracks.forEach((t, i) => { t.id = i + 1; });
    const ftyp = box('ftyp', new Bytes().str('isom').u32(0x200).str('isomiso2avc1mp41').done());
    const large = this.dataSize + 8 > 0xffffffff;
    const mdatHead = large ? new Bytes().u32(1).str('mdat').u64(this.dataSize + 16).done()
                           : new Bytes().u32(this.dataSize + 8).str('mdat').done();
    // The chunk offsets count from the file's start, and moov comes before the mdat, so its own size
    // decides them: built once to measure it, and again with the true offsets (the same size).
    const tables = this.tracks.map(t => this.tables(t));
    let moov = this.moov(tables, 0);
    moov = this.moov(tables, ftyp.length + moov.length + mdatHead.length);
    return new Blob([ftyp, moov, mdatHead, ...this.data], { type: 'video/mp4' });
  }

  // Decoding times, durations and composition offsets. Video frames come out of an encoder in
  // decoding order with their presentation times; the decoding times are those times, sorted, so a
  // stream with B-frames gets the offsets it needs (ctts) and one without gets none.
  tables(t) {
    const s = t.samples;
    const dts = s.map(x => x.pts).sort((a, b) => a - b);
    const shift = dts.length ? dts[0] : 0;
    const durs = s.map((x, i) => i + 1 < s.length ? dts[i + 1] - dts[i] : Math.max(1, x.dur));
    const offsets = s.map((x, i) => x.pts - dts[i]);
    const total = durs.reduce((n, d) => n + d, 0);
    return { t, dts: dts.map(d => d - shift), durs, offsets, total, shift };
  }

  moov(tables, dataStart) {
    const movieDur = Math.max(0, ...tables.map(x => Math.round((x.total - this.trimmed(x.t)) * MOVIE_TIMESCALE / x.t.timescale)));
    const mvhd = fullBox('mvhd', 0, 0, matrix(new Bytes().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movieDur)
      .u32(0x10000).u16(0x100).zeros(10)).zeros(24).u32(this.tracks.length + 1).done());
    return box('moov', mvhd, ...tables.map(x => this.trak(x, dataStart)));
  }

  // Opus starts with samples the decoder needs but nobody should hear (its pre-skip), cut by the edit list
  trimmed(t) {
    if (t.codec !== 'opus') return 0;
    const c = t.config;
    return c && c.length >= 12 && String.fromCharCode(...c.subarray(0, 8)) === 'OpusHead' ? c[10] | c[11] << 8 : OPUS_PRE_SKIP;
  }

  trak(x, dataStart) {
    const t = x.t, video = t.kind === 'video';
    const skip = this.trimmed(t);
    const dur = Math.round((x.total - skip) * MOVIE_TIMESCALE / t.timescale);
    const tkhd = fullBox('tkhd', 0, 3, matrix(new Bytes().u32(0).u32(0).u32(t.id).u32(0).u32(dur).zeros(8)
      .u16(0).u16(0).u16(video ? 0 : 0x100).u16(0)).u32(video ? t.width << 16 : 0).u32(video ? t.height << 16 : 0).done());
    // The edit list: the whole track, after what Opus asks to cut
    const elst = fullBox('elst', 0, 0, new Bytes().u32(1).u32(dur).u32(skip).u32(0x10000).done());
    const mdhd = fullBox('mdhd', 0, 0, new Bytes().u32(0).u32(0).u32(t.timescale).u32(x.total).u16(0x55c4).u16(0).done());
    const hdlr = fullBox('hdlr', 0, 0, new Bytes().u32(0).str(video ? 'vide' : 'soun').zeros(12)
      .str(video ? 'VideoHandler' : 'SoundHandler').u8(0).done());
    const mhd = video ? fullBox('vmhd', 0, 1, new Bytes().zeros(8).done()) : fullBox('smhd', 0, 0, new Bytes().zeros(4).done());
    const dinf = box('dinf', fullBox('dref', 0, 0, new Bytes().u32(1).done(), fullBox('url ', 0, 1)));
    const stbl = box('stbl', this.stsd(t), ...this.sampleTables(x, dataStart));
    return box('trak', tkhd, box('edts', elst), box('mdia', mdhd, hdlr, box('minf', mhd, dinf, stbl)));
  }

  stsd(t) {
    let entry;
    if (t.kind === 'video') {
      const head = new Bytes().zeros(6).u16(1).u16(0).u16(0).zeros(12).u16(t.width).u16(t.height)
        .u32(0x480000).u32(0x480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff).done();
      entry = t.codec === 'avc' ? box('avc1', head, box('avcC', t.config))
                                : box('vp09', head, vpcC());
    } else {
      const head = new Bytes().zeros(6).u16(1).zeros(8).u16(t.channels).u16(16).u16(0).u16(0).u32(t.sampleRate << 16 >>> 0).done();
      entry = t.codec === 'aac' ? box('mp4a', head, esds(t))
                                : box('Opus', head, box('dOps', new Bytes().u8(0).u8(t.channels).u16(this.trimmed(t))
                                    .u32(t.sampleRate).u16(0).u8(0).done()));
    }
    return fullBox('stsd', 0, 0, new Bytes().u32(1).done(), entry);
  }

  sampleTables(x, dataStart) {
    const s = x.t.samples;
    const runs = (values) => {   // [count, value] pairs, as stts and ctts store them
      const out = [];
      for (const v of values) {
        if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++;
        else out.push([1, v]);
      }
      return out;
    };
    const stts = runs(x.durs);
    const tables = [fullBox('stts', 0, 0, stts.reduce((b, [n, d]) => b.u32(n).u32(d), new Bytes().u32(stts.length)).done())];
    if (x.t.kind === 'video' && s.some(v => !v.key)) {
      const keys = s.map((v, i) => v.key ? i + 1 : 0).filter(Boolean);
      tables.push(fullBox('stss', 0, 0, keys.reduce((b, k) => b.u32(k), new Bytes().u32(keys.length)).done()));
    }
    if (x.offsets.some(o => o)) {   // version 1: offsets may be negative
      const ctts = runs(x.offsets);
      tables.push(fullBox('ctts', 1, 0, ctts.reduce((b, [n, o]) => b.u32(n).u32(o >>> 0), new Bytes().u32(ctts.length)).done()));
    }
    // One sample a chunk: each has its own offset, so the two tracks interleave however they were added
    tables.push(fullBox('stsc', 0, 0, new Bytes().u32(1).u32(1).u32(1).u32(1).done()));
    tables.push(fullBox('stsz', 0, 0, s.reduce((b, v) => b.u32(v.size), new Bytes().u32(0).u32(s.length)).done()));
    const last = dataStart + this.dataSize;
    if (last <= 0xffffffff)
      tables.push(fullBox('stco', 0, 0, s.reduce((b, v) => b.u32(dataStart + v.offset), new Bytes().u32(s.length)).done()));
    else
      tables.push(fullBox('co64', 0, 0, s.reduce((b, v) => b.u64(dataStart + v.offset), new Bytes().u32(s.length)).done()));
    return tables;
  }
}

// VP9's configuration (vp09.00.40.08): profile 0, level 4.0, 8 bits, 4:2:0, BT.709, limited range
function vpcC() {
  return fullBox('vpcC', 1, 0, new Bytes().u8(0).u8(40).u8(8 << 4 | 1 << 1 | 0).u8(1).u8(1).u8(1).u16(0).done());
}

// AAC's elementary stream descriptor around its AudioSpecificConfig (an encoder that gives none:
// AAC-LC at the track's rate and channels)
function esds(t) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const asc = t.config && t.config.length ? t.config
    : new Bytes().u16(2 << 11 | Math.max(0, rates.indexOf(t.sampleRate)) << 7 | t.channels << 3).done();
  const desc = (tag, body) => concat([new Bytes().u8(tag).u8(body.length).done(), body]);   // every one here is under 128 bytes
  const dsi = desc(5, asc);
  const dcd = desc(4, concat([new Bytes().u8(0x40).u8(0x15).u24(0).u32(0).u32(0).done(), dsi]));
  const es = desc(3, concat([new Bytes().u16(0).u8(0).done(), dcd, desc(6, Uint8Array.of(2))]));
  return fullBox('esds', 0, 0, es);
}
