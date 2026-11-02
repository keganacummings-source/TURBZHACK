/**
 * Levelling, and the choice you get for it.
 *
 * The rule is: every level rolls FIVE options and you take one. Some are spells
 * you do not know yet, some are permanent upgrades to your own numbers. That is
 * the whole character system — there is no class tree, because the point is
 * that two runs of the same class end up different.
 *
 * Two things keep the roll honest:
 *
 *   - It never offers a spell you already know, and it never offers the same
 *     thing twice in one roll. A level-up that shows you four duplicates is a
 *     level-up you did not get.
 *   - It is deterministic from the seed and the level, so a run is replayable
 *     and so "save-scumming the roll" is not a thing.
 *
 * Both the spells and the upgrades come from content files, so adding either
 * to the pool is writing a file.
 */
import type { Actor } from "./actor.ts";
import type { Rng } from "./rng.ts";
import type { SpellDef, UpgradeDef } from "../content/schema.ts";

/** How many choices a level offers. */
export const CHOICES = 5;

/**
 * Experience needed to reach a level.
 *
 * Quadratic-ish: early levels come fast enough to teach you the system, and by
 * the time you are deep the levels are an event rather than a drip.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(18 * Math.pow(level - 1, 1.72));
}

/** The level a given amount of experience has earned. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 99 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** What a level-up hands you automatically, before the choice. */
export const PER_LEVEL = { hpMax: 6, staminaMax: 4, manaMax: 5 } as const;

/** One of the five things on offer. */
export type Choice =
  | { kind: "spell"; id: string; name: string; about: string; detail: string }
  | { kind: "upgrade"; id: string; name: string; about: string; detail: string };

/**
 * Roll the five.
 *
 * Spells are filtered by tier against the level, so a level-2 character is not
 * offered Firestorm and a level-20 one is not wading through Spark. The band is
 * generous at the top — anything up to your tier — because being offered a
 * strong spell late is the reward for getting there.
 */
export function rollChoices(
  level: number,
  known: readonly string[],
  spells: Map<string, SpellDef>,
  upgrades: Map<string, UpgradeDef>,
  rng: Rng,
  count = CHOICES,
): Choice[] {
  const haveSpell = new Set(known);
  // Tier 1 at level 1-3, tier 2 from 4, tier 3 from 7, and so on.
  const maxTier = Math.max(1, Math.min(5, 1 + Math.floor((level - 1) / 3)));

  const spellPool: Choice[] = [...spells.values()]
    .filter((s) => !haveSpell.has(String(s.id)))
    .filter((s) => (s.tier ?? 1) <= maxTier)
    // A spell only shows up once it is within reach: an offer you cannot cast
    // for ten levels is a wasted slot in the roll.
    .map((s) => ({
      kind: "spell" as const,
      id: String(s.id),
      name: s.name,
      about: s.about ?? "",
      detail: spellDetail(s),
    }));

  const upgradePool: Choice[] = [...upgrades.values()].map((u) => ({
    kind: "upgrade" as const,
    id: String(u.id),
    name: u.name,
    about: u.about ?? "",
    detail: upgradeDetail(u),
  }));

  /*
   * Aim for a mix rather than a pure random draw.
   *
   * A flat roll across both pools goes wrong at both ends of a run: early on
   * there are far more spells than upgrades, so you are never offered a stat;
   * late, every spell is known and the roll is nothing but stats. Taking a
   * fixed share from each, then topping up from whatever is left, keeps a
   * level-up a real decision the whole way through.
   */
  const wantSpells = Math.min(spellPool.length, Math.ceil(count * 0.6));
  const picked: Choice[] = [
    ...rng.shuffled(spellPool).slice(0, wantSpells),
    ...rng.shuffled(upgradePool).slice(0, count - wantSpells),
  ];

  // Top up if either pool ran dry — late in a run every spell is known.
  if (picked.length < count) {
    const taken = new Set(picked.map((c) => `${c.kind}:${c.id}`));
    for (const c of rng.shuffled([...spellPool, ...upgradePool])) {
      if (picked.length >= count) break;
      if (taken.has(`${c.kind}:${c.id}`)) continue;
      taken.add(`${c.kind}:${c.id}`);
      picked.push(c);
    }
  }
  return rng.shuffled(picked).slice(0, count);
}

/** A one-line summary of what a spell does, for the choice screen. */
export function spellDetail(s: SpellDef): string {
  const bits: string[] = [`${s.mana} mana`];
  if (s.damage) bits.push(`${s.damage} ${s.kind ?? "pure"}`);
  if (s.heal) bits.push(`heals ${s.heal}`);
  const shape = s.target ?? "actor";
  if (shape === "beam") bits.push(`line, range ${s.range ?? 1}`);
  else if (shape === "burst") bits.push(`blast ${s.radius ?? 1}, range ${s.range ?? 1}`);
  else if (shape === "self") bits.push("on yourself");
  else bits.push(`range ${s.range ?? 1}`);
  if (s.applies?.length) bits.push(s.applies.join(", "));
  if (s.cooldown) bits.push(`every ${s.cooldown + 1} turns`);
  return bits.join(" · ");
}

/** The same for an upgrade. */
export function upgradeDetail(u: UpgradeDef): string {
  const bits: string[] = [];
  const label: Record<string, string> = {
    might: "ability damage", focus: "spell damage",
    accuracy: "hit chance", evasion: "evasion",
    hpMax: "max health", staminaMax: "max stamina", manaMax: "max mana",
    armour: "armour",
  };
  for (const [k, v] of Object.entries(u.modify ?? {})) {
    if (typeof v !== "number" || !v) continue;
    const unit = k === "accuracy" || k === "evasion" ? "%" : "";
    bits.push(`${v > 0 ? "+" : ""}${v}${unit} ${label[k] ?? k}`);
  }
  return bits.join(", ") || "no effect";
}

/**
 * Take a choice.
 *
 * Returns what to print. Applying an upgrade is the only place the player's
 * stats are permanently changed, so the clamping lives here too.
 */
export function applyChoice(actor: Actor, choice: Choice, upgrades: Map<string, UpgradeDef>): string {
  if (choice.kind === "spell") {
    if (!actor.spells.includes(choice.id)) actor.spells.push(choice.id);
    return `You learn ${choice.name}.`;
  }
  const u = upgrades.get(choice.id);
  if (!u) return `Nothing happens.`;
  for (const [k, v] of Object.entries(u.modify ?? {})) {
    if (typeof v !== "number") continue;
    switch (k) {
      case "might": case "focus": case "accuracy": case "evasion":
        actor.stats[k] += v;
        break;
      case "armour":
        actor.armour += v;
        break;
      case "hpMax":
        actor.pools.hpMax += v;
        actor.pools.hp += v;        // a bigger pool should not leave you hurt
        break;
      case "staminaMax":
        actor.pools.staminaMax += v;
        actor.pools.stamina += v;
        break;
      case "manaMax":
        actor.pools.manaMax += v;
        actor.pools.mana += v;
        break;
    }
  }
  actor.clampPools();
  return `${choice.name}. ${choice.detail}`;
}

/** Everything the HUD wants to know about where you are. */
export function progressOf(xp: number): { level: number; into: number; need: number } {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: xp - base, need: Math.max(1, next - base) };
}
