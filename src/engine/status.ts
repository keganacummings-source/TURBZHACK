/**
 * Status effects: burning, frozen, and whatever you add next.
 *
 * A status is a CONTENT FILE (content/statuses/*.json), not code. This file is
 * only the small machine that reads those files and applies them each turn, so
 * adding "poisoned" or "blessed" means writing one JSON file and nothing else.
 *
 * The two shipped statuses are the ones the game design calls for:
 *
 *   burning  — ticks damage every turn, scaled to the hit that caused it
 *   frozen   — the bearer cannot act, and rolls to break out each turn
 */
import type { Actor } from "./actor.ts";
import type { Rng } from "./rng.ts";
import { applyDamage } from "./combat.ts";
import type { ActiveStatus, DamageKind, Message } from "./types.ts";

/** A status definition, as loaded from content/statuses/<id>.json. */
export type StatusDef = {
  id: string;
  name: string;
  /** Shown in the HUD. */
  sprite?: string;
  /** How long it lasts by default, in turns. */
  turns: number;
  /** The bearer cannot take its turn while this is on. */
  preventsAction?: boolean;
  /**
   * The bearer cannot walk while this is on, but can still fight and cast.
   *
   * That is the difference from `preventsAction`: a rooted creature next to you
   * hits you as hard as ever, it just cannot follow you or run away.
   */
  preventsMove?: boolean;
  /**
   * Chance each turn that it ends early.
   *
   * Freeze uses this: 0.5 means an even chance of thawing every turn, so it
   * usually costs its victim one or two turns and occasionally several.
   */
  breakChance?: number;
  /** Damage every turn while it lasts. */
  tick?: {
    kind: DamageKind;
    /**
     * Either a flat number of points...
     */
    amount?: number;
    /**
     * ...or a fraction of something. `percent: 0.25, of: "sourceDamage"` is the
     * burning rule: a quarter of the hit that set you alight, every turn.
     *
     * "maxHp" is there as the other obvious reading, so this can be changed to
     * a percentage of the victim's health without touching any code.
     */
    percent?: number;
    of?: "sourceDamage" | "maxHp" | "currentHp";
  };
  /** Added to the bearer's stats while it lasts. */
  modify?: Partial<Record<"armour" | "speed", number>>;
  /** Applying it again refreshes the duration instead of stacking. Default true. */
  refresh?: boolean;
  /** What the log says. `{name}` is the bearer. */
  messages?: { applied?: string; tick?: string; ended?: string; broke?: string };
};

export type StatusTickResult = {
  messages: { text: string; tone?: Message["tone"] }[];
  /** Did this kill the bearer? */
  killed: boolean;
};

const fill = (text: string, actor: Actor) => text.replace(/\{name\}/g, actor.name);

/** Is this actor under anything that stops it acting at all — stunned, webbed, frozen? */
export function isHeld(actor: Actor, defs: Map<string, StatusDef>): boolean {
  return actor.statuses.some((s) => s.turns > 0 && !!defs.get(s.id)?.preventsAction);
}

/** Is this actor under anything that stops it walking — rooted, say? */
export function isRooted(actor: Actor, defs: Map<string, StatusDef>): boolean {
  return actor.statuses.some((s) => s.turns > 0 && !!defs.get(s.id)?.preventsMove);
}

/**
 * Put a status on an actor.
 *
 * `power` is what the status scales off — for burning it is the damage of the
 * hit that caused it, which is why the caller passes it rather than the status
 * file naming a number it cannot know.
 */
export function applyStatus(
  target: Actor,
  def: StatusDef,
  power: number,
  source?: Actor,
  turnsOverride?: number,
): { text: string; tone?: Message["tone"] }[] {
  if (!target.alive) return [];
  const turns = Math.max(1, Math.round(turnsOverride ?? def.turns));
  const existing = target.statuses.find((s) => s.id === def.id && s.turns > 0);

  if (existing && def.refresh !== false) {
    // Refresh, and keep whichever power is worse for the bearer: being set
    // alight a second time by a stronger fire should not make it gentler.
    existing.turns = Math.max(existing.turns, turns);
    existing.power = Math.max(existing.power, power);
    existing.source = source?.id ?? existing.source;
    return [];
  }
  if (existing) {
    existing.turns += turns;
    return [];
  }

  const active: ActiveStatus = { id: def.id, turns, power, source: source?.id };
  target.statuses.push(active);
  if (def.modify?.armour) target.armour += def.modify.armour;
  if (def.modify?.speed) target.speed += def.modify.speed;

  const line = def.messages?.applied ?? `{name} is ${def.name.toLowerCase()}.`;
  return [{ text: fill(line, target), tone: "magic" }];
}

/** Take a status off, undoing whatever it was modifying. */
export function removeStatus(target: Actor, def: StatusDef): void {
  const i = target.statuses.findIndex((s) => s.id === def.id);
  if (i < 0) return;
  target.statuses.splice(i, 1);
  if (def.modify?.armour) target.armour -= def.modify.armour;
  if (def.modify?.speed) target.speed -= def.modify.speed;
}

/**
 * Tick every status on an actor by one turn.
 *
 * Called once per turn for each actor, by the turn system. Returns what to
 * print and whether the bearer died of it.
 *
 * The break roll happens BEFORE the duration is counted down, so a status with
 * `breakChance` can end on the very turn it was applied — which is what makes
 * freeze feel like a gamble rather than a guaranteed free hit.
 */
export function tickStatuses(
  actor: Actor,
  defs: Map<string, StatusDef>,
  rng: Rng,
  actorsById: Map<string, Actor>,
): StatusTickResult {
  const messages: StatusTickResult["messages"] = [];
  let killed = false;
  if (!actor.alive) return { messages, killed };

  // A copy, because a tick can kill and we must not mutate while iterating.
  for (const active of [...actor.statuses]) {
    const def = defs.get(active.id);
    if (!def) { removeStatusById(actor, active.id); continue; }
    if (active.turns <= 0) continue;

    if (def.breakChance && rng.chance(def.breakChance)) {
      removeStatus(actor, def);
      const line = def.messages?.broke ?? `{name} shakes off ${def.name.toLowerCase()}.`;
      messages.push({ text: fill(line, actor), tone: "plain" });
      continue;
    }

    if (def.tick) {
      const amount = tickAmount(def, active, actor);
      if (amount > 0) {
        const out = applyDamage(actor, {
          amount,
          kind: def.tick.kind,
          source: active.source ? actorsById.get(active.source) : undefined,
          label: def.messages?.tick ?? `the ${def.name.toLowerCase()}`,
          // It got past the armour when it was applied; it is inside now.
          ignoreArmour: true,
        });
        messages.push(...out.messages);
        if (out.killed) { killed = true; break; }
      }
    }

    active.turns--;
    if (active.turns <= 0) {
      removeStatus(actor, def);
      const line = def.messages?.ended ?? `{name} is no longer ${def.name.toLowerCase()}.`;
      messages.push({ text: fill(line, actor), tone: "plain" });
    }
  }
  return { messages, killed };
}

/** How much a tick hurts this turn. */
function tickAmount(def: StatusDef, active: ActiveStatus, bearer: Actor): number {
  const t = def.tick;
  if (!t) return 0;
  if (typeof t.amount === "number") return t.amount;
  if (typeof t.percent !== "number") return 0;
  const base =
    t.of === "maxHp" ? bearer.pools.hpMax :
    t.of === "currentHp" ? bearer.pools.hp :
    active.power;                                  // "sourceDamage", the default
  // Always at least a point: a status that says it burns you must burn you.
  return Math.max(1, Math.round(base * t.percent));
}

function removeStatusById(actor: Actor, id: string): void {
  const i = actor.statuses.findIndex((s) => s.id === id);
  if (i >= 0) actor.statuses.splice(i, 1);
}
