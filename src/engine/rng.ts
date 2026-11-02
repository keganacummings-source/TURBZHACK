/**
 * Deterministic randomness.
 *
 * A roguelike lives or dies on this. Every roll in the game — map generation,
 * damage, whether a frozen enemy thaws — goes through an Rng seeded from the
 * run's seed, so the same seed always produces the same game. `Math.random` is
 * never called anywhere in the engine, and there is a test that greps for it.
 *
 * Separate streams matter as much as the seed. If the map and combat share one
 * stream then swinging your sword one extra time changes the next dungeon, and
 * bug reports stop being reproducible. `fork` makes an independent stream from
 * a label, so the map generator's rolls can never be disturbed by yours.
 */

/** A seeded random source. Cheap, deterministic, and good enough for a game. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // 0 is a fixed point of the mixing function, so it would return 0 forever.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** The raw state, so a run can be saved mid-stream and resumed exactly. */
  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = (v >>> 0) || 0x9e3779b9;
  }

  /** mulberry32: one multiply-shift round. Fast, and passes the tests that matter here. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, n). Returns 0 for n <= 0 rather than NaN. */
  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }

  /** An integer in [lo, hi], both ends included — the way dice are written. */
  range(lo: number, hi: number): number {
    if (hi < lo) [lo, hi] = [hi, lo];
    return lo + this.int(hi - lo + 1);
  }

  /** `n` dice of `sides`, as in 2d6. */
  dice(n: number, sides: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += this.range(1, sides);
    return total;
  }

  /** True with probability `p`. p <= 0 is never, p >= 1 is always. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** One item, or undefined for an empty list. */
  pick<T>(list: readonly T[]): T | undefined {
    if (!list.length) return undefined;
    return list[this.int(list.length)];
  }

  /**
   * One item, chosen by weight. Entries with weight <= 0 are never chosen.
   * Used by spawn tables, where a rare enemy is a small number next to a common one.
   */
  weighted<T>(list: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    for (const item of list) total += Math.max(0, weightOf(item));
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    for (const item of list) {
      roll -= Math.max(0, weightOf(item));
      if (roll < 0) return item;
    }
    return list[list.length - 1];
  }

  /** Shuffle a copy, Fisher-Yates. The original is left alone. */
  shuffled<T>(list: readonly T[]): T[] {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i]!, out[j]!] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * An independent stream, named.
   *
   * `rng.fork("dungeon:3")` always gives the same stream for the same seed and
   * label, no matter how many rolls this Rng has made. That is what keeps map
   * generation reproducible while the player is rolling dice at it.
   */
  fork(label: string): Rng {
    let h = this.s ^ 0x85ebca6b;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new Rng(h);
  }
}

/** Turn any string into a seed, so a player can type one in. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0 || 1;
}

/** A seed as the short word a player would share. */
export function seedName(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}
