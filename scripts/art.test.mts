/**
 * The art, and the content that points at it.
 *
 * A sprite the game asks for and cannot find is not a crash — the atlas falls
 * back to a flat colour on purpose — which is exactly why it needs a test. A
 * monster that silently renders as a mauve square would otherwise ship.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRegistry } from "./lib/harness.mts";
import { spriteKeys } from "../src/content/load-web.ts";
import { coverage, decodePng, meanLuma } from "./lib/png.mts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "assets/tiles16");
const reg = loadRegistry();

const have = new Set(
  readdirSync(ART).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)),
);

test("there is art, and all of it is 16x16", () => {
  assert.ok(have.size > 80, `only ${have.size} sprites`);
  // A PNG's width and height are big-endian 32-bit ints at bytes 16 and 20.
  for (const name of have) {
    const buf = readFileSync(join(ART, `${name}.png`));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w, 16, `${name}.png is ${w}px wide, not 16`);
    assert.equal(h, 16, `${name}.png is ${h}px tall, not 16`);
  }
});

test("every sprite a content file names actually exists", () => {
  const missing: string[] = [];
  const check = (kind: string, id: string, sprite: string | undefined) => {
    const key = sprite ?? id;
    if (!have.has(key)) missing.push(`content/${kind}/${id}.json points at "${key}.png", which is not in assets/tiles16/`);
  };
  for (const [id, d] of reg.tiles) check("tiles", id, d.sprite);
  for (const [id, d] of reg.enemies) check("enemies", id, d.sprite);
  for (const [id, d] of reg.items) check("items", id, d.sprite);
  // Species carry the player's sprite. Backgrounds are NOT checked: a
  // background is what you trained as, not what you look like, so it has no
  // art of its own — a Minotaur Conjurer is drawn as a minotaur.
  for (const [id, d] of reg.species) check("species", id, d.sprite);
  assert.deepEqual(missing, [], `\n${missing.join("\n")}`);
});

test("the imported art is recorded in ATTRIBUTION.md", () => {
  /*
   * The DCSS art is overwhelmingly public domain or CC0, but Crawl's own
   * LICENSE says the situation "may be complex, especially for older pieces".
   * Every imported sprite therefore has to be traceable to its source file.
   */
  const path = join(ROOT, "ATTRIBUTION.md");
  assert.ok(existsSync(path), "ATTRIBUTION.md is missing");
  const text = readFileSync(path, "utf8");

  const imported = [...have].filter((n) => /^(dcss|t|wpn|arm|itm|mon|pc)-/.test(n));
  assert.ok(imported.length > 20, `only ${imported.length} imported sprites to attribute`);
  const unrecorded = imported.filter((n) => !text.includes(`\`${n}\``));
  assert.deepEqual(unrecorded, [], `not recorded in ATTRIBUTION.md: ${unrecorded.join(", ")}`);
  assert.match(text, /rltiles/, "the attribution does not say where the art came from");
});

test("no sprite is blank", () => {
  // A fully transparent PNG is a sprite that was cut from the wrong place, and
  // it draws as nothing at all rather than as a visible placeholder.
  const blank: string[] = [];
  for (const name of have) {
    const buf = readFileSync(join(ART, `${name}.png`));
    // A 16x16 sprite with any content is never this small once compressed.
    if (buf.length < 120) blank.push(name);
  }
  assert.deepEqual(blank, [], `these sprites look empty: ${blank.join(", ")}`);
});

test("the game never asks the browser for art that is not there", () => {
  // Every 404 on startup is a sprite someone forgot to make or a key someone
  // forgot to stop generating. The preload list has to be exactly the files on
  // disk, so this walks the real list the browser would fetch.
  for (const key of spriteKeys(reg)) {
    assert.ok(have.has(key), `startup would fetch ${key}.png, which is not in assets/tiles16/`);
  }
});

test("the decoder agrees with the files it is about to judge", () => {
  // A quietly broken decoder would make every assertion below pass for the
  // wrong reason, so check it against something independently known: every
  // sprite this importer writes is 16x16, and a ground tile fills its cell.
  const px = decodePng(readFileSync(join(ART, "t-grass.png")));
  assert.equal(px.width, 16);
  assert.equal(px.height, 16);
  assert.equal(px.data.length, 16 * 16 * 4);
  assert.equal(coverage(px), 1, "a ground tile should have no transparent pixels");
});

test("no ground tile is so dark it reads as a hole in the map", () => {
  /*
   * Crawl paints its floors for a lit dungeon and leaves the brightening to its
   * renderer, so several of the source files are nearly black: bog_green is a
   * mean of 7 out of 255, and dropped straight into a daylit overworld it looks
   * like a gap in the world rather than a bog. tools/import-dcss.py lifts those,
   * and this is what says the lift is still happening.
   */
  const FLOOR = 40;
  for (const [id, def] of reg.tiles) {
    if (def.solid) continue;                 // walls and scenery may be dark
    const key = def.sprite ?? id;
    const px = decodePng(readFileSync(join(ART, `${key}.png`)));
    const luma = meanLuma(px);
    assert.ok(luma >= FLOOR,
      `content/tiles/${id}.json is drawn with ${key}.png, whose mean brightness ` +
      `is ${luma.toFixed(1)} of 255 — on screen that is a black square`);
  }
});

test("the things you walk on are opaque, so the map has no gaps", () => {
  // A ground tile with transparent pixels lets the page background through,
  // which looks like a rendering fault rather than terrain.
  for (const [id, def] of reg.tiles) {
    if (def.solid) continue;
    const key = def.sprite ?? id;
    const px = decodePng(readFileSync(join(ART, `${key}.png`)));
    assert.equal(coverage(px), 1, `content/tiles/${id}.json has see-through ground`);
  }
});
