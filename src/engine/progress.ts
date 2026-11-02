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
 * Every fifth level is a milestone, and offers talents instead.
 *
 * Talents are the big, once-only choices — a second companion, regeneration that
 * does not wait, a trade that pays double. Mixing them into the ordinary roll
 * would mean either meeting one at level 2 or never meeting one at all, because
 * anything rare enough to be special is rare enough to never come up in five
 * draws. Giving them their own levels makes them something to count towards.
 */
export const MILESTONE_EVERY = 5;

export const isMilestone = (level: number): boolean => level > 1 && level % MILESTONE_EVERY === 0;

/**
 * Things a level can change that do not live on the actor.
 *
 * How fast a seam gives way, how many companions you can keep, how willing a
 * wolf is. They are kept apart from `Actor.stats` on purpose: equipment
 * recomputes those from scratch every time something is worn, so anything stored
 * there would be wiped by putting a hat on.
 */
export type Perks = {
  gatherSpeed: number;
  gatherLuck: number;
  craftSpeed: number;
  party: number;
  tame: number;
  regen: number;
  regenDelay: number;
};

export const newPerks = (): Perks => ({
  gatherSpeed: 0, gatherLuck: 0, craftSpeed: 0, party: 0, tame: 0, regen: 0, regenDelay: 0,
});

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

/**
 * What a level-up hands you automatically, before the choice.
 *
 * Deliberately small. The flat gains exist so that a level is never nothing;
 * everything that makes one character different from another comes out of the
 * choice, and a generous automatic grant would drown that.
 */
export const PER_LEVEL = { hpMax: 6, staminaMax: 4, manaMax: 5 } as const;

/** One of the five things on offer. */
export type Choice =
  | { kind: "spell"; id: string; name: string; about: string; detail: string }
  | { kind: "upgrade"; id: string; name: string; about: string; detail: string; group?: string };

/**
 * Roll the five.
 *
 * Two kinds of level. An ordinary one offers a spread: a spell or two you could
 * actually cast, and upgrades drawn from DIFFERENT groups, so the decision is
 * between kinds of character rather than between five flavours of max health. A
 * milestone level offers talents only — the big ones — and nothing else, because
 * a talent next to a +3 might is not a choice.
 *
 * It stays deterministic from the seed, the level and the reroll count, so a run
 * is replayable and the roll cannot be save-scummed. The reroll is a deliberate
 * exception, and it is spent rather than free.
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
  const upgradeTier = Math.max(1, Math.min(3, 1 + Math.floor((level - 1) / 6)));

  const asChoice = (u: UpgradeDef): Choice => ({
    kind: "upgrade" as const,
    id: String(u.id),
    name: u.name ?? String(u.id),
    about: u.about ?? "",
    detail: upgradeDetail(u),
    group: u.group ?? "body",
  });

  /*
   * A milestone offers talents, and only talents.
   *
   * If there are not enough of them to fill the roll it offers fewer rather
   * than padding with ordinary upgrades: four talents is still a milestone,
   * whereas one talent and four stat bumps is an ordinary level wearing a hat.
   */
  if (isMilestone(level)) {
    const talents = [...upgrades.values()].filter((u) => u.talent);
    if (talents.length) {
      const taken = new Set(known);
      const pool = talents.filter((u) => !taken.has(String(u.id)));
      return rng.shuffled(pool.length ? pool : talents).slice(0, count).map(asChoice);
    }
    // No talents written yet: fall through to an ordinary roll rather than
    // handing the player a level with nothing on it.
  }

  const spellPool: Choice[] = [...spells.values()]
    .filter((s) => !haveSpell.has(String(s.id)))
    // A spell only shows up once it is within reach: an offer you cannot cast
    // for ten levels is a wasted slot in the roll.
    .filter((s) => (s.tier ?? 1) <= maxTier)
    .map((s) => ({
      kind: "spell" as const,
      id: String(s.id),
      name: s.name ?? String(s.id),
      about: s.about ?? "",
      detail: spellDetail(s),
    }));

  const upgradePool = [...upgrades.values()]
    .filter((u) => !u.talent)
    .filter((u) => (u.tier ?? 1) <= upgradeTier);

  /*
   * Spread the upgrades across groups.
   *
   * A flat draw over the upgrade pool returns whatever the pool happens to be
   * mostly made of — and because stat bumps are the easiest thing to write, that
   * is stat bumps. Taking one from each group first, in a shuffled order, means
   * a roll reliably contains a choice between being tougher, being deadlier, and
   * being better at something outside a fight.
   */
  const byGroup = new Map<string, UpgradeDef[]>();
  for (const u of upgradePool) {
    const g = u.group ?? "body";
    byGroup.set(g, [...(byGroup.get(g) ?? []), u]);
  }
  const spread: Choice[] = [];
  for (const g of rng.shuffled([...byGroup.keys()])) {
    const pool = byGroup.get(g)!;
    const pick = rng.weighted(pool, (u) => u.weight ?? 10);
    if (pick) spread.push(asChoice(pick));
  }

  /*
   * At least one of each, when both are possible.
   *
   * The failure this prevents is a roll that is all spells (early, when the
   * spellbook is full and the upgrade pool is small) or all upgrades (late, when
   * every spell is known). Either one is a level-up with no decision in it.
   */
  const wantSpells = spellPool.length
    ? Math.max(1, Math.min(spellPool.length, Math.floor(count * 0.4)))
    : 0;
  const wantUpgrades = Math.min(spread.length, count - wantSpells);

  const picked: Choice[] = [
    ...rng.shuffled(spellPool).slice(0, wantSpells),
    ...rng.shuffled(spread).slice(0, wantUpgrades),
  ];

  // Top up from everything that is left if either side ran dry.
  if (picked.length < count) {
    const taken = new Set(picked.map((c) => `${c.kind}:${c.id}`));
    const rest = [...spellPool, ...upgradePool.map(asChoice)];
    for (const c of rng.shuffled(rest)) {
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

/** The same for an upgrade, stats and perks together. */
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
  /*
   * Perks are described in their own words rather than as numbers.
   *
   * "+1 gatherSpeed" means nothing to anyone; "a turn off every harvest" is the
   * thing the player is actually choosing. The sign is handled per perk because
   * some are better lower — a turn off the work, a shorter wait to heal.
   */
  const p = u.perks ?? {};
  const turns = (n: number) => `${Math.abs(n)} turn${Math.abs(n) === 1 ? "" : "s"}`;
  if (p.gatherSpeed) bits.push(`${turns(p.gatherSpeed)} ${p.gatherSpeed > 0 ? "added to" : "off"} every harvest`);
  if (p.craftSpeed) bits.push(`${turns(p.craftSpeed)} ${p.craftSpeed > 0 ? "added to" : "off"} every craft`);
  if (p.gatherLuck) bits.push(`${Math.round(p.gatherLuck * 100)}% better odds on rare finds`);
  if (p.party) bits.push(`${p.party > 0 ? "+" : ""}${p.party} companion${Math.abs(p.party) === 1 ? "" : "s"}`);
  if (p.tame) bits.push(`${Math.round(p.tame * 100)}% better at taming`);
  if (p.regen) bits.push(`${p.regen > 0 ? "+" : ""}${p.regen} health a turn once healing starts`);
  if (p.regenDelay) bits.push(`healing starts ${turns(p.regenDelay)} ${p.regenDelay < 0 ? "sooner" : "later"}`);
  return bits.join(", ") || "no effect";
}

/**
 * Take a choice.
 *
 * Returns what to print. Applying an upgrade is the only place the player's
 * stats are permanently changed, so the clamping lives here too.
 */
export function applyChoice(
  actor: Actor, choice: Choice, upgrades: Map<string, UpgradeDef>, perks?: Perks,
): string {
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
  /*
   * Perks go on the Game, not the actor.
   *
   * `applyChoice` is handed the record to add to rather than reaching for it,
   * so that this function stays testable with nothing but an actor — and so
   * that forgetting to pass it is a perk that does nothing rather than a crash
   * in the middle of a level-up.
   */
  if (perks) {
    for (const [k, v] of Object.entries(u.perks ?? {})) {
      if (typeof v !== "number") continue;
      if (k in perks) perks[k as keyof Perks] += v;
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
