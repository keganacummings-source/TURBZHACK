import { Rng, seedFrom } from "./rng.ts";

/** A stable, per-creature roll that cannot consume or perturb gameplay RNG. */
export function isShiny(seed: number, actorId: string): boolean {
  return new Rng(seedFrom(`${seed}:shiny:${actorId}`)).chance(1 / 48);
}

/** A shiny kill always adds positive bonus coin, even for a low-XP enemy. */
export function shinyBonusCoins(xp: number): number {
  return Math.max(10, Math.round(xp * 0.5));
}
