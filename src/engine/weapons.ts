/**
 * Weapons: classes, reach, speed, scaling, material and quality.
 *
 * A weapon used to be a damage number and a damage kind, which made the choice
 * between any two of them arithmetic — take the bigger one. This gives a weapon
 * five separate things to be good and bad at, so that the best weapon depends on
 * who is holding it and what they are fighting:
 *
 *   CLASS    decides which attribute it scales off, which skill it trains, and
 *            how it feels — a dagger and a maul are not the same tool
 *   REACH    decides whether you strike first, and whether you can strike at all
 *            from where you are standing
 *   SPEED    decides how many turns a swing costs, so a fast weak weapon and a
 *            slow strong one can do the same damage per turn and play nothing
 *            alike
 *   MATERIAL decides the base numbers, and is where crafting enters
 *   QUALITY  decides how well that particular one came out, which is where a
 *            crafter's skill and a lucky find enter
 *
 * The arithmetic lives here rather than in the combat code so that the character
 * sheet, the wiki, the crafting screen and the blow itself are all reading the
 * same function — a weapon that displays one number and deals another is the
 * kind of bug nobody ever quite believes.
 */
import { derive, type Attributes } from "./attributes.ts";
import type { ItemDef } from "../content/schema.ts";

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export const WEAPON_CLASSES = [
  "dagger", "sword", "axe", "mace", "polearm", "staff", "bow", "unarmed",
] as const;

export type WeaponClass = (typeof WEAPON_CLASSES)[number];

export type WeaponClassInfo = {
  name: string;
  /** Which attribute's damage bonus applies. */
  scales: "light" | "heavy";
  /** Turns per swing, 1 being the standard pace. */
  speed: number;
  /** Squares it can reach. 1 is adjacent. */
  reach: number;
  /** Multiplier on the material's base damage. */
  damage: number;
  /** Added to the chance to hit. */
  accuracy: number;
  /** Needs both hands: nothing in the off-hand. */
  twoHanded?: boolean;
  /**
   * Spell power the class grants just for being held.
   *
   * A staff is a deliberately poor weapon, and without this it was strictly
   * worse than a dagger at everything — which made it a trap rather than a
   * trade. The compensation belongs on the CLASS rather than on each staff
   * file, because it is true of staves: holding one helps you cast.
   */
  focus?: number;
  /** What it is good at, in words, for the sheet and the wiki. */
  about: string;
};

/**
 * The classes.
 *
 * The numbers are set so that no class is simply better: a dagger lands far more
 * often and hits for much less, a maul is the reverse, a polearm trades its
 * accuracy for a square of reach. Damage-per-turn comes out within about 15% of
 * each other across the table, which is the point — the differences are in HOW
 * each one gets there.
 */
export const WEAPON_CLASS: Record<WeaponClass, WeaponClassInfo> = {
  unarmed: {
    name: "Unarmed", scales: "light", speed: 1, reach: 1, damage: 0.35, accuracy: 5,
    about: "Always available, and always a last resort.",
  },
  dagger: {
    name: "Dagger", scales: "light", speed: 0.6, reach: 1, damage: 0.55, accuracy: 12,
    about: "Fast and accurate. You will land everything and feel none of it.",
  },
  sword: {
    name: "Sword", scales: "light", speed: 1, reach: 1, damage: 1, accuracy: 5,
    about: "No weakness and no particular strength, which is its strength.",
  },
  axe: {
    name: "Axe", scales: "heavy", speed: 1.2, reach: 1, damage: 1.3, accuracy: -4,
    about: "Slow, heavy, and it does not care what you are wearing.",
  },
  mace: {
    name: "Mace", scales: "heavy", speed: 1.15, reach: 1, damage: 1.15, accuracy: -2,
    about: "Blunt. Armour helps less than its wearer hoped.",
  },
  polearm: {
    name: "Polearm", scales: "heavy", speed: 1.25, reach: 2, damage: 1.2, accuracy: -6,
    twoHanded: true,
    about: "Two squares of reach, and you strike first because of it.",
  },
  staff: {
    name: "Staff", scales: "light", speed: 1, reach: 1, damage: 0.6, accuracy: 0,
    twoHanded: true, focus: 6,
    about: "A poor weapon and an excellent place to put a spell.",
  },
  bow: {
    name: "Bow", scales: "light", speed: 1.1, reach: 6, damage: 0.9, accuracy: -2,
    twoHanded: true,
    about: "Reach that makes a fight a different problem entirely.",
  },
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export type MaterialInfo = {
  name: string;
  /** Multiplier on the class's damage. */
  damage: number;
  /** Added to armour, for armour made of it. */
  armour: number;
  /** Added to the chance to hit. */
  accuracy: number;
  /** Multiplier on how heavy it is. */
  weight: number;
  /** Rough worth per unit, which the economy prices from. */
  value: number;
  about: string;
};

/**
 * What a thing is made of.
 *
 * This is the axis crafting owns. A smith cannot change a sword into an axe, but
 * they can make the same axe out of something better — and the material a thing
 * is made of is recorded on the item, so a Silver Axe and an Iron Axe are the
 * same recipe and not the same weapon.
 */
export const MATERIALS = [
  "wood", "bone", "copper", "iron", "steel", "silver", "meteoric",
] as const;

export type MaterialId = (typeof MATERIALS)[number];

export const MATERIAL: Record<MaterialId, MaterialInfo> = {
  wood: {
    name: "Wooden", damage: 0.6, armour: 0.5, accuracy: 2, weight: 0.7, value: 1,
    about: "It is a stick with intent.",
  },
  bone: {
    name: "Bone", damage: 0.75, armour: 0.7, accuracy: 3, weight: 0.6, value: 2,
    about: "Light, sharp, and it was somebody's.",
  },
  copper: {
    name: "Copper", damage: 0.85, armour: 0.8, accuracy: 0, weight: 1, value: 4,
    about: "Soft. It will hold an edge for about one fight.",
  },
  iron: {
    name: "Iron", damage: 1, armour: 1, accuracy: 0, weight: 1, value: 8,
    about: "The standard against which the others are measured.",
  },
  steel: {
    name: "Steel", damage: 1.25, armour: 1.3, accuracy: 2, weight: 0.95, value: 20,
    about: "Iron, with the argument taken out of it.",
  },
  silver: {
    name: "Silver", damage: 1.1, armour: 1.1, accuracy: 4, weight: 0.9, value: 45,
    about: "Not the hardest. Some things mind it a great deal.",
  },
  meteoric: {
    name: "Meteoric", damage: 1.5, armour: 1.5, accuracy: 5, weight: 0.8, value: 120,
    about: "It arrived already finished. Working it is mostly listening.",
  },
};

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export const QUALITIES = [
  "crude", "plain", "fine", "superior", "masterwork",
] as const;

export type QualityId = (typeof QUALITIES)[number];

export const QUALITY: Record<QualityId, { name: string; damage: number; armour: number; accuracy: number; value: number }> = {
  crude:      { name: "Crude",      damage: 0.75, armour: 0.7,  accuracy: -5, value: 0.5 },
  plain:      { name: "",           damage: 1,    armour: 1,    accuracy: 0,  value: 1 },
  fine:       { name: "Fine",       damage: 1.15, armour: 1.15, accuracy: 3,  value: 2 },
  superior:   { name: "Superior",   damage: 1.3,  armour: 1.3,  accuracy: 6,  value: 4 },
  masterwork: { name: "Masterwork", damage: 1.5,  armour: 1.5,  accuracy: 10, value: 9 },
};

/**
 * Which quality a roll comes out as.
 *
 * `roll` is the crafter's skill plus their Cunning plus the dice; the bands are
 * wide enough that a beginner can get lucky and a master can still have a bad
 * day, because a craft whose outcome is a foregone conclusion is a press of a
 * button rather than a decision about whether to spend the materials.
 */
export function qualityFor(roll: number): QualityId {
  if (roll < 10) return "crude";
  if (roll < 30) return "plain";
  if (roll < 55) return "fine";
  if (roll < 80) return "superior";
  return "masterwork";
}

export const qualityRank = (q: QualityId): number => QUALITIES.indexOf(q);

// ---------------------------------------------------------------------------
// Putting one together
// ---------------------------------------------------------------------------

/**
 * A specific weapon, as opposed to the kind of weapon.
 *
 * Carried alongside the item id, because two Iron Axes are the same content file
 * and may not be the same object: one of them might be masterwork.
 */
export type ItemInstance = {
  /** The content id it is an instance of. */
  item: string;
  material?: MaterialId;
  quality?: QualityId;
  /** Who made it, for the log and for pride. */
  maker?: string;
};

/** The numbers a weapon actually has, after class, material and quality. */
export type WeaponStats = {
  class: WeaponClass;
  name: string;
  damage: number;
  accuracy: number;
  speed: number;
  reach: number;
  twoHanded: boolean;
  material?: MaterialId;
  quality: QualityId;
  /** Spell power from the class, before anything the file itself adds. */
  focus: number;
};

/** What class an item's file says it is, defaulting sensibly. */
export function classOf(def: ItemDef | undefined): WeaponClass {
  const named = def?.weaponClass;
  if (named && (WEAPON_CLASSES as readonly string[]).includes(named)) return named as WeaponClass;
  return "unarmed";
}

/**
 * Work out a weapon's real numbers.
 *
 * Multiplicative in material and quality and additive in accuracy, because the
 * two kinds of bonus mean different things: being made of steel makes every blow
 * harder in proportion, while being well made shifts how often it lands by a
 * flat amount. Multiplying accuracy would make a masterwork dagger literally
 * unmissable and a crude one useless.
 */
export function weaponStats(def: ItemDef, inst?: ItemInstance): WeaponStats {
  const cls = classOf(def);
  const info = WEAPON_CLASS[cls];

  /*
   * The file's number is the weapon as written. Multipliers are for the copy.
   *
   * This distinction matters and is easy to get wrong. A file that says
   * "Silver Sabre, 15 damage" has ALREADY accounted for being a sabre and being
   * silver — the author wrote 15 knowing both. Multiplying by the class and the
   * material again on top of that double-counts, and the first version of this
   * did: a wooden staff written as 9 came out at 5, which looked like the
   * weapon system had broken the weapon.
   *
   * So the class and material tables are consulted for two things only:
   *   - the fallback damage, for a file that gives no number at all
   *   - the INSTANCE's material and quality, which is what crafting and a lucky
   *     find change about one particular copy
   *
   * The class still decides reach, speed, accuracy and which attribute it scales
   * off, which is where the character of a weapon actually lives.
   */
  const material = inst?.material;
  const mat = material ? MATERIAL[material] : undefined;
  const quality = inst?.quality ?? "plain";
  const q = QUALITY[quality];

  const base = def.damage ?? Math.round(14 * info.damage);

  return {
    class: cls,
    name: fullName(def, inst),
    damage: Math.max(1, Math.round(base * (mat?.damage ?? 1) * q.damage)),
    accuracy: (def.accuracy ?? 0) + info.accuracy + (mat?.accuracy ?? 0) + q.accuracy,
    speed: info.speed,
    reach: info.reach,
    twoHanded: !!info.twoHanded,
    material,
    quality,
    focus: info.focus ?? 0,
  };
}

/**
 * "Masterwork Steel Axe", or just "Axe".
 *
 * Only an instance's material is named, never the file's own default. A file
 * that says it is wooden has already said so in its name where it matters —
 * "Oak Staff", "Silver Sabre" — and prefixing the default as well produced
 * "Wooden Ruin Staff", which reads as a bug. A material prefix therefore means
 * "this particular one was made of something", which is exactly what a crafted
 * item is.
 */
export function fullName(def: ItemDef, inst?: ItemInstance): string {
  const parts: string[] = [];
  const quality = inst?.quality ?? "plain";
  if (QUALITY[quality].name) parts.push(QUALITY[quality].name);
  const material = inst?.material;
  if (material && MATERIAL[material]) parts.push(MATERIAL[material].name);
  parts.push(def.name ?? String(def.id));
  return parts.join(" ");
}

/**
 * What it is worth, before anybody haggles.
 *
 * Material and quality both multiply, so a masterwork meteoric blade is worth
 * vastly more than the sum of its parts — which is exactly the shape a crafting
 * economy needs, or there is no reason to ever make the good version.
 */
export function itemValue(def: ItemDef, inst?: ItemInstance): number {
  const base = def.value ?? guessValue(def);
  // Same rule as the stats: the file's price already knows what the file is
  // made of, so only a crafted copy's material moves it.
  const material = inst?.material;
  const mat = material ? MATERIAL[material] : undefined;
  const q = QUALITY[inst?.quality ?? "plain"];
  return Math.max(1, Math.round(base * (mat ? mat.value / MATERIAL.iron.value : 1) * q.value));
}

/**
 * A price for something whose file does not name one.
 *
 * Derived from what it does rather than left at zero, so that a new content file
 * is tradeable the moment it exists. A zero-value item would be free to buy and
 * worthless to sell, which looks like the economy is broken rather than like
 * somebody forgot a field.
 */
function guessValue(def: ItemDef): number {
  let worth = 10;
  worth += (def.damage ?? 0) * 3;
  worth += (def.armour ?? 0) * 6;
  worth += ((def.might ?? 0) + (def.focus ?? 0)) * 8;
  worth += ((def.accuracy ?? 0) + (def.evasion ?? 0)) * 3;
  if (def.casts) worth += 40 * (def.charges ?? 1);
  for (const mult of Object.values(def.resist ?? {})) {
    if (typeof mult === "number" && mult < 1) worth += Math.round((1 - mult) * 60);
  }
  if (def.unique) worth *= 6;
  return Math.max(1, Math.round(worth));
}

// ---------------------------------------------------------------------------
// Using one
// ---------------------------------------------------------------------------

/**
 * The damage a particular person does with a particular weapon.
 *
 * Skill is worth a flat percentage per point rather than a flat number, so that
 * practice with a dagger is worth proportionally the same as practice with a
 * maul — otherwise every skill point would be better spent on the heavier
 * weapon, and the class choice would collapse again.
 */
export function damageWith(
  stats: WeaponStats, attr: Attributes, skill = 0,
): number {
  const d = derive(attr);
  const fromAttribute = stats.class === "unarmed"
    ? d.lightDamage
    : WEAPON_CLASS[stats.class].scales === "heavy" ? d.heavyDamage : d.lightDamage;
  const practice = 1 + skill * 0.02;
  return Math.max(1, Math.round((stats.damage + fromAttribute) * practice));
}

/** The chance to hit with it, before the target's evasion. */
export function accuracyWith(
  stats: WeaponStats, attr: Attributes, skill = 0,
): number {
  const d = derive(attr);
  const fromAttribute = WEAPON_CLASS[stats.class].scales === "heavy"
    ? d.heavyAccuracy : d.lightAccuracy;
  return 85 + stats.accuracy + fromAttribute + skill;
}

/**
 * What a swing costs, in turns.
 *
 * Rounded to hundredths of a turn and fed to the energy scheduler, so a dagger
 * genuinely gets more swings rather than merely claiming to. Agility shortens it,
 * which is the one place where being quick compounds with a quick weapon — and
 * it is floored at a third of a turn so that cannot run away.
 */
export function swingCost(stats: WeaponStats, attr: Attributes): number {
  const d = derive(attr);
  const quickness = 100 / Math.max(50, d.speed);
  return Math.max(0.33, Math.round(stats.speed * quickness * 100) / 100);
}

/** Which skill a class trains. One per class, so practice is a real choice. */
export const skillFor = (cls: WeaponClass): string => `weapon-${cls}`;

/** Every weapon skill, for the character sheet. */
export const WEAPON_SKILLS = WEAPON_CLASSES.map(skillFor);
