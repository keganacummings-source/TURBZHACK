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
import { Game, loadGame } from "../src/game.ts";
import {
  generateContinent, placeLairs, BIOME_BY_ID, CONTINENT_W, CONTINENT_H,
  LEGACY_CONTINENT_W, LEGACY_CONTINENT_H, TOWN_HX, TOWN_HY,
} from "../src/world/continent.ts";
import { Rng } from "../src/engine/rng.ts";
import { DUNGEON_THEMES, generateDungeon, centreOf } from "../src/world/dungeon.ts";
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

test("land biomes form coherent regions and generated terrain repeats by seed", () => {
  for (const seed of [13, 2026, 54321]) {
    const c = generateContinent(seed, tiles);
    const { w, h } = c.level;
    let neighboringLand = 0, sameBiome = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const here = c.biome[y * w + x]!;
        const east = c.biome[y * w + x + 1]!;
        const south = c.biome[(y + 1) * w + x]!;
        for (const next of [east, south]) {
          if (here === "ocean" || here === "shallows" || here === "beach"
            || next === "ocean" || next === "shallows" || next === "beach") continue;
          neighboringLand++;
          if (here === next) sameBiome++;
        }
      }
    }
    assert.ok(sameBiome / neighboringLand > 0.48,
      `seed ${seed}: only ${(sameBiome / neighboringLand * 100).toFixed(0)}% of adjacent land tiles share a biome`);
    const repeated = generateContinent(seed, tiles);
    assert.deepEqual(c.biome, repeated.biome, `seed ${seed}: biome field changed`);
    assert.deepEqual(c.structures, repeated.structures, `seed ${seed}: landmarks changed`);
    assert.deepEqual([...c.level.tiles], [...repeated.level.tiles], `seed ${seed}: terrain changed`);
  }
});

test("the expanded continent adds distinct settlements and dungeon sites", () => {
  const c = generateContinent(54321, tiles);
  assert.equal(c.level.w, CONTINENT_W);
  assert.equal(c.level.h, CONTINENT_H);
  assert.equal(c.level.tiles.length, LEGACY_CONTINENT_W * LEGACY_CONTINENT_H * 4);
  assert.ok(c.villages.length >= 30, `only ${c.villages.length} villages on the expanded continent`);
  assert.equal(new Set(c.villages.map((v) => v.name)).size, c.villages.length, "village names repeat");
  const layouts = new Set(c.villages.map((v) => {
    const tiles: string[] = [];
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -6; dx <= 6; dx++) tiles.push(c.level.at(v.pos.x + dx, v.pos.y + dy)?.id ?? "");
    }
    return tiles.join(",");
  }));
  assert.ok(layouts.size > 1, "all villages use the same site layout");
  assert.ok(new Set(c.villages.map((v) => v.trade)).size >= 4, "settlements lack trade variety");
  assert.ok(c.entrances.length >= 50, `only ${c.entrances.length} dungeons on the expanded continent`);
  assert.equal(new Set(c.entrances.map((e) => e.name)).size, c.entrances.length, "dungeon names repeat");
  assert.ok(c.entrances.every((e) => c.level.at(e.pos.x, e.pos.y)?.id === "dungeon-door"),
    "the road network overwrote a dungeon entrance");
  assert.ok(c.structures.length >= 20, `only ${c.structures.length} landmarks on the expanded continent`);
  assert.ok(new Set(c.structures.map((s) => s.kind)).size >= 3, "landmarks lack structural variety");
  assert.equal(new Set(c.structures.map((s) => s.name)).size, c.structures.length, "landmark names repeat");
  assert.ok(c.structures.every((s) => !["ocean", "shallows", "beach"].includes(s.biome)),
    "a landmark spawned in water");
  for (const structure of c.structures) {
    assert.ok(!c.villages.some((v) => Math.hypot(v.pos.x - structure.pos.x, v.pos.y - structure.pos.y) < 20),
      `${structure.name} overlaps a village`);
    assert.ok(!c.entrances.some((e) => Math.hypot(e.pos.x - structure.pos.x, e.pos.y - structure.pos.y) < 10),
      `${structure.name} overlaps a dungeon entrance`);
  }
  const roads = [...c.level.tiles].filter((index) => c.level.palette[index]?.id === "road").length;
  assert.ok(roads >= 100, `the settlement network has only ${roads} road tiles`);
  for (let i = 0; i < c.level.tiles.length; i++) {
    if (c.level.palette[c.level.tiles[i]!]?.id !== "road") continue;
    assert.ok(!["water", "deep-water"].includes(c.level.palette[c.level.floor[i]!]?.id ?? ""),
      `a road crosses water at ${i % c.level.w},${Math.floor(i / c.level.w)}`);
  }
});

test("version 1 saves rebuild the original world size and exploration grid", () => {
  const original = new Game(reg, 4242, { w: LEGACY_CONTINENT_W, h: LEGACY_CONTINENT_H });
  original.start("fighter");
  const save = { ...original.toSave(), version: 1, worldSize: undefined };
  const restored = loadGame(reg, save);
  assert.equal(restored.continent.level.w, LEGACY_CONTINENT_W);
  assert.equal(restored.continent.level.h, LEGACY_CONTINENT_H);
  assert.deepEqual(restored.continent.biome, original.continent.biome);
  assert.deepEqual([...restored.continent.level.tiles], [...original.continent.level.tiles]);
  assert.deepEqual([...restored.continent.level.known], [...original.continent.level.known]);
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

test("every world boss gets a lair on every seed, in a biome it belongs to", () => {
  // The whole point: a boss's drops are unobtainable without its lair, so a seed
  // that grew no Cinderland must be GIVEN one rather than skipping the Wyrm.
  const bosses = [...reg.enemies.values()]
    .filter((e) => e.boss)
    .map((e) => ({ id: String(e.id), biomes: e.biomes, region: e.region }));
  assert.ok(bosses.length >= 4, "there should be several world bosses");

  for (const seed of [1, 2, 7, 13, 99, 2026]) {
    const c = generateContinent(seed, tiles);
    placeLairs(c, bosses, new Rng(seed ^ 0x1a2b), tiles);
    const W = c.level.w;
    const placed = new Set(c.lairs.map((l) => l.enemy));
    for (const b of bosses) {
      assert.ok(placed.has(b.id), `seed ${seed}: ${b.id} got no lair`);
      const lair = c.lairs.find((l) => l.enemy === b.id)!;
      assert.equal(c.level.solid(lair.pos.x, lair.pos.y), false, `seed ${seed}: ${b.id}'s lair is inside a wall`);
      if (b.biomes?.length) {
        const here = c.biome[lair.pos.y * W + lair.pos.x]!;
        assert.ok(b.biomes.includes(here), `seed ${seed}: ${b.id} lairs on ${here}, not one of ${b.biomes.join(", ")}`);
      }
    }
  }
});

test("villages are proper walled towns with reachable workshops", () => {
  for (const seed of [1, 3, 7, 2026]) {
    const c = generateContinent(seed, tiles);
    assert.ok(c.villages.length >= 1, `seed ${seed}: no villages at all`);
    const open = reachable(c.level, c.start);

    for (const v of c.villages) {
      assert.ok(open.has(c.level.idx(v.pos.x, v.pos.y)), `${v.name} is not reachable by a dry route from the start`);
      assert.equal(c.level.at(v.pos.x, v.pos.y)?.id, "road", `${v.name} is not connected to the road network`);
      // It is enclosed: a ring of wall around the plot, not just a patch of floor.
      let walls = 0;
      for (let dy = -TOWN_HY; dy <= TOWN_HY; dy++) {
        for (let dx = -TOWN_HX; dx <= TOWN_HX; dx++) {
          const id = c.level.at(v.pos.x + dx, v.pos.y + dy)?.id;
          if (["wall-wood", "wall-clay", "wall-stone", "wall-snow"].includes(id ?? "")) walls++;
        }
      }
      assert.ok(walls >= 12, `${v.name} has only ${walls} wall tiles — not a walled town`);

      // Its centre is open, and every one of its stations can be stood beside
      // from there — a forge you cannot reach is not a forge.
      assert.equal(c.level.solid(v.pos.x, v.pos.y), false, `${v.name}'s centre is blocked`);
      for (let dy = -TOWN_HY; dy <= TOWN_HY; dy++) {
        for (let dx = -TOWN_HX; dx <= TOWN_HX; dx++) {
          const x = v.pos.x + dx, y = v.pos.y + dy;
          const station = reg.tiles.get(c.level.at(x, y)?.id ?? "")?.station;
          if (!station) continue;
          let beside = false;
          for (let ey = -1; ey <= 1 && !beside; ey++) {
            for (let ex = -1; ex <= 1 && !beside; ex++) {
              if (!c.level.solid(x + ex, y + ey) && open.has(c.level.idx(x + ex, y + ey))) beside = true;
            }
          }
          assert.ok(beside, `${v.name}'s ${station} cannot be reached`);
        }
      }
    }
  }
});

test("seeded landmark caches enter the saved ground-loot system", () => {
  const game = new Game(reg, 2026);
  game.start("fighter");
  const caches = game.continent.structures.filter((structure) => structure.cache);
  assert.ok(caches.length > 0, "the world generated no landmark caches");
  for (const structure of caches) {
    const key = `o:${game.level.idx(structure.pos.x, structure.pos.y)}`;
    assert.ok((game.loot.get(key)?.length ?? 0) > 0, `${structure.name} has no cache loot`);
  }
  const restored = loadGame(reg, game.toSave());
  for (const structure of caches) {
    const key = `o:${restored.continent.level.idx(structure.pos.x, structure.pos.y)}`;
    assert.deepEqual(restored.loot.get(key), game.loot.get(key), `${structure.name}'s cache did not persist`);
  }
});

test("you never wake up inside a town", () => {
  for (const seed of [1, 2, 3, 5, 7, 13, 99, 2026]) {
    const c = generateContinent(seed, tiles);
    // No village wall lands on you or your immediate surroundings.
    for (const v of c.villages) {
      assert.ok(Math.hypot(v.pos.x - c.start.x, v.pos.y - c.start.y) > 7,
        `seed ${seed}: ${v.name} is built on top of where you start`);
    }
    assert.equal(c.level.solid(c.start.x, c.start.y), false, `seed ${seed}: you start in a wall`);
  }
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

test("all dungeon themes use their wall style and varied reachable room shapes", () => {
  for (const theme of DUNGEON_THEMES) {
    const first = generateDungeon(608, 4, tiles, `${theme} halls`, undefined, undefined, theme);
    const second = generateDungeon(608, 4, tiles, `${theme} halls`, undefined, undefined, theme);
    assert.deepEqual(first.rooms, second.rooms, `${theme} room layout is not deterministic`);
    assert.ok(new Set(first.rooms.map((room) => room.shape)).size >= 2, `${theme} rooms have no shape variety`);
    assert.ok(first.level.palette.some((tile) => tile.id === ({
      jungle: "wall-wood", swamp: "wall-clay", caves: "wall-stone",
      mansion: "wall-wood", crypt: "wall-stone",
    } as const)[theme]), `${theme} uses no themed wall tile`);
    const open = reachable(first.level, first.up);
    assert.ok(first.rooms.every((room) => open.has(first.level.idx(centreOf(room).x, centreOf(room).y))),
      `${theme} has a disconnected room`);
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

test("every dungeon theme includes passable, deterministic pit traps", () => {
  for (const theme of DUNGEON_THEMES) {
    const first = generateDungeon(8080, 3, tiles, `${theme} floor`, undefined, undefined, theme);
    const second = generateDungeon(8080, 3, tiles, `${theme} floor`, undefined, undefined, theme);
    const pits = [...first.level.tiles].filter((index) => first.level.palette[index]?.on === "pit-trap");
    const otherPits = [...second.level.tiles].filter((index) => second.level.palette[index]?.on === "pit-trap");
    assert.ok(pits.length > 0, `${theme} has no generated trap`);
    assert.deepEqual(pits, otherPits, `${theme} traps are not deterministic`);
    assert.ok(pits.every((index) => !first.level.palette[index]?.solid), `${theme} traps block movement`);
  }
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

test("scenery stands on ground, and ground stands on itself", () => {
  // Trees used to be drawn alone, which left them standing in black squares.
  // Not every solid tile needs a floor: deep water and a cliff face ARE the
  // ground, drawn edge to edge. What matters is that where a floor differs from
  // the tile it is something you could otherwise have walked on, and that the
  // cut-out scenery actually got one.
  const c = generateContinent(31337, tiles);
  const lv = c.level;
  const CUTOUT = new Set(["tree", "tree-snow", "mushroom", "dungeon-door"]);
  let stood = 0;
  for (let i = 0; i < lv.tiles.length; i++) {
    const kind = lv.palette[lv.tiles[i]!]!;
    const under = lv.palette[lv.floor[i]!]!;
    if (lv.floor[i] === lv.tiles[i]) {
      assert.ok(!CUTOUT.has(kind.id), `${kind.id} has nothing drawn behind it`);
      continue;
    }
    stood++;
    assert.ok(!under.solid, `${kind.id} is standing on ${under.id}, which is not ground`);
  }
  assert.ok(stood > 100, `only ${stood} tiles in the whole continent stand on anything`);
});
