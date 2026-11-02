/**
 * Hitting things, and what happens afterwards.
 *
 * One function — `applyDamage` — is the ONLY way an actor loses health in this
 * game. Spells, melee, burning, falling, a scripted trap: all of them come
 * through here. That is deliberate: resistances, armour, death, kill credit and
 * the "you have not been hurt for ten turns" regen clock are each written once,
 * and a new content file cannot accidentally bypass any of them.
 */
import type { Actor } from "./actor";
import type { DamageKind, Message } from "./types";

export type DamageSpec = {
  amount: number;
  kind: DamageKind;
  /** Who is responsible, for the log and for kill credit. */
  source?: Actor;
  /** What to call it in the log: "the fire", "Grint's club". */
  label?: string;
  /** Armour does not apply. Burning already got through the armour once. */
  ignoreArmour?: boolean;
};

export type DamageOutcome = {
  /** After resistance and armour. */
  dealt: number;
  /** Was this the blow that killed it? */
  killed: boolean;
  /** Resistance multiplier that applied, for the log. */
  resisted: number;
  messages: { text: string; tone?: Message["tone"] }[];
};

/**
 * How much of a given kind actually lands.
 *
 * 1 is normal, 0 is immune, 0.5 halves it, 2 doubles it. A missing entry is 1,
 * so a content file only has to mention the kinds it cares about — an ice imp
 * writes `{"cold": 0, "fire": 2}` and nothing else.
 */
export function resistanceOf(target: Actor, kind: DamageKind): number {
  const r = target.resist[kind];
  return typeof r === "number" && Number.isFinite(r) ? Math.max(0, r) : 1;
}

/**
 * Deal damage. The single door into losing health.
 *
 * Order is armour, then resistance, then a floor of 1 for anything that was not
 * resisted to nothing. The floor exists so that a heavily armoured target is
 * still killable — without it, armour above a weapon's damage made a creature
 * literally invincible to that weapon, which reads as a bug rather than a wall.
 */
export function applyDamage(target: Actor, spec: DamageSpec): DamageOutcome {
  const messages: DamageOutcome["messages"] = [];
  if (!target.alive) return { dealt: 0, killed: false, resisted: 1, messages };

  const resist = resistanceOf(target, spec.kind);
  let amount = Math.max(0, spec.amount);

  if (!spec.ignoreArmour && spec.kind === "physical") {
    amount = Math.max(0, amount - Math.max(0, target.armour));
  }
  amount *= resist;

  // Immunity is immunity — the floor must not sneak a point past a 0 resist.
  if (resist > 0 && spec.amount > 0 && amount < 1) amount = 1;

  const dealt = target.hurt(amount);
  const what = spec.label ?? "it";

  if (resist === 0) {
    messages.push({ text: `${target.name} is unharmed by ${what}.`, tone: "warn" });
  } else if (dealt > 0) {
    const tone = target.isPlayer ? "bad" : "plain";
    messages.push({ text: `${what} hits ${target.name} for ${dealt}.`, tone });
    if (resist > 1) messages.push({ text: `${target.name} is vulnerable to it!`, tone: "magic" });
  }

  const killed = !target.alive;
  if (killed) {
    messages.push({
      text: target.isPlayer ? "You die..." : `${target.name} dies.`,
      tone: target.isPlayer ? "bad" : "good",
    });
  }
  return { dealt, killed, resisted: resist, messages };
}

/**
 * A plain melee attack, as used by punch, kick and every enemy's basic hit.
 *
 * The numbers come from the content file, never from here: this is just the
 * plumbing that turns "5 physical damage called a punch" into a damage call.
 */
export function melee(attacker: Actor, target: Actor, damage: number, kind: DamageKind, label: string): DamageOutcome {
  return applyDamage(target, { amount: damage, kind, source: attacker, label });
}
