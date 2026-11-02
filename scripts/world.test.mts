/**
 * The world: one continent, and the dungeons under it.
 *
 * The two things that actually ruin a generated level are unreachable ground
 * and a start you cannot stand on. Both are checked here by flood-filling the
 * finished map rather than by trusting the generator's own bookkeeping.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { generateContinent, BIOME_BY_ID, CONTINENT_W, CONTINENT_H } from "../src/world/continent.ts";
import { generateDungeon, centreOf } from "../src/world/dungeon.ts";
import type { Level } from "../src/engine/grid.ts";
import type { TileDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const tiles = reg.tiles as Map<string, TileDef>;

/** Every tile reachable on foot from a starting point. */
function reachable(level: Level, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>();
  const stack = [level.idx(from.x, from.y)];
  seen.add(stack[0]!);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % level.w, y = Math.floor(i / level.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!level.inBounds(nx, ny) || level.solid(nx, ny)) continue;
        const j = level.idx(nx, ny);
        if (seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen;
}

test("the continent is land in an ocean, not a puddle or a slab", () => {
  for (const seed of [1, 2026, 77777]) {
    const c = generateContinent(seed, tiles);
    let land = 0;
    for (const b of c.biome) if (b !== "ocean" && b !== "shallows") land++;
    const share = land / c.biome.length;
    // The generator cuts sea level by histogram, so this should hold on EVERY
    // seed rather than on average — a fixed sea level is what made some seeds
    // come out as a puddle.
    assert.ok(share > 0.35 && share < 0.60, `seed ${seed}: ${(share * 100).toFixed(0)}% land`);

    // And the edges are sea, so the continent sits in an ocean.
    const { w, h } = c.level;
    for (let x = 0; x < w; x++) {
      assert.equal(c.biome[x], "ocean", `seed ${seed}: land at the top edge`);
      assert.equal(c.biome[(h - 1) * w + x], "ocean", `seed ${seed}: land at the bottom edge`);
    }
  }
});

test("the continent has a real variety of biomes", () => {
  const c = generateContinent(2026, tiles);
  const seen = new Set(c.biome);
  assert.ok(seen.size >= 8, `only ${seen.size} biomes on the whole continent: ${[...seen].join(", ")}`);
  for (const id of seen) assert.ok(BIOME_BY_ID.has(id), `"${id}" is not a biome in the table`);
});

test("you start on open, dry ground", () => {
  for (const seed of [1, 5, 2026, 99]) {
    const c = generateContinent(seed, tiles);
    assert.equal(c.level.solid(c.start.x, c.start.y), false, `seed ${seed}: you start inside a wall`);
    const b = c.biome[c.start.y * c.level.w + c.start.x];
    assert.ok(b !== "ocean" && b !== "shallows", `seed ${seed}: you start in the sea`);
  }
});

test("every dungeon entrance is somewhere you can walk to", () => {
  const c = generateContinent(2026, tiles);
  assert.ok(c.entrances.length >= 8, `only ${c.entrances.length} dungeons on the whole map`);

  const open = reachable(c.level, c.start);
  let reachableDoors = 0;
  for (const e of c.entrances) {
    assert.equal(c.level.solid(e.pos.x, e.pos.y), false, `${e.name} is inside a wall`);
    if (open.has(c.level.idx(e.pos.x, e.pos.y))) reachableDoors++;
  }
  // Some may sit across water on another landmass, which is fine and
  // interesting — but most of them must be walkable from where you wake up.
  assert.ok(reachableDoors / c.entrances.length > 0.5,
    `only ${reachableDoors} of ${c.entrances.length} dungeons can be walked to`);
});

test("dungeons get deeper the further out they are", () => {
  const c = generateContinent(2026, tiles);
  const near = c.entrances.reduce((a, b) =>
    Math.hypot(a.pos.x - c.start.x, a.pos.y - c.start.y) < Math.hypot(b.pos.x - c.start.x, b.pos.y - c.start.y) ? a : b);
  const far = c.entrances.reduce((a, b) =>
    Math.hypot(a.pos.x - c.start.x, a.pos.y - c.start.y) > Math.hypot(b.pos.x - c.start.x, b.pos.y - c.start.y) ? a : b);
  assert.ok(far.depth > near.depth, `nearest is depth ${near.depth}, furthest is depth ${far.depth}`);
});

test("the same seed always builds the same continent", () => {
  const a = generateContinent(4242, tiles);
  const b = generateContinent(4242, tiles);
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.biome, b.biome);
  assert.deepEqual([...a.level.tiles], [...b.level.tiles]);
  assert.deepEqual(a.entrances, b.entrances);

  const c = generateContinent(4243, tiles);
  assert.notDeepEqual(a.biome, c.biome, "two different seeds made the same world");
});

test("a dungeon floor has rooms, and every one of them can be walked to", () => {
  for (const depth of [1, 3, 7, 12]) {
    const d = generateDungeon(999, depth, tiles);
    assert.ok(d.rooms.length >= 3, `depth ${depth}: only ${d.rooms.length} rooms`);

    // This is the one that matters: a room you cannot reach is content the
    // player can never see. Skipped grid slots can orphan a room, which is why
    // the generator also chains every room to the one before it.
    const open = reachable(d.level, d.up);
    for (const r of d.rooms) {
      const c = centreOf(r);
      assert.ok(open.has(d.level.idx(c.x, c.y)),
        `depth ${depth}: the room at ${r.x},${r.y} cannot be reached from the stairs`);
    }
  }
});

test("a dungeon floor has stairs down, and you can get to them", () => {
  for (const depth of [1, 4, 9]) {
    const d = generateDungeon(31337, depth, tiles);
    assert.equal(d.level.solid(d.down.x, d.down.y), false);
    assert.notDeepEqual(d.up, d.down, `depth ${depth}: the stairs are on the same tile`);
    assert.ok(reachable(d.level, d.up).has(d.level.idx(d.down.x, d.down.y)),
      `depth ${depth}: you cannot walk from the up stairs to the down stairs`);

    const downTile = d.level.at(d.down.x, d.down.y);
    assert.equal(downTile?.on, "stairs-down", "the down stairs do not act as stairs");
  }
});

test("a dungeon is walled in — you cannot walk off the edge", () => {
  const d = generateDungeon(7, 2, tiles);
  const { w, h } = d.level;
  for (let x = 0; x < w; x++) {
    assert.ok(d.level.solid(x, 0) && d.level.solid(x, h - 1), `open tile on the top or bottom edge at x=${x}`);
  }
  for (let y = 0; y < h; y++) {
    assert.ok(d.level.solid(0, y) && d.level.solid(w - 1, y), `open tile on the left or right edge at y=${y}`);
  }
});

test("the same seed and depth always build the same floor", () => {
  const a = generateDungeon(12345, 5, tiles);
  const b = generateDungeon(12345, 5, tiles);
  assert.deepEqual([...a.level.tiles], [...b.level.tiles]);
  assert.deepEqual(a.up, b.up);

  // And two floors of the same dungeon are different from each other, or the
  // whole descent is one level repeated.
  const next = generateDungeon(12345, 6, tiles);
  assert.notDeepEqual([...a.level.tiles], [...next.level.tiles]);
});

test("every tile the world paints with is a real content file", () => {
  const c = generateContinent(2026, tiles);
  for (const kind of c.level.palette) {
    assert.ok(tiles.has(kind.id), `the continent used "${kind.id}", which has no file in content/tiles/`);
  }
  for (const depth of [1, 6]) {
    const d = generateDungeon(2026, depth, tiles);
    for (const kind of d.level.palette) {
      assert.ok(tiles.has(kind.id), `a dungeon used "${kind.id}", which has no file in content/tiles/`);
    }
  }
});

test("no biome is a single tile marooned in another one", () => {
  // A lone square of Cinderland inside a forest reads as a texture bug rather
  // than terrain, because there is no volcano anywhere near it.
  const c = generateContinent(20260, tiles);
  const { biome } = c;
  const W = CONTINENT_W, H = CONTINENT_H;
  const wet = (b: string) => b === "ocean" || b === "shallows" || b === "beach";
  let marooned = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const mine = biome[y * W + x]!;
      if (wet(mine)) continue;
      let same = 0, dryNeighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const b = biome[(y + dy) * W + (x + dx)]!;
          if (b === mine) same++;
          else if (!wet(b)) dryNeighbours++;
        }
      }
      // A single-tile island is real terrain, not a speck, and drowning it
      // would be worse than leaving it.
      if (!same && dryNeighbours) marooned++;
    }
  }
  assert.equal(marooned, 0, `${marooned} tiles are a biome all on their own`);
});
