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
  for (const [id, d] of reg.classes) check("classes", id, d.sprite);
  for (const [id, d] of reg.items) check("items", id, d.sprite);
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

  const imported = [...have].filter((n) => /^(dcss|wpn|arm|itm)-/.test(n));
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
