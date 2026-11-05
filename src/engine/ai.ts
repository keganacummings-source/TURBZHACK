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

  // A tamed beast or a hired ally fights for you and keeps to your heel. It is
  // the same kind of object as any monster — only the `companion` flag and the
  // friendly stance tell it apart — so its whole behaviour lives here.
  if (actor.data["companion"] === true) return companionTurn(actor, ctx, sight, mode);

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
      // Out of mana (or no spell in range): still fight when adjacent, otherwise
      // keep casting distance so the next turn can try again after regen.
      if (dist <= 1) return attackPlayer(actor, ctx);
      if (dist <= 3) return flee(actor, ctx);
      return stepToward(actor, ctx, 1);
    }

    default: {
      if (dist <= 1) return attackPlayer(actor, ctx);
      if (!canSee) return wander(actor, ctx);
      return stepToward(actor, ctx, 1);
    }
  }
}

/** Melee the player with whatever is affordable this turn. */
function attackPlayer(actor: Actor, ctx: AiCtx): ActionResult {
  return attackTarget(actor, ctx, ctx.player);
}

/**
 * Moves an enemy may swing, including free fallbacks so a spent stamina/mana
 * bar never means a blank turn.
 *
 * Order of sources:
 *   1. The enemy definition's listed abilities
 *   2. Moves stored on the actor at spawn (`data.extraAbilities`)
 *   3. Universal free punch, and a free bite for beasts that already bite
 *   4. Kick / staff-strike when those files exist, as mid-cost alternatives
 */
function abilityPool(actor: Actor, ctx: AiCtx): AbilityDef[] {
  const def = ctx.enemies.get(actor.def);
  const ids = new Set<string>(def?.abilities ?? []);
  const extras = actor.data["extraAbilities"];
  if (Array.isArray(extras)) for (const id of extras) if (typeof id === "string") ids.add(id);

  // Free fallback so spent creatures still fight.
  ids.add("punch");
  // Beasts that bite get the free bite kept even if somehow stripped.
  if ((def?.abilities ?? []).includes("bite")) ids.add("bite");
  // Mid-cost alternatives for humanoids with weapon moves.
  const weaponish = [...ids].some((id) =>
    ["slash", "cleave", "staff-strike", "smash", "bash"].includes(id));
  if (weaponish) {
    if (ctx.abilities.has("kick")) ids.add("kick");
    if (ctx.abilities.has("staff-strike")) ids.add("staff-strike");
  }

  const out: AbilityDef[] = [];
  for (const id of ids) {
    const a = ctx.abilities.get(id);
    if (a) out.push({ ...a, id: a.id ?? id });
  }
  return out;
}

/**
 * Pick an affordable ability with variety — not always the hardest hit.
 *
 * Weighting:
 *   - higher damage is preferred, but not exclusively
 *   - cheaper moves are favoured when stamina is low so the creature keeps
 *     pressure up rather than waiting every other turn
 *   - a free punch is always available as last resort
 */
function attackTarget(actor: Actor, ctx: AiCtx, target: Actor): ActionResult {
  const options = abilityPool(actor, ctx)
    .filter((a) => (a.stamina ?? 0) <= actor.pools.stamina)
    .filter((a) => (a.mana ?? 0) <= actor.pools.mana)
    .filter((a) => ready(ctx, actor, String(a.id ?? a.name)));

  if (!options.length) return { tookTurn: true };

  const staminaFrac = actor.pools.stamina / Math.max(1, actor.pools.staminaMax);
  const weight = (a: AbilityDef): number => {
    const dmg = Math.max(1, a.damage ?? 1);
    const cost = a.stamina ?? 0;
    // Low stamina: prefer cheap / free moves so the fight stays lively.
    const costBias = staminaFrac < 0.35
      ? (cost === 0 ? 3 : cost <= 10 ? 1.5 : 0.4)
      : (cost === 0 ? 0.7 : 1);
    return dmg * costBias;
  };

  // Weighted pick among the top few so two goblins do not always slash.
  options.sort((a, b) => weight(b) - weight(a));
  const contenders = options.slice(0, Math.min(4, options.length));
  const total = contenders.reduce((s, a) => s + weight(a), 0);
  let roll = ctx.rng.next() * total;
  let pick = contenders[0]!;
  for (const a of contenders) {
    roll -= weight(a);
    if (roll <= 0) { pick = a; break; }
  }
  return useAbility(ctx, actor, pick, target);
}

/**
 * A companion's turn: fight what threatens you, otherwise stay close.
 *
 * It engages the nearest hostile — but only one that is near YOU or right on top
 * of it, so a pet never charges off across the map after something and strands
 * itself. With nothing to fight, it closes to your heel and waits, a step or two
 * back so it is not forever standing in the doorway you are trying to walk
 * through.
 */
function companionTurn(actor: Actor, ctx: AiCtx, sight: number, mode: string): ActionResult {
  const player = ctx.player;
  const foe = nearestHostile(actor, ctx, sight);
  if (foe) {
    const toFoe = distance(actor.pos, foe.pos);
    const foeToPlayer = distance(foe.pos, player.pos);
    // Only worth engaging if the threat is close to the pack, not a distant
    // wanderer: within reach of the pet, or within a short ring around you.
    if (toFoe <= 1.5 || foeToPlayer <= 6) {
      if (mode === "caster") {
        const cast = bestSpell(actor, ctx, toFoe);
        if (cast) return castSpell(ctx, actor, cast, foe);
        if (toFoe <= 1.5) return attackTarget(actor, ctx, foe);
        if (toFoe <= 3) return flee(actor, ctx);   // keep casting distance
      }
      if (toFoe <= 1.5) return attackTarget(actor, ctx, foe);
      return stepTowardPos(actor, ctx, foe.pos);
    }
  }

  // Nothing to fight: heel. Close the gap if you have drifted, else hold.
  const toPlayer = distance(actor.pos, player.pos);
  if (toPlayer > 2.5) return stepTowardPos(actor, ctx, player.pos);
  return { tookTurn: true };
}

/** The nearest hostile creature within range, by straight-line distance. */
function nearestHostile(actor: Actor, ctx: AiCtx, range: number): Actor | undefined {
  let best: Actor | undefined;
  let bestD = Infinity;
  for (const a of ctx.actors) {
    if (!a.alive || a.stance !== "hostile") continue;
    const d = distance(actor.pos, a.pos);
    if (d <= range && d < bestD) { best = a; bestD = d; }
  }
  return best;
}

/**
 * A spell this actor can afford and reach, weighted so casters do not always
 * fire the same bolt — and so a drained caster simply returns undefined and
 * falls through to melee.
 */
function bestSpell(actor: Actor, ctx: AiCtx, dist: number): SpellDef | undefined {
  const def = ctx.enemies.get(actor.def);
  const extras = actor.data["extraSpells"];
  const ids = new Set<string>(def?.spells ?? []);
  if (Array.isArray(extras)) for (const id of extras) if (typeof id === "string") ids.add(id);

  const options = [...ids]
    .map((id) => ctx.spells.get(id))
    .filter((s): s is SpellDef => !!s)
    .filter((s) => (s.mana ?? 0) <= actor.pools.mana)
    .filter((s) => (s.range ?? 1) >= dist)
    .filter((s) => ready(ctx, actor, String(s.id ?? s.name)));
  if (!options.length) return undefined;

  // Weighted by damage; low-mana favours cheaper casts.
  const manaFrac = actor.pools.mana / Math.max(1, actor.pools.manaMax);
  const weight = (s: SpellDef): number => {
    const dmg = Math.max(1, s.damage ?? 1);
    const cost = s.mana ?? 0;
    const costBias = manaFrac < 0.35
      ? (cost <= 8 ? 2 : 0.5)
      : 1;
    return dmg * costBias;
  };
  options.sort((a, b) => weight(b) - weight(a));
  const contenders = options.slice(0, Math.min(3, options.length));
  const total = contenders.reduce((s, a) => s + weight(a), 0);
  let roll = ctx.rng.next() * total;
  for (const s of contenders) {
    roll -= weight(s);
    if (roll <= 0) return s;
  }
  return contenders[0];
}

/**
 * One step closer, preferring the direction that most reduces the distance.
 *
 * Not a pathfinder. A creature that cannot get round a wall will mill about at
 * it, which is what NetHack's dumber monsters do too, and it keeps the cost of
 * a hundred wandering creatures at nothing.
 */
function stepToward(actor: Actor, ctx: AiCtx, _unused: number): ActionResult {
  return stepTowardPos(actor, ctx, ctx.player.pos);
}

/** One step toward an arbitrary position, attacking into it if a foe is there. */
function stepTowardPos(actor: Actor, ctx: AiCtx, target: { x: number; y: number }): ActionResult {
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
