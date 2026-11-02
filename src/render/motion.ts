/**
 * Sliding between tiles.
 *
 * The game is turn-based and nothing here changes that: an actor's position is
 * still a whole tile, and the move has already happened by the time this sees
 * it. All this does is remember where something *was* and draw it part of the
 * way, so a step reads as a step rather than a cut.
 *
 * Kept entirely in the renderer, away from the engine, because motion is a
 * presentation concern — the rules must not depend on an animation having
 * finished, or a fast clicker would be playing a different game from a slow one.
 */
import type { Actor } from "../engine/actor.ts";

/** How long a step takes on screen. */
export const SLIDE_MS = 110;

type Slide = { fromX: number; fromY: number; toX: number; toY: number; started: number };

export type Motion = {
  slides: Map<string, Slide>;
  /** Where each actor was last seen, so a change can be noticed. */
  seen: Map<string, { x: number; y: number }>;
};

export function newMotion(): Motion {
  return { slides: new Map(), seen: new Map() };
}

/**
 * Notice who has moved since last time and start their slides.
 *
 * Called once per frame rather than hooked into movement, so it works for
 * everything — the player, monsters taking their turn, a companion following —
 * without any of them having to report anything.
 *
 * A jump of more than one tile is NOT animated. That is a staircase, a blink or
 * a fresh level, and sliding a creature smoothly across forty tiles of rock
 * would be a lie about what happened.
 */
export function noteMoves(motion: Motion, actors: Actor[], now: number): void {
  const live = new Set<string>();
  for (const a of actors) {
    live.add(a.id);
    const was = motion.seen.get(a.id);
    motion.seen.set(a.id, { x: a.pos.x, y: a.pos.y });
    if (!was) continue;
    if (was.x === a.pos.x && was.y === a.pos.y) continue;
    if (Math.abs(was.x - a.pos.x) > 1 || Math.abs(was.y - a.pos.y) > 1) {
      motion.slides.delete(a.id);
      continue;
    }
    motion.slides.set(a.id, { fromX: was.x, fromY: was.y, toX: a.pos.x, toY: a.pos.y, started: now });
  }

  // Forget anything that has left the level, or the maps grow for the whole run.
  for (const id of [...motion.seen.keys()]) if (!live.has(id)) motion.seen.delete(id);
  for (const id of [...motion.slides.keys()]) if (!live.has(id)) motion.slides.delete(id);
}

/**
 * How far from its own tile to draw something, in tiles.
 *
 * Eased so the step has some weight at both ends instead of reading as a
 * constant-speed glide; a creature that starts and stops abruptly looks like it
 * is on rails.
 */
export function offsetOf(motion: Motion, id: string, now: number): { dx: number; dy: number } {
  const slide = motion.slides.get(id);
  if (!slide) return { dx: 0, dy: 0 };
  const t = (now - slide.started) / SLIDE_MS;
  if (t >= 1) { motion.slides.delete(id); return { dx: 0, dy: 0 }; }
  const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  const back = 1 - eased;
  return {
    dx: (slide.fromX - slide.toX) * back,
    dy: (slide.fromY - slide.toY) * back,
  };
}

/** Is anything still moving? The app keeps drawing frames while this is true. */
export function moving(motion: Motion): boolean {
  return motion.slides.size > 0;
}
