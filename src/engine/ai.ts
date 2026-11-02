/**
 * What a monster does on its turn.
 *
 * Four behaviours, chosen by one `"ai"` field in an enemy file. Deliberately
 * small: a roguelike's difficulty should come from what creatures ARE — their
 * damage, speed, resistances and the statuses they apply — not from clever
 * pathfinding. Anything that genuinely needs cleverness gets a `script` hook
 * with an `onTurn` export, and that hook can return an action of its own.
 */
import type { Actor } from "./actor.ts";
import { castSpell, moveOrAttack, ready, useAbility, type ActionCtx } from "./actions.ts";
import { distance, hasLineOfSight } from "./grid.ts";
import type { Rng } from "./rng.ts";
import { DIR_LIST, type ActionResult } from "./types.ts";
import type { AbilityDef, EnemyDef, SpellDef } from "../content/schema.ts";

export type AiCtx = ActionCtx & {
  rng: Rng;
  player: Actor;
  enemies: Map<string, EnemyDef>;
  abilities: Map<string, AbilityDef>;
  spells: Map<string, SpellDef>;
};

/** Decide and perform one monster's turn. */
export function monsterTurn(actor: Actor, ctx: AiCtx): ActionResult {
  const def = ctx.enemies.get(actor.def);
  const mode = def?.ai ?? "melee";
  const sight = def?.sight ?? 8;
  const player = ctx.player;

  const dist = distance(actor.pos, player.pos);
  const canSee =
    player.alive &&
    dist <= sight &&
    hasLineOfSight(ctx.level, actor.pos, player.pos, sight);

  // Neutral creatures mind their own business until something changes their
  // mind; the game turns them hostile elsewhere, when they are attacked.
  if (actor.stance !== "hostile") {
    return mode === "skittish" && canSee && dist < 5
      ? flee(actor, ctx)
      : wander(actor, ctx);
  }

  switch (mode) {
    case "wander":
      return canSee && dist <= 1 ? attackPlayer(actor, ctx) : wander(actor, ctx);

    case "skittish":
      return canSee && dist < 6 ? flee(actor, ctx) : wander(actor, ctx);

    case "caster": {
      if (!canSee) return wander(actor, ctx);
      // Cast if anything is affordable and in range.
      const cast = bestSpell(actor, ctx, dist);
      if (cast) return castSpell(ctx, actor, cast, player);
      // Casters keep their distance: back off rather than close in.
      if (dist <= 2) return flee(actor, ctx);
      if (dist <= 1) return attackPlayer(actor, ctx);
      return stepToward(actor, ctx, 1);
    }

    default: {
      if (dist <= 1) return attackPlayer(actor, ctx);
      if (!canSee) return wander(actor, ctx);
      return stepToward(actor, ctx, 1);
    }
  }
}

/** The best ability this actor can afford right now, against an adjacent target. */
function attackPlayer(actor: Actor, ctx: AiCtx): ActionResult {
  const def = ctx.enemies.get(actor.def);
  const options = (def?.abilities ?? [])
    .map((id) => ctx.abilities.get(id))
    .filter((a): a is AbilityDef => !!a)
    .filter((a) => (a.stamina ?? 0) <= actor.pools.stamina)
    .filter((a) => (a.mana ?? 0) <= actor.pools.mana)
    .filter((a) => ready(ctx, actor, String(a.id ?? a.name)));

  // Hardest hit it can pay for. Monsters do not hold anything in reserve.
  options.sort((a, b) => b.damage - a.damage);
  const pick = options[0];
  if (!pick) return { tookTurn: true };     // nothing affordable: it catches its breath
  return useAbility(ctx, actor, pick, ctx.player);
}

/** The best spell this actor can afford and reach with. */
function bestSpell(actor: Actor, ctx: AiCtx, dist: number): SpellDef | undefined {
  const def = ctx.enemies.get(actor.def);
  const options = (def?.spells ?? [])
    .map((id) => ctx.spells.get(id))
    .filter((s): s is SpellDef => !!s)
    .filter((s) => s.mana <= actor.pools.mana)
    .filter((s) => (s.range ?? 1) >= dist)
    .filter((s) => ready(ctx, actor, String(s.id ?? s.name)));
  options.sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0));
  return options[0];
}

/**
 * One step closer, preferring the direction that most reduces the distance.
 *
 * Not a pathfinder. A creature that cannot get round a wall will mill about at
 * it, which is what NetHack's dumber monsters do too, and it keeps the cost of
 * a hundred wandering creatures at nothing.
 */
function stepToward(actor: Actor, ctx: AiCtx, _unused: number): ActionResult {
  const target = ctx.player.pos;
  const options = DIR_LIST
    .map((d) => ({ d, to: { x: actor.pos.x + d.dx, y: actor.pos.y + d.dy } }))
    .filter((o) => !ctx.level.solid(o.to.x, o.to.y))
    .filter((o) => !ctx.actors.some((a) => a.alive && a !== actor && a.pos.x === o.to.x && a.pos.y === o.to.y))
    .sort((a, b) => distance(a.to, target) - distance(b.to, target));

  const best = options[0];
  if (!best || distance(best.to, target) >= distance(actor.pos, target)) {
    return wander(actor, ctx);
  }
  return moveOrAttack(ctx, actor, best.d.dx, best.d.dy, undefined);
}

/** One step away from the player. */
function flee(actor: Actor, ctx: AiCtx): ActionResult {
  const target = ctx.player.pos;
  const options = DIR_LIST
    .map((d) => ({ d, to: { x: actor.pos.x + d.dx, y: actor.pos.y + d.dy } }))
    .filter((o) => !ctx.level.solid(o.to.x, o.to.y))
    .filter((o) => !ctx.actors.some((a) => a.alive && a !== actor && a.pos.x === o.to.x && a.pos.y === o.to.y))
    .sort((a, b) => distance(b.to, target) - distance(a.to, target));

  const best = options[0];
  if (!best) return { tookTurn: true };     // cornered
  return moveOrAttack(ctx, actor, best.d.dx, best.d.dy, undefined);
}

/** A step in a random open direction, or a pause. */
function wander(actor: Actor, ctx: AiCtx): ActionResult {
  // Mostly stand still, so an overworld full of deer is not a stampede.
  if (ctx.rng.chance(0.55)) return { tookTurn: true };
  const dirs = ctx.rng.shuffled(DIR_LIST);
  for (const d of dirs) {
    const nx = actor.pos.x + d.dx, ny = actor.pos.y + d.dy;
    if (ctx.level.solid(nx, ny)) continue;
    if (ctx.actors.some((a) => a.alive && a !== actor && a.pos.x === nx && a.pos.y === ny)) continue;
    return moveOrAttack(ctx, actor, d.dx, d.dy, undefined);
  }
  return { tookTurn: true };
}
