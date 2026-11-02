/**
 * The things an actor can actually do on its turn.
 *
 * Every action returns an `ActionResult` saying whether it used the turn. That
 * distinction is load-bearing in a roguelike: walking into a wall, or trying to
 * cast with no mana, must NOT pass the turn to the monsters, or the game
 * punishes you for a mistyped key.
 *
 * Nothing here knows about any specific spell or ability. They are all driven
 * by their content files, so the engine never grows a branch per content item.
 */
import type { Actor } from "./actor.ts";
import { applyDamage, rollToHit } from "./combat.ts";
import { distance, hasLineOfSight, line, type Level } from "./grid.ts";
import type { Rng } from "./rng.ts";
import { applyStatus, type StatusDef } from "./status.ts";
import type { AbilityDef, SpellDef } from "../content/schema.ts";
import type { ActionResult, DamageKind, Pos } from "./types.ts";

/** Everything an action needs to reach. */
export type ActionCtx = {
  level: Level;
  /** Needed for the to-hit roll. */
  rng: Rng;
  actors: Actor[];
  statuses: Map<string, StatusDef>;
  turn: number;
  /** Cooldowns, keyed `actorId:abilityOrSpellId`. */
  cooldowns: Map<string, number>;
};

/** Whoever is standing on a tile, if anyone. */
export function actorAt(actors: Actor[], x: number, y: number): Actor | undefined {
  return actors.find((a) => a.alive && a.pos.x === x && a.pos.y === y);
}

/** Is this spell or ability off cooldown for this actor? */
export function ready(ctx: ActionCtx, actor: Actor, id: string): boolean {
  const until = ctx.cooldowns.get(`${actor.id}:${id}`) ?? 0;
  return ctx.turn >= until;
}

function startCooldown(ctx: ActionCtx, actor: Actor, id: string, turns?: number): void {
  if (!turns || turns <= 0) return;
  ctx.cooldowns.set(`${actor.id}:${id}`, ctx.turn + turns);
}

/**
 * Fill in a content file's `say` line.
 *
 * The player is called "You", which is second person, while every monster is
 * third person — so one template cannot serve both without help, and the first
 * version printed "You punches Wolf."
 *
 * Content writes the verb with a `{s}` or `{es}` token on it:
 *
 *     "{caster} punch{es} {target}."   ->  "You punch Wolf."
 *                                      ->  "Goblin punches you."
 *
 * which keeps the grammar in the file that owns the sentence rather than in a
 * list of irregular verbs in here.
 */
export function say(text: string, caster: Actor, target?: Actor): string {
  const second = caster.isPlayer;
  return text
    .replace(/\{caster\}/g, caster.name)
    .replace(/\{target\}/g, target ? objectName(target) : "it")
    .replace(/\{es\}/g, second ? "" : "es")
    .replace(/\{s\}/g, second ? "" : "s");
}

/** How to refer to an actor in the middle of a sentence. */
export function objectName(actor: Actor): string {
  return actor.isPlayer ? "you" : actor.name;
}

/**
 * Walk one step, or attack whoever is standing there.
 *
 * NetHack's rule, and the reason movement feels right: moving INTO a hostile
 * creature is an attack, so you never have to choose a separate "attack" verb
 * for the overwhelmingly common case.
 */
export function moveOrAttack(
  ctx: ActionCtx,
  actor: Actor,
  dx: number,
  dy: number,
  defaultAttack: AbilityDef | undefined,
): ActionResult {
  const nx = actor.pos.x + dx;
  const ny = actor.pos.y + dy;

  const occupant = actorAt(ctx.actors, nx, ny);
  if (occupant && occupant !== actor) {
    // Walking into something neutral or friendly swaps nothing and attacks
    // nothing — you have to mean it, with an explicit attack key.
    if (occupant.stance !== "hostile" && actor.isPlayer) {
      return { tookTurn: false, messages: [{ text: `${occupant.name} is in the way. Attack it deliberately if you mean to.`, tone: "warn" }] };
    }
    if (!defaultAttack) return { tookTurn: false };
    return useAbility(ctx, actor, defaultAttack, occupant);
  }

  if (ctx.level.solid(nx, ny)) {
    const what = ctx.level.at(nx, ny)?.name ?? "the edge of the world";
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `${what} blocks the way.`, tone: "plain" }] : [] };
  }

  actor.pos = { x: nx, y: ny };
  return { tookTurn: true };
}

/** Stand still for a turn. Always succeeds, which is what makes it useful for waiting out a burn. */
export function wait(): ActionResult {
  return { tookTurn: true };
}

/**
 * Use an ability — punch, kick, a monster's bite.
 *
 * Costs are checked and spent here, once, so no content file can forget to.
 */
export function useAbility(ctx: ActionCtx, actor: Actor, def: AbilityDef, target: Actor | undefined): ActionResult {
  const id = String(def.id ?? def.name);
  if (!target || !target.alive) return { tookTurn: false };

  const range = def.range ?? 1;
  if (distance(actor.pos, target.pos) > range) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `${target.name} is out of reach.`, tone: "warn" }] : [] };
  }
  if (!ready(ctx, actor, id)) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `${def.name} is not ready yet.`, tone: "warn" }] : [] };
  }
  const staminaCost = def.stamina ?? 0;
  if (actor.pools.stamina < staminaCost) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `Not enough stamina for ${def.name} (${staminaCost} needed).`, tone: "warn" }] : [] };
  }
  const manaCost = def.mana ?? 0;
  if (actor.pools.mana < manaCost) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `Not enough mana for ${def.name} (${manaCost} needed).`, tone: "warn" }] : [] };
  }

  actor.spendStamina(staminaCost);
  actor.spendMana(manaCost);
  startCooldown(ctx, actor, id, def.cooldown);

  const cost = def.cost ?? 1;
  const messages: NonNullable<ActionResult["messages"]> = [];
  if (def.say) messages.push({ text: say(def.say, actor, target), tone: "plain" });

  /*
   * Abilities roll to hit; spells do not.
   *
   * That split is the point of having two kinds of attack: a swing can miss
   * and gets better as you raise accuracy, while magic always lands and is
   * paid for in mana instead. It also means `accuracy` is a meaningful thing
   * to be offered at a level-up rather than a stat with nothing attached.
   *
   * The cost is spent either way — a miss is a turn and a kick's stamina gone.
   */
  if (!rollToHit(actor, target, ctx.rng)) {
    messages.push({
      text: `${def.name} misses ${objectName(target)}.`,
      tone: actor.isPlayer ? "warn" : "plain",
    });
    return { tookTurn: true, cost, messages };
  }

  const out = applyDamage(target, {
    amount: def.damage + actor.stats.might,
    kind: (def.kind ?? "physical") as DamageKind,
    source: actor,
    label: def.name,
  });
  messages.push(...out.messages);
  messages.push(...applyAll(def.applies, def.statusTurns, ctx, actor, target, out.dealt));

  return { tookTurn: true, cost, messages };
}

/**
 * Cast a spell.
 *
 * `target` is the creature aimed at for the single-target case; beams and
 * bursts work out their own victims from the tile.
 */
export function castSpell(
  ctx: ActionCtx,
  actor: Actor,
  def: SpellDef,
  target: Actor | undefined,
  at?: Pos,
): ActionResult {
  const id = String(def.id ?? def.name);
  const shape = def.target ?? "actor";
  const range = def.range ?? 1;

  if (!ready(ctx, actor, id)) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `${def.name} is not ready yet.`, tone: "warn" }] : [] };
  }
  if (actor.pools.mana < def.mana) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `Not enough mana for ${def.name} (${def.mana} needed, you have ${actor.pools.mana}).`, tone: "warn" }] : [] };
  }
  const staminaCost = def.stamina ?? 0;
  if (actor.pools.stamina < staminaCost) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: `Not enough stamina for ${def.name}.`, tone: "warn" }] : [] };
  }

  // Work out who it hits before spending anything, so a spell aimed at nothing
  // is a no-op rather than a wasted turn and wasted mana.
  const spot = at ?? target?.pos ?? actor.pos;
  let victims: Actor[];
  switch (shape) {
    case "self":
      victims = [actor];
      break;
    case "beam":
      victims = beamVictims(ctx, actor, spot, range);
      break;
    case "burst":
      victims = ctx.actors.filter((a) => a.alive && distance(a.pos, spot) <= (def.radius ?? 1));
      break;
    default:
      victims = target && target.alive ? [target] : [];
      break;
  }

  if (!victims.length) {
    return { tookTurn: false, messages: actor.isPlayer ? [{ text: "There is nothing there to aim at.", tone: "warn" }] : [] };
  }
  if (shape === "actor" || shape === "beam") {
    const far = victims.find((v) => distance(actor.pos, v.pos) > range);
    if (far) return { tookTurn: false, messages: actor.isPlayer ? [{ text: `${far.name} is out of range.`, tone: "warn" }] : [] };
    if (shape === "actor" && range > 1 && victims[0] && !hasLineOfSight(ctx.level, actor.pos, victims[0].pos, range)) {
      return { tookTurn: false, messages: actor.isPlayer ? [{ text: "You cannot see it from here.", tone: "warn" }] : [] };
    }
  }

  actor.spendMana(def.mana);
  actor.spendStamina(staminaCost);
  startCooldown(ctx, actor, id, def.cooldown);

  const messages: NonNullable<ActionResult["messages"]> = [];
  if (def.say) messages.push({ text: say(def.say, actor, victims[0]), tone: "magic" });

  for (const v of victims) {
    if (def.heal) {
      const healed = v.heal(def.heal);
      if (healed > 0) messages.push({ text: `${v.name} recovers ${healed}.`, tone: "good" });
    }
    let dealt = 0;
    if (def.damage) {
      const out = applyDamage(v, {
        // Focus raises every spell, which is what makes it worth taking at a
        // level-up whatever you happen to have learned.
        amount: def.damage + actor.stats.focus,
        kind: (def.kind ?? "pure") as DamageKind,
        source: actor,
        label: def.name,
      });
      messages.push(...out.messages);
      dealt = out.dealt;
    }
    messages.push(...applyAll(def.applies, def.statusTurns, ctx, actor, v, dealt || def.damage || 0));
  }
  return { tookTurn: true, messages };
}

/** Everything a beam passes through, stopping at the first wall. */
function beamVictims(ctx: ActionCtx, actor: Actor, toward: Pos, range: number): Actor[] {
  const out: Actor[] = [];
  const path = line(actor.pos, toward);
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!;
    if (distance(actor.pos, p) > range) break;
    if (ctx.level.solid(p.x, p.y)) break;
    const hit = actorAt(ctx.actors, p.x, p.y);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Put every status a spell or ability applies onto its victim.
 *
 * `power` is the damage that landed, which is what burning scales off. A spell
 * that applies burning without doing damage still burns, using its own listed
 * damage, so a pure-status spell is possible.
 */
function applyAll(
  ids: string[] | undefined,
  turns: number | undefined,
  ctx: ActionCtx,
  source: Actor,
  target: Actor,
  power: number,
): NonNullable<ActionResult["messages"]> {
  const out: NonNullable<ActionResult["messages"]> = [];
  if (!ids?.length || !target.alive) return out;
  for (const sid of ids) {
    const sdef = ctx.statuses.get(sid);
    if (!sdef) continue;
    out.push(...applyStatus(target, sdef, power, source, turns));
  }
  return out;
}
