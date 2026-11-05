/**
 * The shapes everything else agrees on.
 *
 * Kept in one small file with no imports, so that content definitions, the
 * engine and the renderer can all refer to the same types without any of them
 * having to import each other. Nothing here has behaviour.
 */

/** A point on a map grid. */
export type Pos = { x: number; y: number };

/** The eight directions you can move, NetHack's `yuhjklbn`. */
export type Dir = { dx: number; dy: number };

export const DIRS: Record<string, Dir> = {
  h: { dx: -1, dy: 0 },   // west
  j: { dx: 0, dy: 1 },    // south
  k: { dx: 0, dy: -1 },   // north
  l: { dx: 1, dy: 0 },    // east
  y: { dx: -1, dy: -1 },  // north-west
  u: { dx: 1, dy: -1 },   // north-east
  b: { dx: -1, dy: 1 },   // south-west
  n: { dx: 1, dy: 1 },    // south-east
};

/** All eight, in a fixed order so iteration is deterministic. */
export const DIR_LIST: readonly Dir[] = [
  DIRS.k!, DIRS.u!, DIRS.l!, DIRS.n!, DIRS.j!, DIRS.b!, DIRS.h!, DIRS.y!,
];

/** What a thing is made of, for resistances. Content files use these names. */
export type DamageKind = "physical" | "fire" | "cold" | "shock" | "poison" | "pure";

/** How an actor feels about the player. */
export type Stance = "hostile" | "neutral" | "friendly";

/**
 * The three pools.
 *
 * Every actor has all three even if it never uses one, because a status effect
 * or an enchantment may want to drain the mana of something that does not cast.
 */
export type Pools = {
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  mana: number;
  manaMax: number;
};

/** A status currently riding on an actor. */
export type ActiveStatus = {
  /** Which status definition this is. */
  id: string;
  /** Turns left. Counted down at the end of the bearer's turn. */
  turns: number;
  /**
   * How hard it bites, set when it was applied.
   *
   * Burning scales with the hit that caused it, so this carries that number
   * rather than the status file having to guess one.
   */
  power: number;
  /** Who caused it, so a kill by burning is still credited to the caster. */
  source?: string;
  /**
   * True on the turn the status was applied (or refreshed).
   *
   * While set, the status tick skips the breakChance roll so a stun or root
   * always does at least one full turn of work before it can be shrugged off.
   * Cleared on the first tick.
   */
  fresh?: boolean;
};

/** One line in the message log. */
export type Message = {
  text: string;
  /** Turn it happened on, so the log can group a turn's events together. */
  turn: number;
  /** Styling only. */
  tone?: "plain" | "good" | "bad" | "magic" | "warn";
  /**
   * How many times in a row this line has been printed.
   *
   * Repeats are counted rather than appended. Walking into the same tree
   * twenty times should read as one line and a number, not twenty lines that
   * push everything you actually wanted to read off the top of the log.
   */
  count?: number;
};

/** What an action did, for the log and for the turn loop. */
export type ActionResult = {
  /** Whether the turn was actually used. A bumped wall costs nothing. */
  tookTurn: boolean;
  /**
   * How many turns' worth of energy it cost, 1 being an ordinary action.
   *
   * This is what makes weapon speed real rather than cosmetic. A dagger costs
   * 0.6 of a turn and a maul 1.2, so the dagger genuinely gets more swings
   * instead of merely saying it is fast — and the difference is paid in the one
   * currency everything in the game shares, which is the world's turn.
   *
   * Left out, it is 1.
   */
  cost?: number;
  /** A ranged attack's flight, from where it was loosed to where it landed. */
  shot?: { from: Pos; to: Pos };
  /** Lines to print. */
  messages?: { text: string; tone?: Message["tone"] }[];
};

/** An action that did nothing and cost nothing. */
export const NO_ACTION: ActionResult = { tookTurn: false };
