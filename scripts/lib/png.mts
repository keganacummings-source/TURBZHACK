/**
 * Just enough PNG to look at a sprite's pixels.
 *
 * The tests need to assert things about how the art LOOKS — that a ground tile
 * is not so dark it reads as a hole in the map — and checking that means
 * decoding pixels, not just reading the header. Adding an image library for it
 * would be the first dependency in a project whose whole point is not having
 * any, and `zlib` is in Node already, so the decoder lives here instead.
 *
 * It handles exactly what `tools/import-dcss.py` writes: 8-bit RGBA, no
 * interlacing. Anything else throws rather than returning quietly wrong
 * numbers, because a silently mis-decoded sprite would make the assertions
 * meaningless.
 */
import { inflateSync } from "node:zlib";

export type Pixels = {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Buffer;
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode an 8-bit RGBA, non-interlaced PNG. */
export function decodePng(buf: Buffer): Pixels {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let width = 0, height = 0, depth = 0, colour = -1, interlace = 0;
  const idat: Buffer[] = [];

  // Walk the chunks. Each is length, type, data, crc.
  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + len;
  }

  if (depth !== 8) throw new Error(`bit depth ${depth} is not supported`);
  if (colour !== 6) throw new Error(`colour type ${colour} is not RGBA`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);

  /*
   * Undo the per-row filters.
   *
   * PNG predicts each byte from its neighbours and stores the difference, so
   * the rows have to be reconstructed in order: every filter but None reads
   * bytes this loop has already written.
   */
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= 4 ? out[dst + i - 4]! : 0;          // the pixel to the left
      const b = y > 0 ? out[dst - stride + i]! : 0;      // the pixel above
      const c = y > 0 && i >= 4 ? out[dst - stride + i - 4]! : 0;  // above-left
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          // Paeth: whichever of the three neighbours the gradient points at.
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown row filter ${filter}`);
      }
      out[dst + i] = value & 0xff;
    }
  }

  return { width, height, data: out };
}

/**
 * The mean of the RGB channels over the pixels that are actually there.
 *
 * Transparent pixels are skipped: an item sprite sitting on a transparent
 * background would otherwise measure as nearly black no matter how bright the
 * item is. Returns 0 for a fully transparent sprite.
 */
export function meanLuma(px: Pixels): number {
  let total = 0, seen = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    if (px.data[i + 3]! === 0) continue;
    total += px.data[i]! + px.data[i + 1]! + px.data[i + 2]!;
    seen++;
  }
  return seen ? total / (3 * seen) : 0;
}

/** How much of the sprite is drawn at all, 0-1. */
export function coverage(px: Pixels): number {
  let seen = 0;
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i]! > 0) seen++;
  return seen / (px.width * px.height);
}
