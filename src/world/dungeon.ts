/**
 * Procedural dungeons: rooms joined by corridors, NetHack's shape.
 *
 * NetHack lays rooms on a loose 3x3 grid of slots and joins neighbouring slots.
 * That is why its levels read as a sensible place rather than a maze — you can
 * hold the layout in your head, and corridors go somewhere.
 *
 * The same approach here, with the grid size growing as you descend so the
 * deeper floors are genuinely bigger rather than just meaner.
 */
import { Rng } from "../engine/rng.ts";
import { Level, type TileKind } from "../engine/grid.ts";
import type { Pos } from "../engine/types.ts";
import type { TileDef } from "../content/schema.ts";

export type Room = { x: number; y: number; w: number; h: number };

/**
 * How deep every dungeon goes.
 *
 * A fixed depth rather than a per-dungeon one, so "ten floors and then the
 * thing at the bottom" is a rule the player can learn once and rely on. What
 * differs between dungeons is what lives in them and what the keeper is, which
 * is the part worth being surprised by.
 */
export const DUNGEON_FLOORS = 10;

export type Dungeon = {
  level: Level;
  rooms: Room[];
  /** Where you arrive coming down, and where the stairs onward are. */
  up: Pos;
  down: Pos;
};

export const DUNGEON_W = 80;
export const DUNGEON_H = 44;

/** The middle of a room. */
export const centreOf = (r: Room): Pos => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });

/**
 * One floor.
 *
 * `depth` is how far down, which widens the room grid and is also what the
 * spawn tables read to decide what lives here.
 */
export function generateDungeon(
  seed: number,
  depth: number,
  tiles: Map<string, TileDef>,
  name = `Floor ${depth}`,
  w = DUNGEON_W,
  h = DUNGEON_H,
): Dungeon {
  const rng = new Rng(seed).fork(`floor:${depth}`);

  const palette: TileKind[] = [];
  const indexOf = new Map<string, number>();
  const kind = (id: string): number => {
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

  // Deeper floors use rougher stone; the first few are worked and wooden.
  const floorId = depth <= 2 ? "flagstone" : "stone";
  const wallId = depth <= 2 ? "wall-wood" : "wall-stone";
  const FLOOR = kind(floorId);
  const WALL = kind(wallId);
  const level = new Level(w, h, palette, name, depth);
  level.tiles.fill(WALL);

  // --- rooms on a loose grid ---------------------------------------------
  const cols = Math.min(5, 3 + Math.floor(depth / 4));
  const rows = 3;
  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  const rooms: Room[] = [];
  const slot: (Room | null)[] = new Array(cols * rows).fill(null);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      // Not every slot gets a room, which is what makes floors differ.
      if (rooms.length > 2 && rng.chance(0.18)) continue;
      const maxW = cellW - 4, maxH = cellH - 4;
      if (maxW < 4 || maxH < 4) continue;
      const rw = rng.range(4, Math.max(4, maxW));
      const rh = rng.range(4, Math.max(4, maxH));
      const x = rx * cellW + 2 + rng.int(Math.max(1, cellW - rw - 3));
      const y = ry * cellH + 2 + rng.int(Math.max(1, cellH - rh - 3));
      const room: Room = { x, y, w: rw, h: rh };
      for (let yy = y; yy < y + rh; yy++) {
        for (let xx = x; xx < x + rw; xx++) level.set(xx, yy, FLOOR);
      }
      slot[ry * cols + rx] = room;
      rooms.push(room);
    }
  }

  // A floor with nothing on it is a bug, not a level: carve one room.
  if (!rooms.length) {
    const room: Room = { x: 4, y: 4, w: Math.min(12, w - 8), h: Math.min(8, h - 8) };
    for (let yy = room.y; yy < room.y + room.h; yy++) {
      for (let xx = room.x; xx < room.x + room.w; xx++) level.set(xx, yy, FLOOR);
    }
    rooms.push(room);
    slot[0] = room;
  }

  // --- corridors between neighbouring slots -------------------------------
  const join = (a: Room, b: Room) => {
    const from = centreOf(a), to = centreOf(b);
    // An L, with the corner on a coin flip, which is how NetHack's look.
    if (rng.chance(0.5)) {
      hall(level, FLOOR, from.x, to.x, from.y, true);
      hall(level, FLOOR, from.y, to.y, to.x, false);
    } else {
      hall(level, FLOOR, from.y, to.y, from.x, false);
      hall(level, FLOOR, from.x, to.x, to.y, true);
    }
  };

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const here = slot[ry * cols + rx];
      if (!here) continue;
      const right = rx + 1 < cols ? slot[ry * cols + rx + 1] : null;
      const below = ry + 1 < rows ? slot[(ry + 1) * cols + rx] : null;
      if (right) join(here, right);
      if (below) join(here, below);
    }
  }

  /*
   * Every room must be reachable.
   *
   * Skipped slots can orphan a room whose only neighbours were both skipped —
   * a floor with a room you cannot walk to is a floor with content you can
   * never see. Rather than detect that case, every room is joined to the one
   * before it as well, which is cheap and makes the floor provably connected.
   */
  for (let i = 1; i < rooms.length; i++) join(rooms[i - 1]!, rooms[i]!);

  // --- stairs -------------------------------------------------------------
  const spread = rng.shuffled(rooms);
  const upRoom = spread[0]!;
  const downRoom = spread.length > 1 ? spread[spread.length - 1]! : upRoom;
  const up = openSpotIn(level, upRoom, rng);
  const down = openSpotIn(level, downRoom, rng, up);
  // Stairs are cut-outs standing on the room's floor, not replacing it.
  level.set(up.x, up.y, kind("stairs-up"), FLOOR);
  /*
   * The bottom floor has no way further down.
   *
   * Every dungeon is DUNGEON_FLOORS deep and ends with its keeper, so a
   * staircase on the last floor would be a promise the generator cannot keep —
   * and a player who took it would arrive on a floor nothing had placed a boss
   * on.
   */
  if (depth < DUNGEON_FLOORS) level.set(down.x, down.y, kind("stairs-down"), FLOOR);

  return { level, rooms, up, down };
}

/** A straight run of floor, either horizontal or vertical. */
function hall(level: Level, floor: number, from: number, to: number, fixed: number, horizontal: boolean): void {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  for (let v = lo; v <= hi; v++) {
    if (horizontal) level.set(v, fixed, floor);
    else level.set(fixed, v, floor);
  }
}

/** A walkable tile inside a room, avoiding one already taken. */
function openSpotIn(level: Level, room: Room, rng: Rng, avoid?: Pos): Pos {
  for (let t = 0; t < 60; t++) {
    const x = room.x + rng.int(room.w);
    const y = room.y + rng.int(room.h);
    if (level.solid(x, y)) continue;
    if (avoid && avoid.x === x && avoid.y === y) continue;
    return { x, y };
  }
  return centreOf(room);
}
