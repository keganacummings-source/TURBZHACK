/**
 * A level: the tiles, what blocks what, and what you can see.
 *
 * One `Level` is one map — a patch of the overworld or a floor of a dungeon.
 * Tiles are stored as small integers in typed arrays, never as objects, so a
 * large overworld costs bytes rather than megabytes. What a tile MEANS lives in
 * content/tiles/*.json and is looked up by index.
 */
import type { Pos } from "./types.ts";

/** What a tile does, independent of how it looks. */
export type TileKind = {
  id: string;
  name: string;
  /** Cannot be walked through. */
  solid: boolean;
  /** Cannot be seen through. A closed door is solid but a window is not. */
  opaque: boolean;
  /** Sprite key. */
  sprite: string;
  /** Walking in costs this many turns' worth of energy (1 is normal). */
  cost?: number;
  /** Stepping on it triggers this (stairs, portals, water). */
  on?: string;
};

export class Level {
  readonly w: number;
  readonly h: number;
  /** Index into the level's tile palette. */
  readonly tiles: Uint16Array;
  /** Tile kinds, indexed by the numbers in `tiles`. */
  readonly palette: TileKind[];
  /** Seen at least once: drawn dim when out of view, NetHack's remembered map. */
  readonly known: Uint8Array;
  /** In view right now. */
  readonly visible: Uint8Array;
  /** A name for the status line. */
  name: string;
  /** Depth: 0 is the overworld, 1+ is dungeon floors. */
  depth: number;

  constructor(w: number, h: number, palette: TileKind[], name = "", depth = 0) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint16Array(w * h);
    this.known = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
    this.palette = palette;
    this.name = name;
    this.depth = depth;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** The tile kind at a position, or undefined off the map. */
  at(x: number, y: number): TileKind | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.palette[this.tiles[this.idx(x, y)]!];
  }

  set(x: number, y: number, kindIndex: number): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.idx(x, y)] = kindIndex;
  }

  /** Off the map counts as solid, so nothing has to bounds-check before asking. */
  solid(x: number, y: number): boolean {
    const t = this.at(x, y);
    return !t || t.solid;
  }

  opaque(x: number, y: number): boolean {
    const t = this.at(x, y);
    return !t || t.opaque;
  }

  /** The index of a kind in this level's palette, adding it if it is new. */
  kindIndex(kind: TileKind): number {
    const found = this.palette.indexOf(kind);
    if (found >= 0) return found;
    this.palette.push(kind);
    return this.palette.length - 1;
  }
}

/**
 * Field of view: symmetric shadowcasting over the eight octants.
 *
 * Symmetric matters in a game with ranged attacks — if you can see a creature
 * it must be able to see you, or players quite rightly call it cheating.
 *
 * Marks `visible` for this turn and sets `known` for anything newly seen.
 */
export function computeFov(level: Level, from: Pos, radius: number): void {
  level.visible.fill(0);
  const mark = (x: number, y: number) => {
    if (!level.inBounds(x, y)) return;
    const i = level.idx(x, y);
    level.visible[i] = 1;
    level.known[i] = 1;
  };
  mark(from.x, from.y);

  // Each octant is the same scan with the axes swapped and/or negated.
  const octants: [number, number, number, number][] = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
  ];

  for (const [xx, xy, yx, yy] of octants) {
    cast(1, 1, 0);

    /**
     * One octant, row by row, narrowing the visible wedge as walls are met.
     *
     * `start` and `end` are the slopes bounding the wedge still being lit. A
     * wall splits the wedge: everything to one side of it recurses into a
     * narrower scan, and the scan continues past it with a new left edge.
     *
     * The row is walked from dx = -j to 0 with dy = -j fixed, which is the part
     * the first version of this got wrong — it moved both at once, so each row
     * tested a single diagonal tile instead of the whole row, and the result
     * was a sparse star rather than a lit disc.
     */
    function cast(row: number, start: number, end: number): void {
      if (start < end) return;
      let nextStart = start;

      for (let j = row; j <= radius; j++) {
        const dy = -j;
        let blocked = false;

        for (let dx = -j; dx <= 0; dx++) {
          const cx = from.x + dx * xx + dy * xy;
          const cy = from.y + dx * yx + dy * yy;

          // The slopes of this tile's left and right edges.
          const lSlope = (dx - 0.5) / (dy + 0.5);
          const rSlope = (dx + 0.5) / (dy - 0.5);

          if (start < rSlope) continue;      // not reached this tile yet
          if (end > lSlope) break;           // past the far edge of the wedge

          // A round radius, not a square one.
          if (dx * dx + dy * dy <= radius * radius) mark(cx, cy);

          const wall = level.opaque(cx, cy);
          if (blocked) {
            if (wall) { nextStart = rSlope; continue; }
            blocked = false;
            start = nextStart;
          } else if (wall && j < radius) {
            // Light the wedge to the left of this wall, then carry on to its right.
            blocked = true;
            cast(j + 1, start, lSlope);
            nextStart = rSlope;
          }
        }
        if (blocked) break;                  // the row ended on a wall
      }
    }
  }
}

/** Chebyshev distance — the number of steps when diagonals are free, as here. */
export function distance(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * A straight line between two points, Bresenham.
 *
 * Used for "can this creature shoot me" and for the path a bolt takes. Includes
 * both ends.
 */
export function line(a: Pos, b: Pos): Pos[] {
  const out: Pos[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 4096; guard++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/** Is there an unobstructed line between these two points? */
export function hasLineOfSight(level: Level, a: Pos, b: Pos, maxRange = 999): boolean {
  if (distance(a, b) > maxRange) return false;
  const path = line(a, b);
  // Neither endpoint blocks: you can see out of your own tile and into a wall.
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i]!;
    if (level.opaque(p.x, p.y)) return false;
  }
  return true;
}
