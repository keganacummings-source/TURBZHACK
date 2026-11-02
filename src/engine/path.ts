/**
 * Finding a way there.
 *
 * Right-clicking a tile and choosing "walk here" needs a route, and so does
 * anything later that wants a creature to go somewhere specific. A* over the
 * eight-way grid, with the same movement rules the player has: no walking
 * through walls, and no squeezing diagonally between two of them.
 *
 * The open set is a plain array scanned for its lowest score rather than a
 * binary heap. For the distances this is asked for — a click somewhere on one
 * screen, a few hundred tiles at worst — the scan is faster than maintaining a
 * heap, and a heap is a thing to get wrong for no gain.
 */
import type { Level } from "./grid.ts";
import type { Pos } from "./types.ts";

/** The eight directions, as offsets. */
const STEPS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export type PathOptions = {
  /** Treated as blocked even though the level says otherwise — other creatures. */
  blocked?: (x: number, y: number) => boolean;
  /**
   * Stop next to the target rather than on it.
   *
   * What you want when the target is a creature or a wall: "walk to the goblin"
   * means walk within reach of it, not into the square it is standing in.
   */
  adjacent?: boolean;
  /** Give up after this many tiles are examined. */
  limit?: number;
};

/**
 * A route from `from` to `to`, excluding the square you are standing on.
 *
 * Returns an empty array when there is no way through, which is the same answer
 * as "you are already there" — both mean there are no steps to take.
 */
export function findPath(level: Level, from: Pos, to: Pos, opts: PathOptions = {}): Pos[] {
  const { blocked, adjacent = false, limit = 20000 } = opts;
  const w = level.w;
  const key = (x: number, y: number) => y * w + x;

  const done = (x: number, y: number) =>
    adjacent
      ? Math.max(Math.abs(x - to.x), Math.abs(y - to.y)) <= 1
      : x === to.x && y === to.y;

  if (done(from.x, from.y)) return [];

  const passable = (x: number, y: number): boolean => {
    if (!level.inBounds(x, y)) return false;
    if (level.solid(x, y)) return false;
    if (blocked?.(x, y)) return false;
    return true;
  };

  // Chebyshev, because a diagonal step costs the same as a straight one. Using
  // Euclidean here would under-estimate and make A* explore far more than it
  // needs to; using Manhattan would over-estimate and give wrong-looking routes.
  const guess = (x: number, y: number) =>
    Math.max(Math.abs(x - to.x), Math.abs(y - to.y));

  const cameFrom = new Map<number, number>();
  const cost = new Map<number, number>();
  const open: { x: number; y: number; f: number }[] = [];

  const startKey = key(from.x, from.y);
  cost.set(startKey, 0);
  open.push({ x: from.x, y: from.y, f: guess(from.x, from.y) });

  let examined = 0;
  while (open.length) {
    if (++examined > limit) return [];

    let bestAt = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bestAt]!.f) bestAt = i;
    const here = open.splice(bestAt, 1)[0]!;
    const hereKey = key(here.x, here.y);

    if (done(here.x, here.y)) {
      const route: Pos[] = [];
      let at = hereKey;
      while (at !== startKey) {
        route.push({ x: at % w, y: Math.floor(at / w) });
        const prev = cameFrom.get(at);
        if (prev === undefined) break;
        at = prev;
      }
      return route.reverse();
    }

    const soFar = cost.get(hereKey) ?? 0;
    for (const [dx, dy] of STEPS) {
      const nx = here.x + dx, ny = here.y + dy;
      if (!passable(nx, ny)) continue;
      /*
       * No cutting a corner between two walls.
       *
       * Without this the route happily slips through the gap where two walls
       * meet at a diagonal, which the move code then refuses — so the walk
       * would stop dead halfway for no reason the player can see.
       */
      if (dx && dy && (level.solid(here.x + dx, here.y) || level.solid(here.x, here.y + dy))) continue;

      const step = level.at(nx, ny)?.cost ?? 1;
      const next = soFar + Math.max(1, step);
      const nextKey = key(nx, ny);
      const had = cost.get(nextKey);
      if (had !== undefined && had <= next) continue;

      cost.set(nextKey, next);
      cameFrom.set(nextKey, hereKey);
      open.push({ x: nx, y: ny, f: next + guess(nx, ny) });
    }
  }

  return [];
}
