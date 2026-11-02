/**
 * The content folder itself: that it loads, and that nothing can quietly fall
 * out of it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRegistry } from "./lib/harness.mts";
import { CONTENT_KINDS } from "../src/content/schema.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const reg = loadRegistry();

test("the content folder loads with no errors", () => {
  const errors = reg.problems.filter((p) => p.level === "error");
  assert.equal(errors.length, 0, `\n${errors.map((e) => `${e.where}: ${e.what}`).join("\n")}`);
});

test("every reference points at a file that exists", () => {
  const dangling = reg.problems.filter((p) => p.what.includes("points at"));
  assert.equal(dangling.length, 0, `\n${dangling.map((e) => `${e.where}: ${e.what}`).join("\n")}`);
});

test("the indexer knows about every kind of content there is", () => {
  /*
   * tools/index-content.mjs keeps its own copy of the kind list, because a
   * build script cannot import a .ts module before the build has run. When
   * "upgrades" was added to the schema and not to the indexer, the browser
   * silently never loaded a single upgrade — and nothing else would have
   * noticed, because the tests read the folder directly.
   */
  const src = readFileSync(join(ROOT, "tools/index-content.mjs"), "utf8");
  const listed = [...src.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
  for (const kind of CONTENT_KINDS) {
    assert.ok(listed.includes(kind),
      `tools/index-content.mjs does not list "${kind}", so the browser will never load content/${kind}/`);
  }
});

test("the generated index matches what is on disk", async () => {
  const { buildIndex } = await import("../tools/index-content.mjs");
  const built = buildIndex(join(ROOT, "content"));
  const onDisk = JSON.parse(readFileSync(join(ROOT, "content/index.json"), "utf8")) as Record<string, string[]>;
  assert.deepEqual(onDisk, built,
    "content/index.json is stale — run `node tools/index-content.mjs content`");
});

test("there is one playable class, and it is the Ruinmage", () => {
  assert.deepEqual([...reg.classes.keys()], ["ruinmage"]);
  const rm = reg.classes.get("ruinmage")!;
  assert.ok((rm.spells ?? []).length >= 1, "the Ruinmage starts knowing nothing");
  assert.ok((rm.abilities ?? []).includes("punch"), "the Ruinmage cannot punch");
});

test("the game has a real spellbook and a real bestiary", () => {
  assert.ok(reg.spells.size >= 20, `only ${reg.spells.size} spells`);
  assert.ok(reg.abilities.size >= 12, `only ${reg.abilities.size} abilities`);
  assert.ok(reg.enemies.size >= 30, `only ${reg.enemies.size} enemies`);
  assert.ok(reg.upgrades.size >= 12, `only ${reg.upgrades.size} upgrades`);
  assert.ok(reg.statuses.size >= 8, `only ${reg.statuses.size} statuses`);
});

test("every spell is reachable from the level-up roll", () => {
  // A spell with no tier, or a tier above the cap, could never be offered.
  for (const [id, s] of reg.spells) {
    const tier = s.tier ?? 1;
    assert.ok(tier >= 1 && tier <= 5, `${id} has tier ${tier}, which no level reaches`);
  }
});

test("every enemy is spawnable somewhere", () => {
  for (const [id, e] of reg.enemies) {
    assert.ok((e.biomes ?? []).length > 0, `${id} lists no biomes, so it never spawns`);
    const min = e.depth?.min ?? 0;
    const max = e.depth?.max ?? 99;
    assert.ok(min <= max, `${id} has an impossible depth band ${min}..${max}`);
    assert.ok((e.weight ?? 10) > 0, `${id} has weight 0, so it never rolls`);
  }
});
