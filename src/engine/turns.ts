/**
 * The turn loop.
 *
 * NetHack's model, which is the one the game is meant to feel like: the world
 * is frozen until you act, and then everything else acts once before it freezes
 * again. Nothing happens on a timer, so you can sit and think for an hour and
 * the game is exactly where you left it.
 *
 * Speed is an energy system rather than a turn order. Everyone gains their
 * `speed` in energy per tick and acts when they reach 100, spending 100 to do
 * it. A creature at 140 therefore acts roughly once and a half per turn and a
 * golem at 60 acts rather less than once, without the scheduler knowing what
 * any of them are, and without the common case costing anything.
 */
import type { Actor } from "./actor.ts";
import type { Rng } from "./rng.ts";
import type { Level } from "./grid.ts";
import { tickStatuses, type StatusDef } from "./status.ts";
import type { ActionResult, Message } from "./types.ts";

/** The energy it costs to act once. */
export const ENERGY_PER_ACTION = 100;

export type TurnContext = {
  level: Level;
  actors: Actor[];
  rng: Rng;
  statuses: Map<string, StatusDef>;
  /** The game's turn counter. */
  turn: number;
  log: (text: string, tone?: Message["tone"]) => void;
};

/** What an actor wants to do, decided by the player's input or by the AI. */
export type Intent = (actor: Actor, ctx: TurnContext) => ActionResult;

/**
 * Run the world forward until the player can act again.
 *
 * Call this after the player's own action has been resolved. It gives everyone
 * else their turns, ticks statuses, and returns once the player has the energy
 * to move again — which is the exact moment control returns to the keyboard.
 *
 * `decide` is how an enemy chooses what to do; it is passed in rather than
 * imported so the AI can be swapped out, and so tests can drive actors with
 * scripted intents.
 */
export function runUntilPlayerTurn(ctx: TurnContext, decide: (a: Actor, c: TurnContext) => ActionResult): void {
  const player = ctx.actors.find((a) => a.isPlayer);
  if (!player) return;

  // A hard cap rather than `while (true)`: if something ever ends up with zero
  // speed, this would spin forever and take the browser tab with it.
  for (let guard = 0; guard < 10000; guard++) {
    if (!player.alive) return;
    if (player.energy >= ENERGY_PER_ACTION) return;

    // One tick: everybody gains energy.
    for (const a of ctx.actors) {
      if (a.alive) a.energy += Math.max(1, a.speed);
    }
    ctx.turn++;

    // Everyone with enough energy acts, in a fixed order so a turn is
    // reproducible from the seed. The player is skipped — this function exists
    // to hand control back to them, not to act for them.
    for (const a of [...ctx.actors]) {
      if (!a.alive || a.isPlayer) continue;
      while (a.energy >= ENERGY_PER_ACTION && a.alive) {
        a.energy -= ENERGY_PER_ACTION;
        takeTurn(a, ctx, decide);
      }
    }
    endOfTick(ctx);
  }
}

/** One actor's turn: statuses first, then it acts if it still can. */
export function takeTurn(actor: Actor, ctx: TurnContext, decide: (a: Actor, c: TurnContext) => ActionResult): void {
  if (!actor.alive) return;

  /*
   * Statuses tick BEFORE the action, and this is the difference between freeze
   * being useful and being decorative. The thaw roll happens here, so a frozen
   * creature that breaks out this turn gets to act this turn — and one that
   * does not, loses the turn entirely rather than acting at reduced power.
   */
  const byId = new Map(ctx.actors.map((a) => [a.id, a]));
  const ticked = tickStatuses(actor, ctx.statuses, ctx.rng, byId);
  for (const m of ticked.messages) ctx.log(m.text, m.tone);
  if (ticked.killed || !actor.alive) return;

  if (!actor.canAct) return;   // still frozen: the turn is spent standing there

  const result = decide(actor, ctx);
  for (const m of result.messages ?? []) ctx.log(m.text, m.tone);
}

/** Bookkeeping after every tick: recovery, and clearing out the dead. */
export function endOfTick(ctx: TurnContext): void {
  for (const a of ctx.actors) a.endTurnRecovery();
  // Dead actors are dropped here rather than the instant they die, so that a
  // kill message and its corpse both land in the same turn's log.
  for (let i = ctx.actors.length - 1; i >= 0; i--) {
    const a = ctx.actors[i]!;
    if (!a.alive && !a.isPlayer) ctx.actors.splice(i, 1);
  }
}

/**
 * The player acted. Spend their energy, tick their statuses, and run the world
 * on until it is their turn again.
 *
 * This is the one entry point the UI calls, so the order of these three things
 * is defined in exactly one place.
 */
export function playerActed(
  ctx: TurnContext,
  result: ActionResult,
  decide: (a: Actor, c: TurnContext) => ActionResult,
): void {
  const player = ctx.actors.find((a) => a.isPlayer);
  if (!player) return;
  for (const m of result.messages ?? []) ctx.log(m.text, m.tone);
  if (!result.tookTurn) return;

  player.energy -= ENERGY_PER_ACTION;

  const byId = new Map(ctx.actors.map((a) => [a.id, a]));
  const ticked = tickStatuses(player, ctx.statuses, ctx.rng, byId);
  for (const m of ticked.messages) ctx.log(m.text, m.tone);

  runUntilPlayerTurn(ctx, decide);
}
