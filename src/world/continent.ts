/**
 * The overworld: one continent, generated once per run from the seed.
 *
 * Deliberately NOT a dungeon. A dungeon is rooms and corridors with one way
 * through; a continent is open ground you cross in whatever direction you like,
 * with biomes that tell you roughly how dangerous the local wildlife is and
 * dungeon entrances scattered over it that are the actual content.
 *
 * It is built in layers, each a single pass over the grid, because that is both
 * the cheapest way and the easiest to reason about:
 *
 *   1. height   — noise, pulled into a round blob so there is sea at the edges
 *   2. sea      — a cut through the height at whatever level gives the land ratio
 *   3. moisture — second noise field, wetter near water
 *   4. biomes   — a table read from height, latitude and moisture
 *   5. features — trees, rocks, rivers, and the dungeon entrances
 */
import { Rng } from "../engine/rng.ts";
import { Level, type TileKind } from "../engine/grid.ts";
import type { Pos } from "../engine/types.ts";
import type { TileDef } from "../content/schema.ts";
import { TRADE, VILLAGE_TRADES, type VillageTrade } from "./economy.ts";

export const CONTINENT_W = 240;
export const CONTINENT_H = 160;

/** A biome, as the overworld understands it. */
export type Biome = {
  id: string;
  name: string;
  /** Tile ids this biome paints with: ground, then its scattered second ground. */
  ground: string;
  patch?: string;
  /** Solid scenery. */
  block?: string;
  /** How thickly the scenery stands, 0-1. */
  density?: number;
  /** Colour on the overview map. */
  colour: string;
};

/**
 * The biome table.
 *
 * Kept here rather than in a content file because these are the generator's own
 * bands and changing one means changing the generator's behaviour, not adding
 * content. Which TILES each one paints with is content, and those are ids.
 */
export const BIOMES: Biome[] = [
  { id: "ocean", name: "Ocean", ground: "deep-water", colour: "#1d3f6e" },
  { id: "shallows", name: "Shallows", ground: "water", colour: "#2f74a8" },
  { id: "beach", name: "Shore", ground: "sand", colour: "#d6c48c" },
  { id: "plains", name: "Plains", ground: "grass", patch: "dirt", block: "tree", density: 0.03, colour: "#6fa84f" },
  { id: "forest", name: "Forest", ground: "grass", patch: "dirt", block: "tree", density: 0.22, colour: "#2f6b35" },
  { id: "swamp", name: "Mire", ground: "swamp", patch: "water", block: "mushroom", density: 0.1, colour: "#55663b" },
  { id: "savanna", name: "Savanna", ground: "grass-dry", patch: "dirt", block: "tree", density: 0.02, colour: "#bfae68" },
  { id: "desert", name: "Waste", ground: "sand", patch: "clay", block: "clay", density: 0.01, colour: "#dbc287" },
  { id: "badlands", name: "Badlands", ground: "clay", patch: "sand", block: "wall-clay", density: 0.08, colour: "#b06a3c" },
  { id: "hills", name: "Downs", ground: "dirt", patch: "grass", block: "wall-stone", density: 0.06, colour: "#8a8255" },
  { id: "highland", name: "Crags", ground: "stone", patch: "dirt", block: "wall-stone", density: 0.3, colour: "#8d8a82" },
  { id: "taiga", name: "Pinewood", ground: "snow", patch: "dirt", block: "tree-snow", density: 0.2, colour: "#49675a" },
  { id: "tundra", name: "Tundra", ground: "snow", patch: "stone", block: "wall-snow", density: 0.03, colour: "#b7c7c2" },
  { id: "glacier", name: "Icefield", ground: "ice", patch: "snow", block: "wall-snow", density: 0.05, colour: "#dff0f4" },
  { id: "volcanic", name: "Cinderland", ground: "ash", patch: "lava", block: "wall-stone", density: 0.1, colour: "#8a3a2a" },
  { id: "void", name: "Blight", ground: "voidgrass", patch: "stone", block: "wall-stone", density: 0.12, colour: "#6a4cff" },
];

export const BIOME_BY_ID = new Map(BIOMES.map((b) => [b.id, b]));

export type Continent = {
  seed: number;
  level: Level;
  /** Biome id per tile, for the overview map and for spawning. */
  biome: string[];
  /** Where the player starts. */
  start: Pos;
  /** Dungeon entrances, in world tiles. */
  entrances: { pos: Pos; name: string; depth: number }[];
  /**
   * How far from the start each tile is, as a band 0-5.
   *
   * Biome says what the ground is; this says how far out you have come. The two
   * together are what a spawn table matches on, because the same forest runs
   * from the player's doorstep to the edge of the map and should not hold the
   * same creatures at both ends.
   */
  region: Uint8Array;
  /** World bosses: one lair each, fixed for this seed. */
  lairs: { pos: Pos; enemy: string }[];
  /** Settlements: stations to craft at, and a market to trade with. */
  villages: Village[];
};

/** The most remote band. Band 0 is home. */
export const REGION_BANDS = 5;

/**
 * Half-extent of a town, walls included.
 *
 * A market town fills the full plot; a hamlet is one column narrower. The middle
 * three rows (|dy| <= 1) are always left open as the plaza, which is where the
 * villagers and the market stand, so the huts only ever occupy the top and
 * bottom bands.
 */
export const TOWN_HX = 6;
export const TOWN_HY = 4;

/**
 * Raise one hut: a 3x3 wooden box with its floor inside and a door onto the
 * plaza. A workshop gets its station on the inner floor, reachable from the
 * doorway; a house is simply left empty.
 */
function buildHut(
  level: Level, hcx: number, hcy: number, townCy: number,
  wall: number, floor: number, station: number | null,
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = hcx + dx, y = hcy + dy;
      if (!level.inBounds(x, y)) continue;
      level.set(x, y, dx === 0 && dy === 0 ? floor : wall, floor);
    }
  }
  // The door faces the plaza — toward the centre of town — so the street reaches it.
  const doorDy = hcy < townCy ? 1 : -1;
  level.set(hcx, hcy + doorDy, floor, floor);
  // The workshop's tool sits on the inner floor; a house keeps the open floor.
  if (station !== null) level.set(hcx, hcy, station, floor);
}

/** A settlement. What it does decides what it has and what it wants. */
export type Village = {
  pos: Pos;
  name: string;
  trade: VillageTrade;
  /** Crafting stations it has, by tile id. */
  stations: string[];
  /** How much trade it absorbs before its prices move. */
  depth: number;
};

// --- noise -----------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

/** Several octaves of noise, which is what gives coastlines their detail. */
function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let total = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += noise2(x * freq, y * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / norm;
}

/**
 * Build the continent.
 *
 * `rng` is forked by label inside, so the shape of the land cannot be changed
 * by how many dungeon entrances happen to be rolled afterwards.
 */
export function generateContinent(seed: number, tiles: Map<string, TileDef>, w = CONTINENT_W, h = CONTINENT_H): Continent {
  const rng = new Rng(seed);
  const n = w * h;
  const height = new Float32Array(n);
  const moisture = new Float32Array(n);
  const biome: string[] = new Array(n).fill("ocean");

  /*
   * --- 1. two separate fields, and keeping them separate is the point ------
   *
   *   mass   — the blob plus noise. Decides ONLY land or sea.
   *   relief — independent noise. Decides ONLY how high the land is.
   *
   * Deriving height from the same field as the coastline makes the middle of
   * the continent always the highest ground, because the middle is where the
   * blob peaks. The first version did exactly that and produced a bullseye: a
   * vast grey mass of crags and downs in the centre of every map, ringed by
   * forest. Two fields costs one more noise lookup and fixes it completely.
   */
  const mass = new Float32Array(n);
  const shapeSeed = rng.fork("shape").state;
  const reliefSeed = rng.fork("relief").state;
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const raw = fbm(x / 28, y / 28, shapeSeed, 5);
      // Distance from the middle, as a fraction of the way to the edge. The
      // falloff is what stops the land running off the side of the map.
      const dx = (x - cx) / (w / 2), dy = (y - cy) / (h / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const falloff = Math.max(0, 1 - Math.pow(Math.min(1, d / 0.92), 2.2));
      /*
       * A hard margin of open sea around the whole map.
       *
       * The radial falloff alone is not enough: it reaches zero at the edge,
       * but the noise term does not, so on some seeds a patch of land ran
       * straight off the top of the map. Multiplying the whole height down to
       * nothing in the outer few tiles guarantees the continent sits IN an
       * ocean on every seed, rather than usually.
       */
      const margin = 4;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const rim = Math.max(0, Math.min(1, (edge - 1) / margin));
      mass[y * w + x] = (raw * 0.72 + falloff * 0.55) * rim;
      // Relief has no blob in it at all, so mountains fall where the ridges
      // are rather than wherever the continent happens to be thickest.
      height[y * w + x] = fbm(x / 17, y / 17, reliefSeed, 5) * rim;
    }
  }

  /*
   * --- 2. sea level, by histogram rather than a constant -------------------
   *
   * A fixed sea level gives a different amount of land on every seed, and some
   * seeds come out as a puddle. Sorting the heights and cutting at the right
   * rank gives the SAME land ratio every time, whatever the noise did.
   */
  const sorted = Float32Array.from(mass).sort();
  const wantLand = 0.46;
  const sea = sorted[Math.floor(n * (1 - wantLand))] ?? 0.5;

  // --- 3. moisture, and the blight ----------------------------------------
  const wetSeed = rng.fork("moisture").state;
  const blightSeed = rng.fork("blight").state;
  const blight = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      moisture[y * w + x] = fbm(x / 22, y / 22, wetSeed, 4);
      // Coarse, so the blight comes in patches you can walk around rather than
      // a speckle you walk through without noticing.
      blight[y * w + x] = fbm(x / 9, y / 9, blightSeed, 3);
    }
  }

  /*
   * --- 4. biomes -----------------------------------------------------------
   *
   * Climate is measured across the LAND, not across the map.
   *
   * The continent sits in the middle, so on map latitude the whole of it is
   * tropics: the first version produced a world with 0.1% tundra and no
   * glacier or taiga at all. Stretching the gradient over the continent's own
   * north-south reach gives it poles at its top and bottom and an equator
   * across its middle, which is what a continent actually has.
   */
  let landY0 = h, landY1 = 0;
  for (let i = 0; i < n; i++) {
    if (mass[i]! < sea) continue;
    const y = Math.floor(i / w);
    if (y < landY0) landY0 = y;
    if (y > landY1) landY1 = y;
  }
  if (landY1 < landY0) { landY0 = 0; landY1 = h - 1; }
  const midY = (landY0 + landY1) / 2;
  const halfSpan = Math.max(1, (landY1 - landY0) / 2);

  for (let y = 0; y < h; y++) {
    const lat = Math.min(1, Math.abs(y - midY) / halfSpan);
    const warmth = 1 - lat * lat;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mass[i]!;
      if (m < sea - 0.06) { biome[i] = "ocean"; continue; }
      if (m < sea) { biome[i] = "shallows"; continue; }
      if (m < sea + 0.015) { biome[i] = "beach"; continue; }
      // Blight is not a climate — it is a thing that has happened to the land —
      // so it comes from its own field and overrides whatever grew here.
      if (blight[i]! > 0.76) { biome[i] = "void"; continue; }
      biome[i] = biomeFor(height[i]!, warmth, moisture[i]!);
    }
  }

  despeckle(biome, w, h);

  // --- 5. the level itself -------------------------------------------------
  const palette: TileKind[] = [];
  const indexOf = new Map<string, number>();
  const kind = (id: string): number => {
    const had = indexOf.get(id);
    if (had !== undefined) return had;
    const def = tiles.get(id);
    const made: TileKind = {
      id,
      name: def?.name ?? id,
      solid: def?.solid ?? false,
      opaque: def?.opaque ?? false,
      sprite: def?.sprite ?? id,
      cost: def?.cost,
      on: def?.on,
    };
    palette.push(made);
    const at = palette.length - 1;
    indexOf.set(id, at);
    return at;
  };

  const level = new Level(w, h, palette, "The Reach", 0);
  const scatterSeed = rng.fork("scatter").state;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = BIOME_BY_ID.get(biome[i]!) ?? BIOMES[0]!;
      let id = b.ground;
      const r = hash2(x, y, scatterSeed);
      if (b.patch && r < 0.12) id = b.patch;
      else if (b.block && b.density && r > 1 - b.density) id = b.block;
      /*
       * Scenery remembers the ground it grew out of.
       *
       * A tree is a cut-out sprite, so it needs something drawn behind it or it
       * appears to stand in a hole. The ground it stands on is whatever this
       * biome lays down, which is why a pine in the taiga ends up on snow and a
       * tree in a forest ends up on grass without either being special-cased.
       */
      const under = id === b.ground ? id : b.ground;
      level.set(x, y, kind(id), kind(under));
    }
  }

  // --- 6. rivers -----------------------------------------------------------
  carveRivers(level, height, mass, w, h, sea, kind("water"), rng.fork("rivers"));

  // --- 7. where you start, and where the dungeons are ----------------------
  const start = findStart(level, biome, w, h);
  const entrances = placeEntrances(level, biome, w, h, kind("dungeon-door"), start, rng.fork("dungeons"));

  const region = measureRegions(level, start, w, h);
  const villages = placeVillages(level, biome, w, h, start, kind, rng.fork("camps"));

  return { seed, level, biome, start, entrances, region, lairs: [], villages };
}

/**
 * Villages: somewhere to make things, and somewhere to sell them.
 *
 * Each one has a trade — farming, mining, logging, smithing, herbalism, fishing
 * or market — which decides three things at once: which biome it is found in,
 * what its crafting stations are, and what its market has too much and too
 * little of. That last is what makes trade routes exist: a mining camp's ore is a
 * smithing town's raw material, and the smithing town's tools are what the mining
 * camp cannot get.
 *
 * The trade is chosen from the biome rather than at random, so the world makes
 * sense when you look at it — loggers in the forest, fishers on the coast — and
 * so a player can guess what is likely to be over the next hill.
 *
 * The first village is put within easy reach of where you wake up. Without that,
 * a seed could bury every forge four hundred tiles away and the whole crafting
 * and trading half of the game would be invisible for an hour.
 */
function placeVillages(
  level: Level, biome: string[], w: number, h: number, start: Pos,
  kind: (id: string) => number, rng: Rng,
): Village[] {
  const floor = kind("flagstone");
  const wall = kind("wall-wood");
  const names = [
    "Dunmoor", "Tallow Rest", "The Pegs", "Candlewick", "Ashford", "Low Barrow",
    "Mirefoot", "Hobbs Ferry", "Stonemarket", "Thistlewick", "Cold Harbour",
    "Greymill", "Saltpenny", "Harrowgate", "Nettlebed",
  ];
  const out: Village[] = [];

  /** Which trades suit the ground here, in the order they are preferred. */
  const tradesFor = (b: string): VillageTrade[] =>
    VILLAGE_TRADES.filter((t) => TRADE[t].biomes.includes(b));

  const fits = (cx: number, cy: number, maxFromStart: number): VillageTrade | null => {
    if (Math.hypot(cx - start.x, cy - start.y) > maxFromStart) return null;
    // Far enough that no part of the town — walls, huts or the road out — can
    // land on where you wake up. The footprint reaches TOWN_HX from its centre,
    // so the centre has to clear that plus a little breathing room.
    if (Math.hypot(cx - start.x, cy - start.y) < TOWN_HX + 8) return null;
    const here = biome[cy * w + cx] ?? "";
    const trades = tradesFor(here);
    if (!trades.length) return null;
    /*
     * Room for the town. A frontier settlement clears a few trees to raise its
     * walls, so a handful of solid tiles in the plot is fine and they are simply
     * built over; but a plot that is mostly rock or runs off the map is not a
     * place for a town. The core around the centre must be open, so the plaza and
     * the gates are never cut into a cliff.
     */
    let blocked = 0;
    for (let dy = -TOWN_HY; dy <= TOWN_HY; dy++) {
      for (let dx = -TOWN_HX; dx <= TOWN_HX; dx++) {
        if (!level.inBounds(cx + dx, cy + dy)) return null;
        if (!level.solid(cx + dx, cy + dy)) continue;
        if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return null;   // core must be clear
        blocked++;
      }
    }
    if (blocked > 14) return null;                                  // mostly rock: not here
    for (const v of out) if (Math.hypot(v.pos.x - cx, v.pos.y - cy) < 32) return null;

    /*
     * Prefer a trade the world does not have yet.
     *
     * Picking at random from the trades a biome allows produced four farming
     * villages out of five, because plains, savanna and hills are the commonest
     * ground and farming suits all three. A world of farms has no routes in it,
     * and the whole economy then looks broken rather than unlucky. Unseen trades
     * come first; if the biome only allows ones already present, that is a real
     * fact about the land and it takes whichever is rarest.
     */
    const counts = new Map<VillageTrade, number>();
    for (const v of out) counts.set(v.trade, (counts.get(v.trade) ?? 0) + 1);
    const fewest = Math.min(...trades.map((t) => counts.get(t) ?? 0));
    const rarest = trades.filter((t) => (counts.get(t) ?? 0) === fewest);
    return rarest[rng.int(rarest.length)]!;
  };

  const dirt = kind("dirt");
  const well = kind("water");

  /**
   * Raise an actual settlement, not a paved rectangle.
   *
   * A town is a walled enclosure with a gate on each side, a paved plaza down
   * the middle where the market and the townsfolk stand, a well, and a row of
   * huts along the top and bottom — some of them the trade's workshops, with the
   * forge or bench inside and a door onto the street, the rest plain houses. A
   * market town is larger and has more of everything. The middle band is always
   * left open, because that is where `spotInVillage` stands the villagers and
   * where the player meets them.
   */
  const build = (cx: number, cy: number, trade: VillageTrade) => {
    const big = trade === "market";
    const hx = big ? TOWN_HX : TOWN_HX - 1;   // half width; the market fills the plot
    const hy = TOWN_HY;                        // half height

    // 1. Pave the plaza.
    for (let dy = -hy; dy <= hy; dy++) {
      for (let dx = -hx; dx <= hx; dx++) level.set(cx + dx, cy + dy, floor, floor);
    }

    // 2. A wall around it, with a gate centred on each side.
    for (let dx = -hx; dx <= hx; dx++) {
      if (Math.abs(dx) > 1) { level.set(cx + dx, cy - hy, wall, floor); level.set(cx + dx, cy + hy, wall, floor); }
    }
    for (let dy = -hy; dy <= hy; dy++) {
      if (Math.abs(dy) > 1) { level.set(cx - hx, cy + dy, wall, floor); level.set(cx + hx, cy + dy, wall, floor); }
    }

    // 3. A well, off to one side of the plaza so it never blocks the meeting
    //    ground at the centre.
    level.set(cx - hx + 2, cy, well, floor);

    /*
     * 4. Stations, chosen by trade.
     *
     * Every village has a fire — somewhere to cook is the least a place can be —
     * and the other two depend on what it does. A mining camp has a forge
     * because it has the ore; a herbalist has a bench because that is where the
     * brewing happens. That is the reason to visit a particular village rather
     * than the nearest one.
     */
    const stations: string[] = ["campfire"];
    if (trade === "smithing" || trade === "mining" || trade === "market") stations.push("forge");
    if (trade === "herbalism" || trade === "logging" || trade === "market") stations.push("workbench");
    if (stations.length < 2) stations.push(rng.next() < 0.5 ? "forge" : "workbench");

    /*
     * 5. Huts along the top and bottom bands. The first few hold the stations
     * (a workshop with the tool inside and a door onto the plaza); the rest are
     * houses. A hut is a 3x3 box, so it sits clear of the open middle band.
     */
    const row = big ? [-hx + 2, 0, hx - 2] : [-hx + 2, hx - 2];
    const hutSpots: [number, number][] = [];
    for (const dx of row) hutSpots.push([dx, -hy + 1], [dx, hy - 1]);
    hutSpots.forEach(([hxc, hyc], i) => {
      const station = stations[i];
      buildHut(level, cx + hxc, cy + hyc, cy, wall, floor, station ? kind(station) : null);
    });

    // 6. A short dirt approach out of the south gate, so the town has a road in.
    for (let s = 1; s <= 4; s++) level.set(cx, cy + hy + s, dirt, dirt);

    out.push({
      pos: { x: cx, y: cy },
      name: names[out.length % names.length]!,
      trade,
      stations,
      /*
       * How deep its market is.
       *
       * A market town absorbs a lot before its prices move; a hamlet does not.
       * This is what stops one sack of ore crashing a price, and what makes a
       * big town the place to unload a full pack.
       */
      depth: trade === "market" ? 40 : 10 + rng.int(10),
    });
  };

  // The first village: near, so the crafting and trading loops are findable.
  // Then the rest, anywhere that suits a trade, spread out.
  for (const reach of [50, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9]) {
    for (let t = 0; t < 4000; t++) {
      const x = rng.int(w), y = rng.int(h);
      const trade = fits(x, y, reach);
      if (!trade) continue;
      build(x, y, trade);
      break;
    }
  }

  /*
   * At least two different trades, or there is nothing to trade between.
   *
   * On a seed where every village came out the same, the second one is
   * reassigned. A world with four mining camps and nothing else is a world with
   * no routes in it, which would make the whole economy look broken rather than
   * unlucky.
   */
  if (out.length > 1 && new Set(out.map((v) => v.trade)).size === 1) {
    const other = VILLAGE_TRADES.find((t) => t !== out[0]!.trade && TRADE[t].produces.length);
    if (other) out[1]!.trade = other;
  }

  return out;
}

/**
 * Distance from the start, in bands.
 *
 * Measured as straight-line distance rather than by walking, because what this
 * is for is "how deep into the world am I", and a bay you have to walk around
 * is not somewhere the game should treat as dangerous. The scale is set by the
 * furthest land tile from the start rather than by the map's diagonal, so a
 * small continent still has a band 5 somewhere and its far creatures exist.
 */
function measureRegions(level: Level, start: Pos, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let furthest = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (level.solid(x, y)) continue;
      const d = Math.hypot(x - start.x, y - start.y);
      if (d > furthest) furthest = d;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - start.x, y - start.y) / furthest;
      out[y * w + x] = Math.min(REGION_BANDS, Math.floor(d * (REGION_BANDS + 1)));
    }
  }
  return out;
}

/**
 * Give every world boss a lair — every boss, on every seed.
 *
 * Done here, once, rather than in the population pass, so a boss is in the same
 * place every time you load the seed and killing one is permanent.
 *
 * The rule that matters most: a boss ALWAYS gets a lair, because its drops are
 * the only source of the artefacts worth the run, and a seed that happens not to
 * grow a Cinderland must not make Ashmaw's Fang unobtainable. So a boss is placed
 * in a biome its file lists whenever the seed grew one — as far out as the map
 * allows, never within sight of home — and when the seed grew none, the world is
 * given a pocket of that biome, far out, with the boss in it. You still find the
 * Cinder Wyrm on scorched ground; the ground was simply made for it.
 */
export function placeLairs(
  c: Continent,
  bosses: { id: string; biomes?: string[]; region?: { min?: number; max?: number } }[],
  rng: Rng,
  tiles?: Map<string, TileDef>,
): void {
  const w = c.level.w;
  c.lairs = [];
  const taken = new Set<number>();

  for (const boss of bosses) {
    const wants = boss.biomes ?? [];
    const minBand = boss.region?.min ?? 3;

    // In its own biome if the seed has one going spare; otherwise a pocket of it
    // is carved far out, so the lair is themed either way and always exists.
    const present = wants.filter((b) => biomePresent(c, b, taken));
    const spot = (wants.length === 0 || present.length)
      ? findLairSpot(c, new Set(present.length ? present : wants), minBand, taken, rng)
      : (tiles ? carveLairPocket(c, wants[0]!, minBand, taken, rng, tiles) : null)
        // No tiles to paint with, or no room to paint: take the best open ground.
        ?? findLairSpot(c, new Set(), 0, taken, rng);

    const where = spot ?? findLairSpot(c, new Set(), 0, taken, rng);
    if (!where) continue;             // a map with no open land at all: impossible in practice
    taken.add(where.y * w + where.x);
    c.lairs.push({ pos: where, enemy: boss.id });
  }
}

/** Is there open, unclaimed ground of this biome, out of sight of home? */
function biomePresent(c: Continent, biome: string, taken: Set<number>): boolean {
  const w = c.level.w;
  for (let i = 0; i < c.biome.length; i++) {
    if (c.biome[i] !== biome || taken.has(i)) continue;
    const x = i % w, y = (i / w) | 0;
    if (c.level.solid(x, y)) continue;
    if (Math.hypot(x - c.start.x, y - c.start.y) < 24) continue;
    return true;
  }
  return false;
}

/**
 * The best open tile for a lair, preferring the right biome, then remoteness.
 *
 * Scored so the preference is total: a tile of the wanted biome always beats one
 * that is not, a deep tile beats a shallow one, and distance from home breaks the
 * rest. `wants` empty means any biome will do, which is the last-ditch call.
 */
function findLairSpot(
  c: Continent, wants: Set<string>, minBand: number, taken: Set<number>, rng: Rng,
): Pos | null {
  const w = c.level.w;
  let best: { pos: Pos; score: number } | null = null;
  for (let t = 0; t < 6000; t++) {
    const x = rng.int(c.level.w), y = rng.int(c.level.h);
    const i = y * w + x;
    if (taken.has(i) || c.level.solid(x, y)) continue;
    const dist = Math.hypot(x - c.start.x, y - c.start.y);
    if (dist < 16) continue;                               // never on your doorstep
    const biomeOk = !wants.size || wants.has(c.biome[i]!);
    const bandOk = c.region[i]! >= minBand;
    const farOk = dist >= 40;
    const score = (biomeOk ? 4000 : 0) + (bandOk ? 2000 : 0) + (farOk ? 1000 : 0)
      + c.region[i]! * 100 + rng.int(100);
    if (!best || score > best.score) best = { pos: { x, y }, score };
  }
  return best?.pos ?? null;
}

/**
 * Carve a pocket of a biome far out, for a boss whose home the seed did not grow.
 *
 * A rough blob of the biome's own ground with its scenery scattered through it,
 * big enough to read as a place when you arrive. The `biome` array is updated to
 * match, so the lair names itself correctly and the right wildlife spawns around
 * it. Placed far from home and from the other lairs, on whatever open ground is
 * least like what the biome should be — so a patch of Cinderland does not land in
 * the middle of a town.
 */
function carveLairPocket(
  c: Continent, biomeId: string, minBand: number, taken: Set<number>, rng: Rng,
  tiles: Map<string, TileDef>,
): Pos | null {
  const b = BIOME_BY_ID.get(biomeId);
  if (!b) return null;
  const w = c.level.w, h = c.level.h;

  // A far, open, deep-ish centre with room around it.
  let centre: Pos | null = null;
  let bestScore = -1;
  for (let t = 0; t < 6000; t++) {
    const x = 6 + rng.int(w - 12), y = 6 + rng.int(h - 12);
    const i = y * w + x;
    if (taken.has(i) || c.level.solid(x, y)) continue;
    const dist = Math.hypot(x - c.start.x, y - c.start.y);
    if (dist < 40) continue;
    // Not on water, and with a clear-ish surround so the pocket is walkable.
    if (isWater(c.biome[i]!)) continue;
    const score = c.region[i]! * 100 + dist + rng.int(50);
    if (score > bestScore) { bestScore = score; centre = { x, y }; }
  }
  if (!centre) return null;

  const kindOf = (id: string): number => {
    const def = tiles.get(id);
    return c.level.kindIndex({
      id, name: def?.name ?? id, solid: def?.solid ?? false,
      opaque: def?.opaque ?? false, sprite: def?.sprite ?? id, cost: def?.cost, on: def?.on,
    });
  };
  const ground = kindOf(b.ground);
  const patch = b.patch ? kindOf(b.patch) : ground;
  const block = b.block ? kindOf(b.block) : ground;

  const radius = 4;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centre.x + dx, y = centre.y + dy;
      if (!c.level.inBounds(x, y)) continue;
      // A soft round edge, and never paint over water or an existing structure.
      if (Math.hypot(dx, dy) > radius + rng.next() * 0.6) continue;
      const i = y * w + x;
      if (isWater(c.biome[i]!)) continue;
      const r = rng.next();
      const near = Math.hypot(dx, dy) < radius - 1;
      const id = near && b.block && r > 1 - (b.density ?? 0) ? block
        : b.patch && r < 0.12 ? patch : ground;
      const under = id === block ? ground : id;
      c.level.set(x, y, id, under);
      c.biome[i] = biomeId;
    }
  }
  // The centre itself is kept walkable, so the boss is never sealed in rock.
  c.level.set(centre.x, centre.y, ground, ground);
  return centre;
}

const isWater = (b: string): boolean => b === "ocean" || b === "shallows" || b === "beach";

/** The biome for a patch of land, from its height above sea, warmth and wet. */
/**
 * Rub out single-tile biomes.
 *
 * The bands in `biomeFor` are sharp thresholds over three smooth fields, so
 * wherever two of them cross you get the odd lone cell on the far side of a
 * line — one tile of Cinderland in the middle of a forest, which on screen is a
 * square of lava between the trees with no volcano anywhere near it. Each cell
 * that matches none of its eight neighbours is given whichever biome most of
 * them have. Regions survive, because every cell inside one agrees with its
 * neighbours; only the specks go.
 *
 * Water is left alone in both directions: a lake should not be filled in by the
 * land around it, and a one-tile island should not be drowned.
 */
function despeckle(biome: string[], w: number, h: number, passes = 4): void {
  for (let p = 0; p < passes; p++) if (!despeckleOnce(biome, w, h)) return;
}

/** One sweep. Returns whether it changed anything. */
function despeckleOnce(biome: string[], w: number, h: number): boolean {
  const wet = (b: string) => b === "ocean" || b === "shallows" || b === "beach";
  const out = biome.slice();
  let changed = false;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const mine = biome[i]!;
      if (wet(mine)) continue;

      const tally = new Map<string, number>();
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const b = biome[(y + dy) * w + (x + dx)]!;
          if (b === mine) { same++; continue; }
          if (wet(b)) continue;
          tally.set(b, (tally.get(b) ?? 0) + 1);
        }
      }
      if (same > 0) continue;                    // it has company; leave it
      if (!tally.size) continue;                 // a one-tile island; let it be

      let best = mine, bestN = 0;
      for (const [b, n] of tally) if (n > bestN) { best = b; bestN = n; }
      if (best !== mine) { out[i] = best; changed = true; }
    }
  }
  biome.splice(0, biome.length, ...out);
  return changed;
}

function biomeFor(relief: number, warmth: number, wet: number): string {
  // `relief` is 0..1 from its own noise field, so these are bands of the
  // landscape's roughness rather than metres above the sea.
  const above = relief;
  if (above > 0.70) return warmth < 0.3 ? "glacier" : "highland";
  if (above > 0.60) return warmth < 0.35 ? "tundra" : "hills";
  if (warmth > 0.88 && wet < 0.35 && above > 0.50) return "volcanic";
  if (warmth < 0.38) return wet > 0.48 ? "taiga" : "tundra";
  if (warmth > 0.72) {
    if (wet < 0.32) return "desert";
    if (wet < 0.45) return above > 0.52 ? "badlands" : "savanna";
    if (wet > 0.68) return "swamp";
    return "forest";
  }
  if (wet < 0.34) return "savanna";
  if (wet > 0.70) return "swamp";
  if (wet > 0.52) return "forest";
  return "plains";
}

/**
 * Rivers: start high, walk downhill, stop at water.
 *
 * Each step takes the lowest of the eight neighbours. It is a simple rule and
 * it is enough here, because the height field is smooth — the continent has no
 * closed basins for a river to get stuck in.
 */
function carveRivers(level: Level, height: Float32Array, mass: Float32Array, w: number, h: number, sea: number, waterKind: number, rng: Rng): void {
  const sources = 10 + rng.int(8);
  for (let s = 0; s < sources; s++) {
    // Start somewhere high. A few tries, so a flat seed does not stall.
    let x = 0, y = 0, best = -1;
    for (let t = 0; t < 40; t++) {
      const tx = 4 + rng.int(w - 8), ty = 4 + rng.int(h - 8);
      if (mass[ty * w + tx]! < sea) continue;      // must start on land
      const e = height[ty * w + tx]!;
      if (e > best) { best = e; x = tx; y = ty; }
    }
    if (best < 0.55) continue;                     // not high enough to be a source

    for (let step = 0; step < 400; step++) {
      level.set(x, y, waterKind);   // a river is ground, so it is its own floor
      let nx = x, ny = y, low = height[y * w + x]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ax = x + dx, ay = y + dy;
          if (ax < 1 || ay < 1 || ax >= w - 1 || ay >= h - 1) continue;
          const e = height[ay * w + ax]! + (rng.next() - 0.5) * 0.004;
          if (e < low) { low = e; nx = ax; ny = ay; }
        }
      }
      if (nx === x && ny === y) break;        // nowhere lower: the river ends
      x = nx; y = ny;
      if (mass[y * w + x]! < sea) break;      // reached the sea
    }
  }
}

/** Somewhere open, inland and temperate to begin. */
function findStart(level: Level, biome: string[], w: number, h: number): Pos {
  const want = new Set(["plains", "forest", "savanna"]);
  let fallback: Pos | null = null;
  // Spiral out from the middle so the start is central without being fixed.
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const x = Math.round(w / 2 + Math.cos(t) * r);
      const y = Math.round(h / 2 + Math.sin(t) * r);
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      if (level.solid(x, y)) continue;
      const b = biome[y * w + x]!;
      if (want.has(b)) return { x, y };
      if (!fallback && b !== "ocean" && b !== "shallows") fallback = { x, y };
    }
  }
  return fallback ?? { x: Math.floor(w / 2), y: Math.floor(h / 2) };
}

/**
 * Dungeon entrances, spread across the land.
 *
 * Depth rises with distance from the start, so the dungeon nearest where you
 * wake is the shallow one and the far corners of the map are the deep ones.
 * That is the whole difficulty curve of the overworld, and it needs no gating.
 */
function placeEntrances(
  level: Level, biome: string[], w: number, h: number,
  doorKind: number, start: Pos, rng: Rng,
): Continent["entrances"] {
  const out: Continent["entrances"] = [];
  const want = 14;
  const minApart = 14;
  const names = ["Barrow", "Delve", "Hollow", "Warren", "Vault", "Deep", "Pit", "Sink", "Shaft", "Crypt", "Mine", "Reach", "Gullet", "Stair"];

  for (let tries = 0; tries < want * 60 && out.length < want; tries++) {
    const x = 3 + rng.int(w - 6);
    const y = 3 + rng.int(h - 6);
    const b = biome[y * w + x]!;
    if (b === "ocean" || b === "shallows" || b === "beach") continue;
    if (level.solid(x, y)) continue;
    if (Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) < 8) continue;
    if (out.some((e) => Math.max(Math.abs(e.pos.x - x), Math.abs(e.pos.y - y)) < minApart)) continue;

    /*
     * Depth rises with distance from the start, scaled by the furthest point
     * actually reachable on this map rather than by the map's diagonal — the
     * start is near the middle, so no dungeon is ever a full diagonal away and
     * dividing by one squeezed every dungeon in the world into depths 2 to 6.
     */
    const reach = Math.max(
      Math.hypot(start.x, start.y),
      Math.hypot(w - start.x, start.y),
      Math.hypot(start.x, h - start.y),
      Math.hypot(w - start.x, h - start.y),
    );
    /*
     * How hard a dungeon is, not how deep it goes.
     *
     * Every dungeon is the same ten floors; what changes with distance is what
     * lives in them. This number is the difficulty tier the floors are built at,
     * so a dungeon on your doorstep and one at the edge of the map are the same
     * shape and nothing like the same fight.
     */
    const far = Math.hypot(x - start.x, y - start.y) / Math.max(1, reach);
    const depth = Math.max(1, Math.min(12, Math.round(1 + far * 13)));
    out.push({
      pos: { x, y },
      name: `${names[out.length % names.length]} of ${BIOME_BY_ID.get(b)?.name ?? "the Reach"}`,
      depth,
    });
    // The entrance keeps whatever ground was already here behind it.
    level.set(x, y, doorKind, level.floor[y * level.w + x]!);
  }
  return out;
}
