/**
 * Affixes: the random modifiers that make one piece of gear its own.
 *
 * Every piece of equipment that enters the world rolls through here, so that two
 * Steel Axes are rarely the same object — one might be "Flaming Steel Axe of the
 * Bear" and the next plain iron. An affix is a prefix or a suffix (a named bundle
 * of modifiers, stored as an `EnchantmentDef`), and a piece carries at most one
 * of each so a name never runs away into a paragraph.
 *
 * This module owns three things and nothing else: which affixes a piece should
 * roll, how to read their combined modifiers, and how to say the result's name.
 * It takes the enchantment registry as an argument rather than importing a
 * Registry, so it stays pure and testable.
 */
import type { EnchantmentDef, ItemDef } from "../content/schema.ts";
import type { Rng } from "./rng.ts";
import type { AttributeId } from "./attributes.ts";
import type { DamageKind } from "./types.ts";

export type Enchants = Map<string, EnchantmentDef>;

/** Where an affix may sit on a given item. */
function fitsSlot(aff: EnchantmentDef, slot: string | undefined): boolean {
  const slots = aff.slots ?? [];
  if (!slots.length) return true;                 // "any"
  // A weapon affix fits the weapon hand; an armour affix fits any armour slot.
  if (slot === "weapon" || slot === "offhand" || slot === "shield") {
    return slots.includes("weapon") || slots.includes(slot);
  }
  return slots.includes(slot ?? "");
}

/**
 * How rich a piece should be, as a chance of a prefix and of a suffix.
 *
 * `luck` is the finder's Cunning plus the depth or tier of wherever it came
 * from, so deeper finds and luckier characters turn up better gear — the thing
 * that keeps you opening the next chest. The two rolls are independent, so a
 * piece can have a prefix, a suffix, both, or neither, which is most of them.
 */
export type RollContext = {
  /** 0-1 added to both chances: Cunning, depth, a boss's generosity. */
  luck?: number;
  /** Force at least this many affixes — a unique drop, a masterwork craft. */
  atLeast?: number;
  /** The highest tier that may appear. Deeper and better unlocks tier 3. */
  maxTier?: number;
};

/**
 * Roll the affixes for one item.
 *
 * Returns up to one prefix and one suffix, both fitting the item's slot and
 * within the tier ceiling. A piece that can take neither (a potion, a material)
 * gets none, which is why this is safe to call on anything.
 */
export function rollAffixes(
  def: ItemDef, enchants: Enchants, rng: Rng, ctx: RollContext = {},
): string[] {
  if (!isEnchantable(def)) return [];
  const luck = ctx.luck ?? 0;
  const maxTier = ctx.maxTier ?? 2;

  const pool = [...enchants.values()].filter(
    (a) => (a.tier ?? 1) <= maxTier && fitsSlot(a, def.slot));
  const prefixes = pool.filter((a) => (a.place ?? "prefix") === "prefix");
  const suffixes = pool.filter((a) => a.place === "suffix");

  const out: string[] = [];
  const want = ctx.atLeast ?? 0;

  // Prefix first, then suffix, each on its own roll; `atLeast` forces them in.
  const pChance = Math.min(0.9, 0.12 + luck);
  const sChance = Math.min(0.9, 0.1 + luck);
  if (prefixes.length && (want >= 1 || rng.next() < pChance)) {
    const pick = rng.weighted(prefixes, (a) => a.weight ?? 10);
    if (pick) out.push(String(pick.id));
  }
  if (suffixes.length && (want >= 2 || (out.length ? want >= 2 : want >= 1) || rng.next() < sChance)) {
    const pick = rng.weighted(suffixes, (a) => a.weight ?? 10);
    if (pick) out.push(String(pick.id));
  }
  return out;
}

/** Can anything be enchanted onto this at all? Only worn or wielded gear. */
export function isEnchantable(def: ItemDef): boolean {
  const slot = def.slot;
  if (!slot) return false;
  return !["potion", "scroll", "misc", "material", "food"].includes(slot);
}

/** The prefix and suffix words for a set of affixes, for the item's name. */
export function affixNames(ids: string[] | undefined, enchants: Enchants): { prefix?: string; suffix?: string } {
  const out: { prefix?: string; suffix?: string } = {};
  for (const id of ids ?? []) {
    const aff = enchants.get(id);
    if (!aff) continue;
    if (aff.place === "suffix") out.suffix = aff.name ?? id;
    else out.prefix = aff.name ?? id;
  }
  return out;
}

/** The modifiers an affix set contributes, summed, for stats and value. */
export type AffixEffect = {
  armour: number;
  might: number;
  focus: number;
  accuracy: number;
  evasion: number;
  hpMax: number;
  staminaMax: number;
  manaMax: number;
  speed: number;
  attributes: Partial<Record<AttributeId, number>>;
  resist: Partial<Record<DamageKind, number>>;
  bonusDamage: number;
  bonusKind?: DamageKind;
  applies: string[];
};

export function affixEffect(ids: string[] | undefined, enchants: Enchants): AffixEffect {
  const e: AffixEffect = {
    armour: 0, might: 0, focus: 0, accuracy: 0, evasion: 0,
    hpMax: 0, staminaMax: 0, manaMax: 0, speed: 0,
    attributes: {}, resist: {}, bonusDamage: 0, applies: [],
  };
  for (const id of ids ?? []) {
    const aff = enchants.get(id);
    if (!aff) continue;
    const m = aff.modify ?? {};
    e.armour += m.armour ?? 0;
    e.might += m.might ?? 0;
    e.focus += m.focus ?? 0;
    e.accuracy += m.accuracy ?? 0;
    e.evasion += m.evasion ?? 0;
    e.hpMax += m.hpMax ?? 0;
    e.staminaMax += m.staminaMax ?? 0;
    e.manaMax += m.manaMax ?? 0;
    e.speed += m.speed ?? 0;
    for (const [k, v] of Object.entries(aff.attributes ?? {})) {
      if (typeof v !== "number") continue;
      e.attributes[k as AttributeId] = (e.attributes[k as AttributeId] ?? 0) + v;
    }
    // Resistances MULTIPLY, like every other resistance source.
    for (const [k, v] of Object.entries(aff.resist ?? {})) {
      if (typeof v !== "number") continue;
      e.resist[k as DamageKind] = (e.resist[k as DamageKind] ?? 1) * v;
    }
    if (aff.bonusDamage) {
      e.bonusDamage += aff.bonusDamage;
      e.bonusKind = aff.bonusKind ?? e.bonusKind;
    }
    for (const s of aff.applies ?? []) e.applies.push(s);
  }
  return e;
}

/**
 * What a set of affixes is worth as a multiplier on the item's value.
 *
 * Each affix is worth roughly its tier, so a two-tier-3 item is worth several
 * times a plain one — which is what makes a well-rolled find worth carrying back
 * to sell rather than dropping.
 */
export function affixValueFactor(ids: string[] | undefined, enchants: Enchants): number {
  let factor = 1;
  for (const id of ids ?? []) {
    const aff = enchants.get(id);
    if (!aff) continue;
    factor += 0.6 * (aff.tier ?? 1);
  }
  return factor;
}
