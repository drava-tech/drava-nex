import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { videoLengthSeconds } from "../src/services/video-length.js";

// Minimal files carrying just the headers the reader looks at.
const box = (type: string, payload: Buffer) => {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, "latin1");
  payload.copy(b, 8);
  return b;
};
function mvhdV0(timescale: number, duration: number) {
  const p = Buffer.alloc(100);
  p.writeUInt8(0, 0); // version
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(duration, 16);
  return box("mvhd", p);
}
function mvhdV1(timescale: number, duration: bigint) {
  const p = Buffer.alloc(112);
  p.writeUInt8(1, 0);
  p.writeUInt32BE(timescale, 20);
  p.writeBigUInt64BE(duration, 24);
  return box("mvhd", p);
}
const ftyp = box("ftyp", Buffer.from("isom0000isomiso2", "latin1"));
const mdat = box("mdat", Buffer.alloc(5000, 1));

/** An EBML element: id bytes, a 1-byte size (data < 127 bytes) or 8-byte size, data. */
function ebml(id: number[], data: Buffer, unknownSize = false) {
  const size = unknownSize
    ? Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    : data.length < 127
      ? Buffer.from([0x80 | data.length])
      : (() => {
          const s = Buffer.alloc(8);
          s[0] = 0x01;
          s.writeUIntBE(data.length, 2, 6);
          return s;
        })();
  return Buffer.concat([Buffer.from(id), size, data]);
}
function webm(durationMs: number, timecodeScale?: number) {
  const dur = Buffer.alloc(8);
  dur.writeDoubleBE(durationMs, 0);
  const infoChildren = [
    ...(timecodeScale ? [ebml([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40].map((x) => x)))] : []),
    ebml([0x44, 0x89], dur),
  ];
  const info = ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat(infoChildren));
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x86, 0x81, 0x01]));
  const segment = ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, Buffer.alloc(300)]), true);
  return Buffer.concat([header, segment]);
}

let dir: string;
const file = (name: string, data: Buffer) => {
  const p = path.join(dir, name);
  writeFileSync(p, data);
  return p;
};
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "video-length-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("videoLengthSeconds", () => {
  it("reads an MP4 with its header at the start", async () => {
    const p = file("start.mp4", Buffer.concat([ftyp, box("moov", mvhdV0(1000, 65_500)), mdat]));
    expect(await videoLengthSeconds(p)).toBeCloseTo(65.5);
  });

  it("reads an MP4 whose header is after the video data", async () => {
    const p = file("end.mp4", Buffer.concat([ftyp, mdat, box("moov", mvhdV0(600, 600 * 125))]));
    expect(await videoLengthSeconds(p)).toBeCloseTo(125);
  });

  it("reads a version-1 (64-bit) MOV header", async () => {
    const p = file("v1.mov", Buffer.concat([ftyp, box("moov", mvhdV1(90_000, 90_000n * 3600n))]));
    expect(await videoLengthSeconds(p)).toBeCloseTo(3600);
  });

  it("reads a WebM's Duration", async () => {
    expect(await videoLengthSeconds(file("a.webm", webm(42_250)))).toBeCloseTo(42.25);
    expect(await videoLengthSeconds(file("b.webm", webm(10_000, 1_000_000)))).toBeCloseTo(10);
  });

  it("gives up cleanly on anything else", async () => {
    expect(await videoLengthSeconds(file("x.mp4", Buffer.concat([ftyp, mdat])))).toBeNull(); // no moov
    expect(await videoLengthSeconds(file("junk.bin", Buffer.from("not a video at all")))).toBeNull();
    expect(await videoLengthSeconds(path.join(dir, "missing.mp4"))).toBeNull();
  });
});
