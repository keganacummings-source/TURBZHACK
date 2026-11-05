/**
 * Companions: the beasts you talk round, and how they grow.
 *
 * Taming an animal is the start, not the end. A companion has a BOND that rises
 * when you feed it and fight beside it and falls when you let it starve or leave
 * it behind, and a LEVEL of its own that climbs as it kills. The two together are
 * what make a pet a relationship rather than a summon: a well-kept wolf you have
 * had since the first village is worth more than a stronger thing you tamed an
 * hour ago, and losing it means something.
 *
 * All of a companion's extra state lives in `actor.data` under these keys, so an
 * ordinary creature and a companion are the same kind of object and nothing in
 * the engine has to know the difference. This module is the only thing that
 * reads and writes those keys, so the shape is defined once.
 */
import type { Actor } from "./actor.ts";

/** Bond runs 0-100. These are the thresholds that change behaviour. */
export const BOND_MAX = 100;
export const BOND_START = 30;
/** Below this, a hungry or mistreated companion may wander off. */
export const BOND_LEAVE = 10;
/** At or above this, it has learned to trust you, and fights harder for it. */
export const BOND_DEVOTED = 75;

/** Turns a companion can go unfed before its bond starts to slip. */
export const HUNGER_PATIENCE = 120;

export type CompanionState = {
  bond: number;
  /** The turn it was last fed, for working out hunger lazily. */
  fedAt: number;
  xp: number;
  level: number;
  /** Abilities it has learned by levelling, beyond its species' own. */
  learned: string[];
};

/** Read a companion's state, filling in defaults for one freshly tamed. */
export function stateOf(actor: Actor, turn: number): CompanionState {
  const d = actor.data;
  return {
    bond: typeof d["bond"] === "number" ? d["bond"] : BOND_START,
    fedAt: typeof d["fedAt"] === "number" ? d["fedAt"] : turn,
    xp: typeof d["petXp"] === "number" ? d["petXp"] : 0,
    level: typeof d["petLevel"] === "number" ? d["petLevel"] : 1,
    learned: Array.isArray(d["learned"]) ? (d["learned"] as string[]) : [],
  };
}

function write(actor: Actor, s: CompanionState): void {
  actor.data["bond"] = clampBond(s.bond);
  actor.data["fedAt"] = s.fedAt;
  actor.data["petXp"] = s.xp;
  actor.data["petLevel"] = s.level;
  actor.data["learned"] = s.learned;
}

/**
 * Clamp a bond to its range WITHOUT rounding.
 *
 * The drift per turn is a fraction — about a fifth of a point — so rounding here
 * would throw it away every turn and a starving companion would never actually
 * leave. The fraction accumulates in the stored value and is rounded only where
 * it is shown.
 */
export const clampBond = (n: number): number => Math.max(0, Math.min(BOND_MAX, n));

/** The bond as a whole number, for showing. */
export const bondShown = (n: number): number => Math.round(n);

/** Is this actor a companion of the player's? */
export const isCompanion = (actor: Actor): boolean => actor.data["companion"] === true;

/**
 * How hungry a companion is, 0 (just fed) to 1 (famished).
 *
 * Worked out from the turn it was last fed rather than ticked every turn, so a
 * companion costs nothing to keep while you are off doing something else — the
 * same lazy trick the markets use.
 */
export function hunger(actor: Actor, turn: number): number {
  const s = stateOf(actor, turn);
  const since = Math.max(0, turn - s.fedAt);
  return Math.min(1, since / (HUNGER_PATIENCE * 2));
}

/** A word for the bond, for the HUD and the look panel. */
export function bondWord(bond: number): string {
  if (bond >= BOND_DEVOTED) return "devoted";
  if (bond >= 50) return "loyal";
  if (bond >= 25) return "warming to you";
  if (bond > BOND_LEAVE) return "wary";
  return "about to leave";
}

/**
 * Experience to reach a companion's next level.
 *
 * Steeper than the player's, because a pet should grow alongside you rather than
 * outpacing you — a companion that out-levels its owner turns every fight into
 * something it does while you watch.
 */
export const petXpForLevel = (level: number): number => Math.round(20 * Math.pow(level, 1.9));

/**
 * Feed a companion.
 *
 * Resets its hunger, raises its bond, and heals it a little — food is how you
 * keep a pet, and the stablemaster's advice (hurt it, then feed it) turns on
 * this being worth doing. Returns the bond gained, or null if it was not a
 * companion or not hungry enough to care.
 */
export function feed(actor: Actor, turn: number, nourishment = 1): number | null {
  if (!isCompanion(actor)) return null;
  const s = stateOf(actor, turn);
  // A full companion gains little from more food, so you cannot simply pour
  // rations in to max the bond; it has to actually have been hungry.
  const h = hunger(actor, turn);
  const gain = Math.round((6 + h * 20) * nourishment);
  s.bond = clampBond(s.bond + gain);
  s.fedAt = turn;
  write(actor, s);
  actor.pools.hp = Math.min(actor.pools.hpMax, actor.pools.hp + Math.round(actor.pools.hpMax * 0.15 * nourishment));
  return gain;
}

/**
 * A kill near the companion feeds its own experience, and the shared victory
 * strengthens the bond.
 *
 * Returns whether it levelled up, so the caller can grow it and announce it.
 */
export function creditKill(actor: Actor, turn: number, xp: number): boolean {
  if (!isCompanion(actor)) return false;
  const s = stateOf(actor, turn);
  s.xp += xp;
  s.bond = clampBond(s.bond + 1);
  let levelled = false;
  while (s.level < 30 && s.xp >= petXpForLevel(s.level + 1)) {
    s.level++;
    levelled = true;
  }
  write(actor, s);
  return levelled;
}

/**
 * Apply a companion's level to its body.
 *
 * Called once per level gained. Growth is a flat proportion of what it started
 * with, so a wolf stays recognisably a wolf — stronger, but not a dragon — and a
 * devoted one hits a little harder still, which is the mechanical face of
 * loyalty.
 */
export function grow(actor: Actor): void {
  const bonus = 1 + (stateOf(actor, 0).level - 1) * 0.12;
  const base = (actor.data["petBaseHp"] as number | undefined) ?? actor.pools.hpMax;
  actor.data["petBaseHp"] = base;
  const hpMax = Math.round(base * bonus);
  const fraction = actor.pools.hpMax > 0 ? actor.pools.hp / actor.pools.hpMax : 1;
  actor.pools.hpMax = hpMax;
  actor.pools.hp = Math.round(hpMax * fraction);

  const baseMight = (actor.data["petBaseMight"] as number | undefined) ?? actor.stats.might;
  actor.data["petBaseMight"] = baseMight;
  const devoted = stateOf(actor, 0).bond >= BOND_DEVOTED ? 2 : 0;
  actor.stats.might = Math.round(baseMight * bonus) + devoted;
}

/**
 * Let time and circumstance move the bond.
 *
 * Called once per player turn for each companion. A fed, close companion drifts
 * nowhere; a starving one loses heart, and one left far behind loses it faster.
 * Returns true if the companion has given up and should leave.
 */
export function tick(actor: Actor, turn: number, distanceFromPlayer: number): boolean {
  if (!isCompanion(actor)) return false;
  const s = stateOf(actor, turn);
  const h = hunger(actor, turn);

  let drift = 0;
  if (h > 0.5) drift -= (h - 0.5) * 0.4;           // hungry: slipping
  if (distanceFromPlayer > 12) drift -= 0.2;        // abandoned: faster
  if (drift === 0) return false;

  s.bond = clampBond(s.bond + drift);
  write(actor, s);
  return s.bond <= 0;
}
