/**
 * Attributes: the six numbers underneath everything else.
 *
 * Before this, a character was their combat stats — accuracy, evasion, might,
 * focus — and those were raised directly by upgrades and gear. That works, but it
 * gives nothing to reason ABOUT: +3 accuracy is +3 accuracy, and there is no
 * question to answer except "do I want more of it".
 *
 * Attributes put a layer underneath. Each one feeds several different things, so
 * raising one is a decision with consequences in more than one place:
 *
 *   Strength  — how hard you hit with heavy weapons, how much you can carry,
 *               and how much armour you can wear before it slows you down
 *   Agility   — how often you hit with light weapons, how hard you are to hit,
 *               and how fast you act
 *   Endurance — health, stamina, and how fast you recover
 *   Wits      — mana, spell damage, and how quickly you learn a trade
 *   Cunning   — how well you find things, how good your crafting comes out,
 *               and how much better a price you get
 *   Presence  — how willing creatures and people are to deal with you
 *
 * The derived combat stats still exist and still work the same way; they are
 * simply COMPUTED from the attributes plus whatever is worn, rather than being
 * the primary thing. That is what makes a Strength build and an Agility build
 * play differently with the same sword.
 *
 * Everything here is pure arithmetic over a plain record, with no actor, no
 * registry and no randomness, so the curves can be tested as curves.
 */

export const ATTRIBUTES = [
  "strength", "agility", "endurance", "wits", "cunning", "presence",
] as const;

export type AttributeId = (typeof ATTRIBUTES)[number];

export type Attributes = Record<AttributeId, number>;

/** What each one is called, and what it actually does, for the character sheet. */
export const ATTRIBUTE_INFO: Record<AttributeId, { name: string; short: string; about: string }> = {
  strength: {
    name: "Strength", short: "STR",
    about: "Damage with heavy weapons, what you can carry, and how much armour you can wear without it slowing you.",
  },
  agility: {
    name: "Agility", short: "AGI",
    about: "Accuracy with light weapons, how hard you are to hit, and how often you act.",
  },
  endurance: {
    name: "Endurance", short: "END",
    about: "Health, stamina, and how fast you recover from a wound.",
  },
  wits: {
    name: "Wits", short: "WIT",
    about: "Mana, spell damage, and how quickly you learn a trade.",
  },
  cunning: {
    name: "Cunning", short: "CUN",
    about: "What you find when you gather, how well your crafting comes out, and the prices you are offered.",
  },
  presence: {
    name: "Presence", short: "PRE",
    about: "How willing animals are to follow you and people are to deal with you.",
  },
};

/**
 * Where everyone starts.
 *
 * Ten is the human average and the number every modifier is written against, so
 * a species with 12 Strength is visibly above average without anyone having to
 * remember a baseline.
 */
export const ATTRIBUTE_BASE = 10;

export const newAttributes = (): Attributes => ({
  strength: ATTRIBUTE_BASE, agility: ATTRIBUTE_BASE, endurance: ATTRIBUTE_BASE,
  wits: ATTRIBUTE_BASE, cunning: ATTRIBUTE_BASE, presence: ATTRIBUTE_BASE,
});

/**
 * The lowest an attribute can go, and the highest it can be raised to.
 *
 * A floor of 1 rather than 0 because several things divide by or scale off these
 * and a zero would make a character literally incapable rather than merely bad.
 * The ceiling exists so that a long run has somewhere to stop: without it the
 * optimal play is always to pour everything into one number.
 */
export const ATTRIBUTE_FLOOR = 1;
export const ATTRIBUTE_CEILING = 40;

export const clampAttribute = (n: number): number =>
  Math.max(ATTRIBUTE_FLOOR, Math.min(ATTRIBUTE_CEILING, Math.round(n)));

/**
 * Add a set of MODIFIERS to a set of attributes, clamped.
 *
 * Modifiers, not values. Species files, background files and item bonuses are
 * all written as differences from average, which is what makes "+3 Strength"
 * mean the same thing wherever it appears. Passing a finished attribute set here
 * doubles it — which has now happened twice, once in character creation and once
 * in the save loader, and in both cases was invisible because 20 Strength looks
 * perfectly plausible. `absoluteAttributes` is the other one.
 */
export function withAttributes(base: Attributes, add: Partial<Attributes> | undefined): Attributes {
  const out = { ...base };
  for (const key of ATTRIBUTES) out[key] = clampAttribute(out[key] + (add?.[key] ?? 0));
  return out;
}

/**
 * Take a set of finished attribute VALUES, filling in the average for any that
 * are missing.
 *
 * This is the one for a save file, where the numbers are what the character
 * actually has rather than what their species did to them.
 */
export function absoluteAttributes(values: Partial<Attributes> | undefined): Attributes {
  const out = newAttributes();
  for (const key of ATTRIBUTES) {
    const given = values?.[key];
    if (typeof given === "number") out[key] = clampAttribute(given);
  }
  return out;
}

/**
 * How far from average an attribute is.
 *
 * Almost everything derived is written against this rather than the raw value,
 * so a modifier of zero means "average" and the arithmetic reads the way it is
 * meant to: `10 + mod(strength)` is "ten, plus whatever being strong is worth".
 */
export const mod = (value: number): number => value - ATTRIBUTE_BASE;

// ---------------------------------------------------------------------------
// What the attributes produce
// ---------------------------------------------------------------------------

/**
 * Everything the rest of the game reads off an attribute spread.
 *
 * Gathered into one object computed in one place, rather than each system
 * reaching for `strength` and applying its own formula. The reason is that the
 * curves have to be balanced against each other, and they cannot be if they are
 * scattered across six files — this is the one place to look to see what a point
 * of Strength is actually worth.
 */
export type Derived = {
  /** Added to the base health, stamina and mana pools. */
  hpBonus: number;
  staminaBonus: number;
  manaBonus: number;
  /** Health per turn once regeneration has started, and the wait before it does. */
  regen: number;
  regenDelay: number;
  /** Added to the chance to hit, per weapon class (see weapons.ts for which). */
  heavyAccuracy: number;
  lightAccuracy: number;
  /** Added to damage, likewise. */
  heavyDamage: number;
  lightDamage: number;
  /** Spell damage. */
  spellPower: number;
  /** Chance to be missed. */
  evasion: number;
  /** Energy per tick: 100 is the standard pace. */
  speed: number;
  /** How much you can carry before it starts to hurt. */
  carry: number;
  /** How much armour you can wear before it costs you evasion. */
  armourTolerance: number;
  /** Added to the chance of the rarer yields when gathering, as a fraction. */
  gatherLuck: number;
  /** Added to the quality roll when crafting. */
  craftQuality: number;
  /** How much faster a trade or craft skill is learned, as a multiplier. */
  learning: number;
  /** Added to taming odds, as a fraction. */
  tameBonus: number;
  /** How much better a price you are offered, as a fraction off the spread. */
  haggle: number;
};

/**
 * Work out everything an attribute spread produces.
 *
 * The curves are deliberately linear in the attribute and modest per point. A
 * quadratic curve on anything here produces the familiar problem where the only
 * correct play is to dump every point into one attribute, and a steep linear one
 * does the same thing more slowly. Small, broad and several-at-once is what
 * makes a spread a decision.
 */
export function derive(attr: Attributes): Derived {
  const str = mod(attr.strength);
  const agi = mod(attr.agility);
  const end = mod(attr.endurance);
  const wit = mod(attr.wits);
  const cun = mod(attr.cunning);
  const pre = mod(attr.presence);

  return {
    hpBonus: end * 6,
    staminaBonus: end * 4 + str * 2,
    manaBonus: wit * 6,
    regen: 2 + Math.floor(end / 3),
    // Endurance shortens the wait, to a floor: there is always some wait, or
    // retreating two squares would heal you and fights would never resolve.
    regenDelay: Math.max(3, 10 - Math.floor(end / 2)),

    heavyAccuracy: Math.floor(str / 2) + Math.floor(agi / 3),
    lightAccuracy: agi,
    heavyDamage: str,
    lightDamage: Math.floor(agi / 2) + Math.floor(str / 3),
    spellPower: wit,

    evasion: agi * 2,
    // Speed moves slowly and in whole steps, because the turn scheduler is
    // discrete: a point here is worth far more than a point of anything else.
    speed: 100 + Math.floor(agi / 4) * 5,

    carry: 20 + str * 3,
    armourTolerance: 6 + str,

    gatherLuck: cun * 0.03,
    craftQuality: cun * 1.5 + wit * 0.5,
    learning: 1 + wit * 0.08,
    tameBonus: pre * 0.03,
    haggle: pre * 0.02 + cun * 0.02,
  };
}

/**
 * A one-line summary of what raising an attribute by one would do.
 *
 * Generated by actually deriving both spreads and diffing them, rather than
 * being written out by hand next to the formula. A hand-written description is
 * a second copy of the curve, and the two drift apart the first time anyone
 * touches the arithmetic.
 */
export function explainPoint(attr: Attributes, which: AttributeId): string {
  const before = derive(attr);
  const after = derive({ ...attr, [which]: clampAttribute(attr[which] + 1) });

  const label: Partial<Record<keyof Derived, string>> = {
    hpBonus: "max health", staminaBonus: "max stamina", manaBonus: "max mana",
    regen: "health a turn", regenDelay: "turns before healing",
    heavyAccuracy: "% hit (heavy)", lightAccuracy: "% hit (light)",
    heavyDamage: "heavy damage", lightDamage: "light damage",
    spellPower: "spell damage", evasion: "% dodge", speed: "speed",
    carry: "carry", armourTolerance: "armour tolerated",
  };

  const bits: string[] = [];
  for (const [key, text] of Object.entries(label) as [keyof Derived, string][]) {
    const delta = (after[key] as number) - (before[key] as number);
    if (!delta) continue;
    bits.push(`${delta > 0 ? "+" : ""}${delta} ${text}`);
  }
  // The fractional ones read better as percentages than as decimals.
  const pct: [keyof Derived, string][] = [
    ["gatherLuck", "rare finds"], ["tameBonus", "taming"], ["haggle", "prices"],
  ];
  for (const [key, text] of pct) {
    const delta = (after[key] as number) - (before[key] as number);
    if (Math.abs(delta) < 0.001) continue;
    bits.push(`${delta > 0 ? "+" : ""}${Math.round(delta * 100)}% ${text}`);
  }
  if (Math.abs(after.craftQuality - before.craftQuality) >= 0.1) {
    bits.push(`+${(after.craftQuality - before.craftQuality).toFixed(1)} craft quality`);
  }
  return bits.join(", ") || "nothing";
}

/**
 * Attribute points granted per level.
 *
 * Two, so that a level is always a small decision even when the roll of five
 * offers nothing you want — and an odd split across two different attributes is
 * possible, which keeps pure builds from being automatic.
 */
export const POINTS_PER_LEVEL = 2;
