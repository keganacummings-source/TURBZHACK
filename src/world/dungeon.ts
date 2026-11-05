/**
 * Procedural dungeons — shaped more like DCSS than a rigid NetHack grid.
 *
 * Layout ideas borrowed from Crawl's builders (dgn-layouts):
 *   - random corridor trails that wander and intersect
 *   - free-placed rooms punched into the trail network (with door openings)
 *   - cellular-automata caves for organic floors
 *   - "city" boxes for mansions
 *   - pools / water for swamp themes
 *
 * Themes still pick tiles and bias which layout is chosen. Depth still scales
 * size and density. The public API (generateDungeon, Dungeon, themes) is
 * unchanged so the rest of the game does not care.
 */
import { Rng } from "../engine/rng.ts";
import { Level, type TileKind } from "../engine/grid.ts";
import type { Pos } from "../engine/types.ts";
import type { EnemyDef, TileDef } from "../content/schema.ts";

export type RoomShape = "rect" | "chamfer" | "cross" | "cavern" | "pillared" | "octagon";
export type Room = { x: number; y: number; w: number; h: number; shape?: RoomShape };

export const DUNGEON_FLOORS = 10;

export const DUNGEON_THEMES = ["jungle", "swamp", "caves", "mansion", "crypt"] as const;
export type DungeonTheme = typeof DUNGEON_THEMES[number];

export const DUNGEON_THEME_LABEL: Record<DungeonTheme, string> = {
  jungle: "Jungle",
  swamp: "Swamp",
  caves: "Caves",
  mansion: "Mansion",
  crypt: "Crypt",
};

export const DUNGEON_THEME_BIOMES: Record<DungeonTheme, readonly string[]> = {
  jungle: ["forest", "savanna"],
  swamp: ["swamp"],
  caves: ["highland", "hills"],
  mansion: ["plains", "forest"],
  crypt: ["swamp", "highland"],
};

const THEME_STYLE: Record<DungeonTheme, {
  floor: string;
  wall: string;
  /** Occasional alternate floors for visual variety inside the same level. */
  floorVariants: string[];
  /** Alternate walls mixed into borders. */
  wallVariants: string[];
  /** Preferred layout weights — higher = more likely. */
  layouts: Partial<Record<LayoutKind, number>>;
}> = {
  // Primaries are base-game tiles so missing custom sprites never flatten the
  // level into solid fallback colours. Variants layer the new art when present.
  jungle: {
    floor: "grass", wall: "wall-wood",
    floorVariants: ["root-floor", "moss-floor", "dirt", "plank", "grass"],
    wallVariants: ["wall-root", "wall-mossy", "wall-wood"],
    layouts: { rooms: 3, trails: 4, caves: 2, city: 1 },
  },
  swamp: {
    floor: "swamp", wall: "wall-clay",
    floorVariants: ["mud", "moss-floor", "dirt", "clay", "swamp"],
    wallVariants: ["wall-mossy", "wall-root", "wall-clay"],
    layouts: { caves: 3, trails: 2, rooms: 2 },
  },
  caves: {
    floor: "stone", wall: "wall-stone",
    floorVariants: ["cobble", "rubble", "dirt", "stone"],
    wallVariants: ["wall-mossy", "wall-brick", "wall-stone"],
    layouts: { caves: 5, trails: 2, rooms: 1 },
  },
  mansion: {
    floor: "flagstone", wall: "wall-wood",
    floorVariants: ["mosaic", "plank", "marble", "brick", "flagstone"],
    wallVariants: ["wall-brick", "wall-marble", "wall-wood"],
    layouts: { city: 5, rooms: 3, trails: 1 },
  },
  crypt: {
    floor: "ash", wall: "wall-stone",
    floorVariants: ["crypt-floor", "bone-floor", "cobble", "marble", "ash"],
    wallVariants: ["wall-crypt", "wall-bone", "wall-arcane", "wall-stone"],
    layouts: { rooms: 4, trails: 3, city: 2, caves: 1 },
  },
};

type LayoutKind = "trails" | "rooms" | "caves" | "city";

/** Select the seeded keeper from the actual eligible enemy definitions. */
export function dungeonKeeper(
  seed: number, entrance: number, enemies: Iterable<EnemyDef>,
): EnemyDef | undefined {
  const pool = [...enemies]
    .filter((enemy) => !enemy.boss && (enemy.xp ?? 0) >= 150)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!pool.length) return undefined;
  return pool[new Rng(seed).fork(`keeper:${entrance}`).int(pool.length)];
}

export type Dungeon = {
  level: Level;
  rooms: Room[];
  theme: DungeonTheme;
  up: Pos;
  down: Pos;
  boss?: Pos;
  exit?: Pos;
};

export const DUNGEON_W = 80;
export const DUNGEON_H = 44;

export const centreOf = (r: Room): Pos => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------

type KindFn = (id: string) => number;

function makeKind(tiles: Map<string, TileDef>, palette: TileKind[]): KindFn {
  const indexOf = new Map<string, number>();
  return (id: string): number => {
    const had = indexOf.get(id);
    if (had !== undefined) return had;
    const def = tiles.get(id);
    palette.push({
      id,
      name: def?.name ?? id,
      solid: def?.solid ?? false,
      opaque: def?.opaque ?? false,
      sprite: def?.sprite ?? id,
      cost: def?.cost,
      on: def?.on,
    });
    const at = palette.length - 1;
    indexOf.set(id, at);
    return at;
  };
}

// ---------------------------------------------------------------------------
// Carving primitives (DCSS-flavoured)
// ---------------------------------------------------------------------------

function hall(level: Level, floor: number, from: number, to: number, fixed: number, horizontal: boolean, wide = false): void {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  for (let v = lo; v <= hi; v++) {
    if (horizontal) {
      level.set(v, fixed, floor);
      if (wide) level.set(v, fixed + 1, floor);
    } else {
      level.set(fixed, v, floor);
      if (wide) level.set(fixed + 1, v, floor);
    }
  }
}

/** L-shaped corridor between two points, like Crawl's joiners. */
function joinPoints(level: Level, floor: number, from: Pos, to: Pos, rng: Rng, wide = false): void {
  if (rng.chance(0.5)) {
    hall(level, floor, from.x, to.x, from.y, true, wide);
    hall(level, floor, from.y, to.y, to.x, false, wide);
  } else {
    hall(level, floor, from.y, to.y, from.x, false, wide);
    hall(level, floor, from.x, to.x, to.y, true, wide);
  }
}

/**
 * DCSS-style corridor trail: a drunken walk that carves a path, occasionally
 * turning, with a chance to "intersect" (continue through open floor).
 */
function makeTrail(
  level: Level, floor: number, rng: Rng,
  opts: { length?: number; corrLen?: number; margin?: number } = {},
): { begin: Pos; end: Pos } {
  const w = level.w, h = level.h;
  const margin = opts.margin ?? 3;
  const corrLen = opts.corrLen ?? (2 + rng.int(10));
  const targetLen = opts.length ?? (40 + rng.int(120));

  let x = margin + rng.int(Math.max(1, w - margin * 2));
  let y = margin + rng.int(Math.max(1, h - margin * 2));
  const begin = { x, y };
  // Typed as number (not the pick() literal union) so negation on bounce is legal.
  let dx: number = rng.pick([-1, 0, 1] as const)!;
  let dy: number = dx === 0 ? rng.pick([-1, 1] as const)! : 0;
  let steps = 0;
  let sinceTurn = 0;

  while (steps < targetLen) {
    level.set(x, y, floor);
    // Slight width so trails feel like halls, not mouse tunnels.
    if (rng.chance(0.35)) {
      const ox = dy !== 0 ? rng.pick([-1, 1] as const)! : 0;
      const oy = dx !== 0 ? rng.pick([-1, 1] as const)! : 0;
      if (level.inBounds(x + ox, y + oy)) level.set(x + ox, y + oy, floor);
    }

    sinceTurn++;
    if (sinceTurn >= corrLen || rng.chance(0.08)) {
      // Prefer axis-aligned turns (Crawl corridors are ortho).
      if (rng.chance(0.5)) { dx = rng.pick([-1, 1] as const)!; dy = 0; }
      else { dy = rng.pick([-1, 1] as const)!; dx = 0; }
      sinceTurn = 0;
    }

    const nx = x + dx, ny = y + dy;
    if (nx < margin || ny < margin || nx >= w - margin || ny >= h - margin) {
      // Bounce off the edge.
      if (rng.chance(0.5)) { dx = -dx; dy = -dy; }
      else if (dx !== 0) { dx = 0; dy = rng.pick([-1, 1] as const)!; }
      else { dy = 0; dx = rng.pick([-1, 1] as const)!; }
      sinceTurn = 0;
      continue;
    }
    x = nx;
    y = ny;
    steps++;
  }
  return { begin, end: { x, y } };
}

function chooseRoomShape(theme: DungeonTheme, rng: Rng, w: number, h: number): RoomShape {
  const choices: readonly RoomShape[] = theme === "caves"
    ? ["cavern", "cavern", "chamfer", "rect"]
    : theme === "mansion"
      ? ["rect", "rect", "pillared", "chamfer", "octagon"]
      : theme === "crypt"
        ? ["chamfer", "rect", "pillared", "octagon", "cross"]
        : ["rect", "chamfer", "cross", "cavern"];
  return w >= 8 && h >= 8 ? rng.pick(choices)! : rng.pick(["rect", "chamfer"] as const)!;
}

/** Carve a room silhouette (kept from the previous generator, plus octagon). */
function carveRoom(level: Level, room: Room, floor: number, wall: number, theme: DungeonTheme, rng: Rng): void {
  const cx = room.x + (room.w >> 1), cy = room.y + (room.h >> 1);
  const obl = Math.max(1, Math.min(room.w, room.h) >> 2);

  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const dx = x - room.x, dy = y - room.y;
      const corner = (dx < 2 || dx >= room.w - 2) && (dy < 2 || dy >= room.h - 2);
      if (room.shape === "chamfer" && corner && ((dx < 2 && dy < 2) || (dx >= room.w - 2 && dy >= room.h - 2))) continue;
      if (room.shape === "cross" && Math.abs(x - cx) > 1 && Math.abs(y - cy) > 1) continue;
      if (room.shape === "cavern" && corner && rng.chance(theme === "swamp" ? 0.75 : 0.55)) continue;
      if (room.shape === "octagon") {
        // DCSS octa_room: cut corners by oblique amount.
        if (dx + dy < obl) continue;
        if ((room.w - 1 - dx) + dy < obl) continue;
        if (dx + (room.h - 1 - dy) < obl) continue;
        if ((room.w - 1 - dx) + (room.h - 1 - dy) < obl) continue;
      }
      level.set(x, y, floor);
    }
  }
  if (room.shape === "pillared" && room.w >= 10 && room.h >= 8) {
    for (let y = room.y + 2; y < room.y + room.h - 2; y += 4) {
      for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) {
        if (Math.abs(x - cx) <= 1 || Math.abs(y - cy) <= 1) continue;
        level.set(x, y, wall, floor);
      }
    }
  }
  level.set(cx, cy, floor);

  // Ensure the carved shape is connected inside the room bounds.
  const seen = new Uint8Array(room.w * room.h);
  const queue = new Int32Array(seen.length);
  const origin = (cy - room.y) * room.w + (cx - room.x);
  let head = 0, tail = 0;
  seen[origin] = 1;
  queue[tail++] = origin;
  while (head < tail) {
    const index = queue[head++]!;
    const x = room.x + index % room.w, y = room.y + Math.floor(index / room.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < room.x || ny < room.y || nx >= room.x + room.w || ny >= room.y + room.h) continue;
      const next = (ny - room.y) * room.w + (nx - room.x);
      if (seen[next] || level.tiles[level.idx(nx, ny)] !== floor) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  for (let i = 0; i < seen.length; i++) {
    const x = room.x + i % room.w, y = room.y + Math.floor(i / room.w);
    if (!seen[i] && level.tiles[level.idx(x, y)] === floor) level.set(x, y, wall, floor);
  }
}

/** Punch a door opening on a room wall that touches open floor outside. */
function punchDoors(level: Level, room: Room, floor: number, door: number | null, rng: Rng, maxDoors = 3): void {
  const candidates: Pos[] = [];
  const edges: Pos[] = [];
  for (let x = room.x; x < room.x + room.w; x++) {
    edges.push({ x, y: room.y - 1 }, { x, y: room.y + room.h });
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    edges.push({ x: room.x - 1, y }, { x: room.x + room.w, y });
  }
  for (const p of edges) {
    if (!level.inBounds(p.x, p.y)) continue;
    // Door sits on the wall cell; needs open floor on both sides eventually.
    if (level.solid(p.x, p.y)) candidates.push(p);
  }
  const order = rng.shuffled(candidates);
  const n = Math.min(maxDoors, 1 + rng.int(Math.max(1, maxDoors)));
  let placed = 0;
  for (const p of order) {
    if (placed >= n) break;
    // Prefer spots that already have open floor nearby (corridor touch).
    const nearOpen = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = p.x + dx!, ny = p.y + dy!;
      return level.inBounds(nx, ny) && !level.solid(nx, ny);
    });
    if (!nearOpen && placed > 0 && rng.chance(0.6)) continue;
    if (door !== null && rng.chance(0.55)) level.set(p.x, p.y, door, floor);
    else level.set(p.x, p.y, floor);
    placed++;
  }
}

/** Try to place a non-overlapping room; returns null if no space. */
function placeRoom(
  level: Level, rng: Rng, minW: number, maxW: number, minH: number, maxH: number,
  existing: Room[], margin = 2,
): Room | null {
  const w = level.w, h = level.h;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rw = rng.range(minW, maxW);
    const rh = rng.range(minH, maxH);
    const x = margin + rng.int(Math.max(1, w - rw - margin * 2));
    const y = margin + rng.int(Math.max(1, h - rh - margin * 2));
    const room: Room = { x, y, w: rw, h: rh };
    const overlaps = existing.some((o) =>
      x < o.x + o.w + 1 && x + rw + 1 > o.x &&
      y < o.y + o.h + 1 && y + rh + 1 > o.y);
    if (overlaps) continue;
    return room;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layout builders
// ---------------------------------------------------------------------------

/** Trail corridors + rooms attached along the network (DCSS basic-ish). */
function layoutTrails(
  level: Level, floor: number, wall: number, door: number | null,
  theme: DungeonTheme, rng: Rng, depth: number,
): Room[] {
  const rooms: Room[] = [];
  const trailCount = 2 + Math.floor(depth / 3) + rng.int(2);
  const ends: Pos[] = [];
  for (let i = 0; i < trailCount; i++) {
    const t = makeTrail(level, floor, rng, {
      length: 50 + depth * 8 + rng.int(40),
      corrLen: 2 + rng.int(8),
    });
    ends.push(t.begin, t.end);
  }
  // Connect trail ends so the network is less fragmented.
  for (let i = 1; i < ends.length; i += 2) {
    if (rng.chance(0.7)) joinPoints(level, floor, ends[i - 1]!, ends[i]!, rng);
  }

  const roomTarget = 4 + Math.floor(depth / 2) + rng.int(4);
  for (let i = 0; i < roomTarget; i++) {
    const room = placeRoom(level, rng, 5, 5 + rng.int(8), 4, 4 + rng.int(6), rooms);
    if (!room) continue;
    room.shape = chooseRoomShape(theme, rng, room.w, room.h);
    carveRoom(level, room, floor, wall, theme, rng);
    punchDoors(level, room, floor, door, rng, 2 + rng.int(3));
    // Guarantee a corridor from room centre to a nearby open cell.
    const c = centreOf(room);
    let linked = false;
    for (let t = 0; t < 30 && !linked; t++) {
      const tx = 2 + rng.int(level.w - 4), ty = 2 + rng.int(level.h - 4);
      if (level.solid(tx, ty)) continue;
      if (tx >= room.x && tx < room.x + room.w && ty >= room.y && ty < room.y + room.h) continue;
      joinPoints(level, floor, c, { x: tx, y: ty }, rng, theme === "mansion");
      linked = true;
    }
    rooms.push(room);
  }
  return rooms;
}

/** Many free-placed rooms, then MST-style joins (room-heavy crypt/jungle). */
function layoutRooms(
  level: Level, floor: number, wall: number, door: number | null,
  theme: DungeonTheme, rng: Rng, depth: number,
): Room[] {
  const rooms: Room[] = [];
  const target = 6 + Math.floor(depth / 2) + rng.int(5);
  for (let i = 0; i < target; i++) {
    const room = placeRoom(level, rng, 4, 6 + rng.int(7), 4, 5 + rng.int(5), rooms, 2);
    if (!room) continue;
    room.shape = chooseRoomShape(theme, rng, room.w, room.h);
    carveRoom(level, room, floor, wall, theme, rng);
    rooms.push(room);
  }
  if (!rooms.length) {
    const fallback: Room = { x: 8, y: 6, w: 12, h: 8, shape: "rect" };
    carveRoom(level, fallback, floor, wall, theme, rng);
    rooms.push(fallback);
  }
  // Connect each room to the nearest already-connected room (Prim-ish).
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (const i of connected) {
      const a = centreOf(rooms[i]!);
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue;
        const b = centreOf(rooms[j]!);
        const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestJ < 0) break;
    joinPoints(level, floor, centreOf(rooms[bestI]!), centreOf(rooms[bestJ]!), rng, theme === "mansion");
    punchDoors(level, rooms[bestJ]!, floor, door, rng, 2);
    connected.add(bestJ);
  }
  for (const room of rooms) punchDoors(level, room, floor, door, rng, 1 + rng.int(2));
  // A few extra loops so the graph is not a pure tree.
  const extra = 1 + rng.int(Math.max(1, Math.floor(rooms.length / 4)));
  for (let i = 0; i < extra; i++) {
    const a = rooms[rng.int(rooms.length)]!;
    const b = rooms[rng.int(rooms.length)]!;
    if (a === b) continue;
    joinPoints(level, floor, centreOf(a), centreOf(b), rng, theme === "mansion");
  }
  return rooms;
}

/**
 * Cellular-automata cave dig — closer to Crawl's open cave feel than a grid
 * of boxes. Seed noise, smooth, then keep the largest open component.
 */
function layoutCaves(
  level: Level, floor: number, wall: number,
  theme: DungeonTheme, rng: Rng, depth: number,
): Room[] {
  const w = level.w, h = level.h;
  const openChance = 0.42 + Math.min(0.08, depth * 0.005);
  const grid = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      grid[y * w + x] = rng.chance(openChance) ? 1 : 0;
    }
  }
  // Smooth passes.
  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint8Array(grid);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            n += grid[(y + dy) * w + (x + dx)]!;
          }
        }
        const i = y * w + x;
        next[i] = n >= 5 ? 1 : n <= 3 ? 0 : grid[i]!;
      }
    }
    grid.set(next);
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y * w + x]) level.set(x, y, floor);
    }
  }

  // Keep largest connected open region; fill the rest.
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const start = y * w + x;
      if (seen[start] || level.solid(x, y)) continue;
      const cells: number[] = [];
      const q = [start];
      seen[start] = 1;
      while (q.length) {
        const i = q.pop()!;
        cells.push(i);
        const cx = i % w, cy = Math.floor(i / w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const ni = ny * w + nx;
          if (seen[ni] || level.solid(nx, ny)) continue;
          seen[ni] = 1;
          q.push(ni);
        }
      }
      if (cells.length > best.length) best = cells;
    }
  }
  const keep = new Set(best);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!level.solid(x, y) && !keep.has(i)) level.set(x, y, wall);
    }
  }

  // Seed a few carved chambers so spawn/loot still has "rooms".
  const rooms: Room[] = [];
  const chamberN = 2 + rng.int(2 + Math.floor(depth / 4));
  for (let i = 0; i < chamberN; i++) {
    const room = placeRoom(level, rng, 5, 9, 4, 7, rooms, 3);
    if (!room) continue;
    room.shape = "cavern";
    carveRoom(level, room, floor, wall, theme, rng);
    joinPoints(level, floor, centreOf(room), {
      x: best.length ? best[rng.int(best.length)]! % w : centreOf(room).x,
      y: best.length ? Math.floor(best[rng.int(best.length)]! / w) : centreOf(room).y,
    }, rng);
    rooms.push(room);
  }
  if (!rooms.length && best.length) {
    const i = best[Math.floor(best.length / 2)]!;
    const x = i % w, y = Math.floor(i / w);
    rooms.push({ x: x - 2, y: y - 2, w: 5, h: 5, shape: "cavern" });
  }
  return rooms;
}

/** Chaotic city / mansion: packed box rooms with door gaps (DCSS chaotic city). */
function layoutCity(
  level: Level, floor: number, wall: number, door: number | null,
  theme: DungeonTheme, rng: Rng, depth: number,
): Room[] {
  const rooms: Room[] = [];
  const tries = 30 + depth * 4;
  for (let i = 0; i < tries; i++) {
    const rw = 3 + rng.int(7) + rng.int(4);
    const rh = 3 + rng.int(6) + rng.int(3);
    const room = placeRoom(level, rng, rw, rw, rh, rh, rooms, 1);
    if (!room) continue;
    room.shape = rng.chance(0.2) ? "pillared" : rng.chance(0.15) ? "octagon" : "rect";
    // Carve interior only; walls stay as the solid fill — then doors punch out.
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) level.set(x, y, floor);
    }
    if (room.shape === "pillared") carveRoom(level, { ...room, x: room.x + 1, y: room.y + 1, w: room.w - 2, h: room.h - 2 }, floor, wall, theme, rng);
    punchDoors(level, room, floor, door, rng, 2 + rng.int(3));
    rooms.push(room);
  }
  // Street grid: a few long halls so boxes are not isolated.
  const streets = 3 + rng.int(3);
  for (let i = 0; i < streets; i++) {
    if (rng.chance(0.5)) {
      const y = 4 + rng.int(level.h - 8);
      hall(level, floor, 3, level.w - 4, y, true, true);
    } else {
      const x = 4 + rng.int(level.w - 8);
      hall(level, floor, 3, level.h - 4, x, false, true);
    }
  }
  if (!rooms.length) {
    const room: Room = { x: 10, y: 8, w: 14, h: 10, shape: "rect" };
    carveRoom(level, room, floor, wall, theme, rng);
    rooms.push(room);
  }
  // Connect rooms that still look isolated.
  for (let i = 1; i < rooms.length; i++) {
    if (rng.chance(0.4)) continue;
    joinPoints(level, floor, centreOf(rooms[0]!), centreOf(rooms[i]!), rng, true);
  }
  return rooms;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function sprinklePools(
  level: Level, rooms: Room[], floor: number, water: number, rng: Rng, count: number,
): void {
  for (let n = 0; n < count; n++) {
    const room = rooms[rng.int(rooms.length)];
    if (!room || room.w < 6 || room.h < 5) continue;
    const pw = 2 + rng.int(Math.min(4, room.w - 3));
    const ph = 2 + rng.int(Math.min(3, room.h - 3));
    const px = room.x + 1 + rng.int(Math.max(1, room.w - pw - 1));
    const py = room.y + 1 + rng.int(Math.max(1, room.h - ph - 1));
    for (let y = py; y < py + ph; y++) {
      for (let x = px; x < px + pw; x++) {
        if (!level.solid(x, y)) level.set(x, y, water, floor);
      }
    }
  }
}

function ensureConnectivity(level: Level, floor: number, rooms: Room[], rng: Rng): void {
  if (rooms.length < 2) return;
  // Flood from first room centre; join any room centre not reached.
  const w = level.w;
  const start = centreOf(rooms[0]!);
  const seen = new Uint8Array(level.w * level.h);
  const q = [start.y * w + start.x];
  if (!level.solid(start.x, start.y)) seen[q[0]!] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % w, y = Math.floor(i / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!level.inBounds(nx, ny) || level.solid(nx, ny)) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  for (let i = 1; i < rooms.length; i++) {
    const c = centreOf(rooms[i]!);
    if (seen[c.y * w + c.x]) continue;
    joinPoints(level, floor, start, c, rng);
  }
}

function widenRoom(level: Level, room: Room, floor: number, w: number, h: number): Room {
  const cx = room.x + (room.w >> 1), cy = room.y + (room.h >> 1);
  const halfW = Math.max(5, (room.w >> 1) + 1), halfH = Math.max(4, (room.h >> 1) + 1);
  const x0 = Math.max(2, cx - halfW), x1 = Math.min(w - 3, cx + halfW);
  const y0 = Math.max(2, cy - halfH), y1 = Math.min(h - 3, cy + halfH);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) level.set(x, y, floor);
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function openSpotIn(level: Level, room: Room, rng: Rng, avoid?: Pos): Pos {
  for (let t = 0; t < 60; t++) {
    const x = room.x + rng.int(Math.max(1, room.w));
    const y = room.y + rng.int(Math.max(1, room.h));
    if (level.solid(x, y)) continue;
    if (avoid && avoid.x === x && avoid.y === y) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !level.solid(x + dx!, y + dy!))) continue;
    return { x, y };
  }
  return centreOf(room);
}

function pickLayout(theme: DungeonTheme, rng: Rng): LayoutKind {
  const weights = THEME_STYLE[theme].layouts;
  const entries = (Object.entries(weights) as [LayoutKind, number][])
    .filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [k, w] of entries) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return entries[0]?.[0] ?? "rooms";
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * One floor.
 *
 * `depth` widens density and is what spawn tables use. Layout algorithm is
 * picked from the theme's weights so a crypt feels different from caves.
 */
export function generateDungeon(
  seed: number,
  depth: number,
  tiles: Map<string, TileDef>,
  name = `Floor ${depth}`,
  w = DUNGEON_W,
  h = DUNGEON_H,
  theme: DungeonTheme = "caves",
): Dungeon {
  const rng = new Rng(seed).fork(`floor:${depth}`);
  const style = THEME_STYLE[theme];

  const palette: TileKind[] = [];
  const kind = makeKind(tiles, palette);

  const FLOOR = kind(style.floor);
  const WALL = kind(style.wall);
  const DOOR = tiles.has("dungeon-door") ? kind("dungeon-door") : null;
  const WATER = tiles.has("water") ? kind("water")
    : tiles.has("deep-water") ? kind("deep-water") : null;

  const level = new Level(w, h, palette, name, depth);
  level.tiles.fill(WALL);

  const layout = pickLayout(theme, rng);
  let rooms: Room[] = [];
  switch (layout) {
    case "trails":
      rooms = layoutTrails(level, FLOOR, WALL, DOOR, theme, rng, depth);
      break;
    case "caves":
      rooms = layoutCaves(level, FLOOR, WALL, theme, rng, depth);
      break;
    case "city":
      rooms = layoutCity(level, FLOOR, WALL, DOOR, theme, rng, depth);
      break;
    default:
      rooms = layoutRooms(level, FLOOR, WALL, DOOR, theme, rng, depth);
      break;
  }

  if (!rooms.length) {
    const room: Room = { x: 4, y: 4, w: Math.min(12, w - 8), h: Math.min(8, h - 8), shape: "rect" };
    carveRoom(level, room, FLOOR, WALL, theme, rng);
    rooms.push(room);
  }

  ensureConnectivity(level, FLOOR, rooms, rng);

  // Theme dressing.
  if (theme === "swamp" && WATER !== null) {
    sprinklePools(level, rooms, FLOOR, WATER, rng, 2 + Math.floor(depth / 3) + rng.int(3));
  }
  if (theme === "jungle" && WATER !== null && rng.chance(0.5)) {
    sprinklePools(level, rooms, FLOOR, WATER, rng, 1 + rng.int(2));
  }

  // Scatter alternate floor / wall tiles so a level is not one flat texture.
  // Only uses ids that exist in content (kind registers them into the palette).
  const floorVars = style.floorVariants
    .filter((id) => tiles.has(id))
    .map((id) => kind(id));
  const wallVars = style.wallVariants
    .filter((id) => tiles.has(id))
    .map((id) => kind(id));
  if (floorVars.length || wallVars.length) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = level.idx(x, y);
        const t = level.tiles[i]!;
        if (t === FLOOR && floorVars.length && rng.chance(0.28)) {
          level.set(x, y, floorVars[rng.int(floorVars.length)]!);
        } else if (t === WALL && wallVars.length && rng.chance(0.18)) {
          level.set(x, y, wallVars[rng.int(wallVars.length)]!);
        }
      }
    }
  }
  // Occasional pillars / grates / rubble as set dressing inside rooms.
  const decorIds = ["rubble", "grate"].filter((id) => tiles.has(id));
  if (decorIds.length && rooms.length) {
    const decorN = 2 + rng.int(3 + Math.floor(depth / 3));
    for (let n = 0; n < decorN; n++) {
      const room = rooms[rng.int(rooms.length)]!;
      const x = room.x + 1 + rng.int(Math.max(1, room.w - 2));
      const y = room.y + 1 + rng.int(Math.max(1, room.h - 2));
      if (level.solid(x, y)) continue;
      const id = decorIds[rng.int(decorIds.length)]!;
      level.set(x, y, kind(id), FLOOR);
    }
  }

  // --- stairs -------------------------------------------------------------
  const spread = rng.shuffled(rooms);
  const upRoom = spread[0]!;
  const downRoom = spread.length > 1 ? spread[spread.length - 1]! : upRoom;
  const up = openSpotIn(level, upRoom, rng);
  const down = openSpotIn(level, downRoom, rng, up);
  // Exactly one up stair, and one down stair when the dungeon continues.
  // Anything else that looks like stairs is stripped back to floor so the map
  // never shows decorative stair sprites that do nothing.
  const stairsUp = kind("stairs-up");
  const stairsDown = kind("stairs-down");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = level.tiles[level.idx(x, y)]!;
      const id = level.palette[t]?.id;
      if (id === "stairs-up" || id === "stairs-down") level.set(x, y, FLOOR);
    }
  }
  level.set(up.x, up.y, stairsUp, FLOOR);
  if (depth < DUNGEON_FLOORS) level.set(down.x, down.y, stairsDown, FLOOR);

  let boss: Pos | undefined;
  let exit: Pos | undefined;
  if (depth >= DUNGEON_FLOORS) {
    const arena = widenRoom(level, downRoom, FLOOR, w, h);
    boss = centreOf(arena);
    const ex = Math.min(arena.x + arena.w - 2, boss.x + 2);
    exit = { x: ex, y: boss.y };
    level.set(exit.x, exit.y, kind("dungeon-exit"), FLOOR);
  }

  const protectedSpots = [up, down, boss, exit].filter((p): p is Pos => !!p);
  const trapCount = 1 + Math.floor(depth / 2.2) + (depth >= 7 ? 2 : 0);
  for (let tries = 0, placed = 0; tries < trapCount * 80 && placed < trapCount; tries++) {
    const room = rooms[rng.int(rooms.length)]!;
    const x = room.x + rng.int(Math.max(1, room.w));
    const y = room.y + rng.int(Math.max(1, room.h));
    if (level.solid(x, y) || protectedSpots.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1)) continue;
    if (level.at(x, y)?.on) continue;
    level.set(x, y, kind("spiked-pit"), FLOOR);
    placed++;
  }

  return { level, rooms, theme, up, down, boss, exit };
}
