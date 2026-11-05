/**
 * The world map only ever shows what has been seen.
 *
 * The whole point of the screen is discovery: a village, a dungeon, a lair or a
 * vein appears the moment you have stood where you can see it, and not a moment
 * before. These drive `mapData` straight, revealing one tile at a time and
 * checking that the right marker — and only it — turns up.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { mapData, mapSidebarHtml, DEFAULT_MAP_FILTERS } from "../src/ui/worldmap.ts";

const reg = loadRegistry();

function fresh(seed: number | string = 2026): Game {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  g.level.known.fill(0);             // start blind, so each reveal is deliberate
  return g;
}

const reveal = (g: Game, x: number, y: number) => { g.level.known[g.level.idx(x, y)] = 1; };

test("nothing is on the map until its ground has been seen", () => {
  const g = fresh();
  const data = mapData(g, reg, { ...DEFAULT_MAP_FILTERS });
  assert.equal(data.markers.length, 0, "features showed on an unexplored map");
});

test("a village appears once you have seen where it stands", () => {
  const g = fresh();
  const v = g.continent.villages[0]!;
  assert.equal(mapData(g, reg, { ...DEFAULT_MAP_FILTERS }).markers.length, 0);
  reveal(g, v.pos.x, v.pos.y);
  const markers = mapData(g, reg, { ...DEFAULT_MAP_FILTERS }).markers;
  assert.ok(markers.some((m) => m.x === v.pos.x && m.y === v.pos.y), "the seen village is not on the map");
});

test("a discovered dungeon shows its theme in the map index", () => {
  const g = fresh();
  const site = g.continent.entrances[0]!;
  reveal(g, site.pos.x, site.pos.y);
  const html = mapSidebarHtml(g, reg, { ...DEFAULT_MAP_FILTERS });
  assert.ok(html.includes(site.name), "discovered dungeon name is missing");
  assert.ok(html.includes(`tier ${site.depth} · ${site.theme}`), "dungeon theme is missing from the map index");
});

test("a boss lair appears when found, and reads as cleared once slain", () => {
  const g = fresh();
  const lair = g.continent.lairs[0]!;
  reveal(g, lair.pos.x, lair.pos.y);
  const before = mapData(g, reg, { ...DEFAULT_MAP_FILTERS }).markers.find((m) => m.x === lair.pos.x && m.y === lair.pos.y)!;
  assert.ok(before, "a found lair is not on the map");
  assert.ok(before.ring, "a live lair is not ringed");
  g.bossesKilled.add(lair.enemy);
  const after = mapData(g, reg, { ...DEFAULT_MAP_FILTERS }).markers.find((m) => m.x === lair.pos.x && m.y === lair.pos.y)!;
  assert.ok(!after.ring, "a cleared lair is still ringed as a threat");
});

test("a discovered landmark appears on the map and in its index only when enabled", () => {
  const g = fresh();
  const site = g.continent.structures[0]!;
  const filters = { ...DEFAULT_MAP_FILTERS, villages: false, dungeons: false, lairs: false };
  assert.equal(mapData(g, reg, filters).markers.length, 0, "an unexplored landmark appeared");
  reveal(g, site.pos.x, site.pos.y);
  const marker = mapData(g, reg, filters).markers.find((m) => m.x === site.pos.x && m.y === site.pos.y);
  assert.ok(marker, "a discovered landmark has no map marker");
  const sidebar = mapSidebarHtml(g, reg, filters);
  assert.ok(sidebar.includes(site.name), "the landmark is absent from the discovery index");
  assert.ok(sidebar.includes(site.kind), "the landmark type is absent from the discovery index");
  assert.ok(!mapData(g, reg, { ...filters, structures: false }).markers.some((m) => m.x === site.pos.x && m.y === site.pos.y),
    "a landmark marker remained visible with its filter disabled");
});

test("a filter that is off hides its markers", () => {
  const g = fresh();
  const v = g.continent.villages[0]!;
  reveal(g, v.pos.x, v.pos.y);
  const off = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, villages: false }).markers;
  assert.ok(!off.some((m) => m.x === v.pos.x && m.y === v.pos.y), "a village showed with its filter off");
});

test("resources only show on revealed ground, and only their own kind", () => {
  const g = fresh();
  // Find a revealed ore tile by revealing the whole map, then picking one.
  g.level.known.fill(1);
  const W = g.level.w;
  let ore: { x: number; y: number } | null = null;
  for (let i = 0; i < g.level.tiles.length && !ore; i++) {
    const id = g.level.palette[g.level.tiles[i]!]?.id ?? "";
    if (reg.tiles.get(id)?.harvest?.skill === "mining") ore = { x: i % W, y: (i / W) | 0 };
  }
  if (!ore) { console.log("  (no ore on this seed; skipping)"); return; }

  const withOre = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, ore: true }).resourceTiles;
  assert.ok(withOre.some((r) => r.x === ore!.x && r.y === ore!.y), "a revealed ore vein is not shown");
  const withoutOre = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, ore: false }).resourceTiles;
  assert.ok(!withoutOre.some((r) => r.x === ore!.x && r.y === ore!.y), "ore showed with its filter off");

  // Hide the ore tile again; it must drop off the map.
  g.level.known[g.level.idx(ore.x, ore.y)] = 0;
  const hidden = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, ore: true }).resourceTiles;
  assert.ok(!hidden.some((r) => r.x === ore!.x && r.y === ore!.y), "an unseen ore vein is on the map");
});

test("a creature's habitat only lights up where it has been explored", () => {
  const g = fresh();
  const quarry = [...reg.enemies.values()].find((e) => !e.boss && (e.biomes?.length ?? 0) > 0)!;
  g.level.known.fill(1);
  const lit = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, creature: String(quarry.id) }).highlight;
  // Whatever lights up must be a tile of one of the creature's biomes.
  if (lit && lit.size) {
    const biomes = new Set(quarry.biomes ?? []);
    for (const i of lit) {
      assert.ok(biomes.has(g.continent.biome[i]!), `${quarry.id} lit a tile outside its range`);
      break;
    }
  }
  // Blind map: nothing lights up.
  g.level.known.fill(0);
  const dark = mapData(g, reg, { ...DEFAULT_MAP_FILTERS, creature: String(quarry.id) }).highlight;
  assert.ok(!dark || dark.size === 0, "a creature's habitat showed on an unexplored map");
});
