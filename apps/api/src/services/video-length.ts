import { promises as fs } from "node:fs";

/**
 * A video file's length in seconds, read from its header — no ffmpeg, no
 * decoding. Covers what the media library accepts for video:
 *
 *   MP4 / MOV  the movie header box: moov > mvhd (timescale + duration);
 *              moov may sit at the start or the end of the file.
 *   WebM / MKV the Segment > Info element: Duration × TimecodeScale.
 *
 * Returns null when the file can't be read or isn't one of those.
 */
export async function videoLengthSeconds(filePath: string): Promise<number | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();
    const head = await read(handle, 0, Math.min(size, 16));
    if (head.length < 8) return null;
    if (head.readUInt32BE(0) === 0x1a45dfa3) return await webmLength(handle, size);
    return await mp4Length(handle, size);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function read(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await handle.read(buf, 0, buf.length, position);
  return buf.subarray(0, bytesRead);
}

// ─── MP4 / MOV ───────────────────────────────────────────────────────────────

/** Walk boxes in [start, end) and return the first of `type`: its payload range. */
async function findBox(
  handle: fs.FileHandle,
  start: number,
  end: number,
  type: string
): Promise<{ start: number; end: number } | null> {
  let pos = start;
  while (pos + 8 <= end) {
    const header = await read(handle, pos, 16);
    if (header.length < 8) return null;
    let boxSize = header.readUInt32BE(0);
    const boxType = header.toString("latin1", 4, 8);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.length < 16) return null;
      boxSize = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - pos; // runs to the end of its parent
    }
    if (boxSize < headerSize) return null; // corrupt
    if (boxType === type) return { start: pos + headerSize, end: Math.min(end, pos + boxSize) };
    pos += boxSize;
  }
  return null;
}

async function mp4Length(handle: fs.FileHandle, size: number): Promise<number | null> {
  const moov = await findBox(handle, 0, size, "moov");
  if (!moov) return null;
  const mvhd = await findBox(handle, moov.start, moov.end, "mvhd");
  if (!mvhd) return null;
  const body = await read(handle, mvhd.start, 32);
  if (body.length < 20) return null;
  const version = body.readUInt8(0);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (body.length < 32) return null;
    timescale = body.readUInt32BE(20);
    duration = Number(body.readBigUInt64BE(24));
  } else {
    timescale = body.readUInt32BE(12);
    duration = body.readUInt32BE(16);
  }
  if (!timescale || !duration || duration === 0xffffffff) return null;
  return duration / timescale;
}

// ─── WebM / Matroska (EBML) ──────────────────────────────────────────────────

const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

/** An EBML variable-length integer at `pos`: its value and byte length (marker kept for ids). */
function vint(buf: Buffer, pos: number, keepMarker: boolean): { value: number; length: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos]!;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || pos + length > buf.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + buf[pos + i]!;
  return { value, length };
}

async function webmLength(handle: fs.FileHandle, size: number): Promise<number | null> {
  // Info sits near the start of the Segment; the first 512 KB is plenty.
  const buf = await read(handle, 0, Math.min(size, 512 * 1024));

  /** Step through sibling elements in [start, end), calling `visit` on each. */
  const walk = (start: number, end: number, visit: (id: number, dataStart: number, dataLength: number) => boolean) => {
    let pos = start;
    while (pos < end) {
      const id = vint(buf, pos, true);
      if (!id) return;
      const len = vint(buf, pos + id.length, false);
      if (!len) return;
      const dataStart = pos + id.length + len.length;
      // An "unknown" size (all ones) runs to the end of what we have.
      const dataLength = Math.min(len.value, buf.length - dataStart);
      if (visit(id.value, dataStart, dataLength)) return;
      pos = dataStart + dataLength;
    }
  };

  let info: { start: number; end: number } | null = null;
  walk(0, buf.length, (id, start, length) => {
    if (id !== EBML_SEGMENT) return false;
    walk(start, start + length, (child, cStart, cLength) => {
      if (child !== EBML_INFO) return false;
      info = { start: cStart, end: cStart + cLength };
      return true;
    });
    return true;
  });
  if (!info) return null;
  const { start, end } = info as { start: number; end: number };

  let scale = 1_000_000; // default TimecodeScale: 1 ms, in ns
  let duration: number | null = null;
  walk(start, end, (id, dataStart, length) => {
    if (id === EBML_TIMECODE_SCALE && length >= 1 && length <= 6) scale = buf.readUIntBE(dataStart, length);
    if (id === EBML_DURATION) {
      duration = length === 4 ? buf.readFloatBE(dataStart) : length === 8 ? buf.readDoubleBE(dataStart) : null;
    }
    return false;
  });
  const d = duration as number | null;
  if (!d || !Number.isFinite(d) || d <= 0) return null;
  return (d * scale) / 1e9;
}
