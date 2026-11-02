/**
 * What a content file is allowed to say.
 *
 * Every enemy, spell, class, enchantment, status, tile and item in the game is
 * its own file under content/. These are the shapes those files take. They are
 * written to be read by a person with a text editor, not by a compiler:
 *
 *   - every field that can sensibly have a default HAS one, so the smallest
 *     useful enemy file is about four lines
 *   - nothing is positional and nothing is an abbreviation
 *   - anything the data cannot express is a named `script` hook, which is a
 *     sibling .js file, so you never have to touch the engine to add content
 *
 * `validate.ts` checks files against these shapes and reports problems with the
 * file name and the field, because a modding system that fails silently is
 * worse than one that does not exist.
 */
import type { DamageKind, Stance } from "../engine/types.ts";

/** Every content file carries these. */
export type ContentBase = {
  /** Unique within its kind. Defaults to the file name, so it can be omitted. */
  id?: string;
  /** Shown to the player. */
  name: string;
  /** A line of flavour, shown when you look at the thing. */
  about?: string;
  /** Sprite key in the atlas; defaults to the id. */
  sprite?: string;
  /** Set false to keep a file around without it appearing in the game. */
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// Spells — content/spells/*.json
// ---------------------------------------------------------------------------

export type SpellDef = ContentBase & {
  /** Mana to cast. */
  mana: number;
  /** Stamina to cast, if any. Most spells cost none. */
  stamina?: number;
  /** Damage before resistances. */
  damage?: number;
  /** What kind of damage, for resistances. Default "pure". */
  kind?: DamageKind;
  /**
   * How far it reaches, in tiles. 1 is touch.
   * Line of sight is required for anything above 1.
   */
  range?: number;
  /**
   * What it hits.
   *   "actor"  — one creature you can see (the default)
   *   "self"   — you
   *   "beam"   — everything in a straight line out to `range`
   *   "burst"  — everything within `radius` of the target tile
   */
  target?: "actor" | "self" | "beam" | "burst";
  radius?: number;
  /** Status ids to put on whatever it hits. */
  applies?: string[];
  /** Turns of that status, if it should differ from the status's own default. */
  statusTurns?: number;
  /** Health restored to the target. */
  heal?: number;
  /** Turns before it can be cast again. */
  cooldown?: number;
  /** What the log says when it is cast. `{caster}` and `{target}` are filled in. */
  say?: string;
  /**
   * How advanced it is, 1-5. The level-up roll only offers spells whose tier
   * you have reached, so this is what keeps Firestorm off a level-2 roll.
   */
  tier?: number;
  /** A sibling .js file with an `onCast` export, for anything the above cannot say. */
  script?: string;
};

// ---------------------------------------------------------------------------
// Classes — content/classes/*.json
// ---------------------------------------------------------------------------

export type ClassDef = ContentBase & {
  /** What this training did to the attributes, over the species' own. */
  attributes?: Partial<Record<string, number>>;
  /** Added to the 100/100/50 base. Negative to lower it. */
  pools?: Partial<Record<"hp" | "stamina" | "mana", number>>;
  /** Flat damage reduction. */
  armour?: number;
  /** Multipliers per damage kind. 0 is immune, 2 is double. */
  resist?: Partial<Record<DamageKind, number>>;
  /** Spell ids this class starts knowing. */
  spells?: string[];
  /** Ability ids — punch, kick and anything else you add. */
  abilities?: string[];
  /** Item ids in the starting pack. */
  items?: string[];
  /** Starting combat stats, over the defaults in actor.ts. */
  stats?: Partial<Record<"might" | "focus" | "accuracy" | "evasion", number>>;
  /** Shown on the class-select screen. */
  blurb?: string;
};

// ---------------------------------------------------------------------------
// Abilities — content/abilities/*.json
// ---------------------------------------------------------------------------

/**
 * The non-magical things anyone can do. Punch and kick are abilities, not
 * hardcoded verbs, so that "headbutt" is a file and not a patch.
 */
export type AbilityDef = ContentBase & {
  damage: number;
  /**
   * Turns per use, 1 being the standard pace.
   *
   * Set by a weapon's class when the ability is the swing of a weapon, so a
   * dagger genuinely gets more swings than a maul rather than merely claiming
   * to. A content file may set it directly for an ability that is meant to be
   * slow — a wind-up — but most do not.
   */
  cost?: number;
  kind?: DamageKind;
  stamina?: number;
  mana?: number;
  range?: number;
  applies?: string[];
  statusTurns?: number;
  cooldown?: number;
  say?: string;
  /** Key to bind it to on the action bar. */
  key?: string;
  script?: string;
};

// ---------------------------------------------------------------------------
// Enemies — content/enemies/*.json
// ---------------------------------------------------------------------------

export type EnemyDef = ContentBase & {
  /** Its attributes, as differences from the average of 10. */
  attributes?: Partial<Record<string, number>>;
  /** Added to the 100/100/50 base, same as a class. */
  pools?: Partial<Record<"hp" | "stamina" | "mana", number>>;
  armour?: number;
  resist?: Partial<Record<DamageKind, number>>;
  /** How it feels about you before anything happens. Default "hostile". */
  stance?: Stance;
  /** 100 is the player's pace; 150 acts half again as often. */
  speed?: number;
  /** Abilities and spells it may use. It picks whatever it can afford. */
  abilities?: string[];
  spells?: string[];
  /**
   * How it behaves.
   *   "melee"   — close the distance and hit you (the default)
   *   "caster"  — keep its distance and cast
   *   "wander"  — ignores you unless you hit it
   *   "skittish"— runs away
   */
  ai?: "melee" | "caster" | "wander" | "skittish";
  /** How far it notices you from. Default 8. */
  sight?: number;
  /** Where it is found: biome ids for the overworld, depths for dungeons. */
  biomes?: string[];
  depth?: { min?: number; max?: number };
  /**
   * How far from where you woke up this is found, as bands 0-5.
   *
   * Biome alone cannot carry difficulty, because the same biome runs from your
   * doorstep to the edge of the map: a forest two steps from the start and a
   * forest four hundred tiles away should not hold the same creatures. This is
   * the other axis — 0 is the home region, 5 is the far edge — and together the
   * two decide what you meet. Left out, a creature is found at any distance.
   */
  region?: { min?: number; max?: number };
  /**
   * A world boss: one of these exists in the world, in a lair of its own.
   *
   * It is placed when the continent is built rather than spawned by the normal
   * population pass, so it is always in the same place for a given seed and
   * killing it is permanent.
   */
  boss?: boolean;
  /** What it is called in full, for a boss: "Ashmaw, the Cinder Wyrm". */
  title?: string;
  /**
   * What it may leave behind, each with its own chance.
   *
   * Rolled independently per entry, so a creature can drop none, one, or all of
   * its table. Chance is 0-1.
   */
  drops?: { item: string; chance: number }[];
  /** Relative commonness within its band. Default 10. */
  weight?: number;
  /** Experience for killing it. */
  xp?: number;
  /** Combat stats, over the defaults. Mostly used to make something hard to hit. */
  stats?: Partial<Record<"might" | "focus" | "accuracy" | "evasion", number>>;
  /** A sibling .js file: `onTurn`, `onHurt`, `onDeath`. */
  script?: string;
  /**
   * Whether this can be talked round into following you, and how hard it is.
   *
   * `chance` is the bare odds with nothing to offer it. Feeding it something
   * from `food` improves them. A creature with no `tameable` block cannot be
   * tamed at all, which is most of them — a wraith has nothing to bargain with.
   */
  tameable?: { chance: number; food?: string[] };
  /** What a neutral creature says when you talk to it. */
  says?: string[];
};

// ---------------------------------------------------------------------------
// Enchantments — content/enchantments/*.json
// ---------------------------------------------------------------------------

/**
 * A lasting modifier, on an actor or an item. Unlike a status it has no
 * duration — it is a property of the thing, not something happening to it.
 */
export type EnchantmentDef = ContentBase & {
  /** Added to the bearer's stats. */
  modify?: Partial<Record<"hpMax" | "staminaMax" | "manaMax" | "armour" | "speed", number>>;
  /** Multipliers added to the bearer's resistances. */
  resist?: Partial<Record<DamageKind, number>>;
  /** Extra damage on the bearer's attacks. */
  bonusDamage?: number;
  bonusKind?: DamageKind;
  /** Statuses the bearer's attacks apply. */
  applies?: string[];
  /** How good it is, for pricing and for generation. */
  tier?: number;
  script?: string;
};

// ---------------------------------------------------------------------------
// Items — content/items/*.json
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recipes — content/recipes/*.json
// ---------------------------------------------------------------------------

/**
 * Turning what you gathered into something useful.
 *
 * A recipe is a station, a list of what goes in, and one thing that comes out.
 * The station is what stops every craft being available everywhere: smelting
 * needs a forge, cooking needs a fire, and alchemy needs a bench, so the
 * materials in your pack are only half of it.
 */
export type RecipeDef = ContentBase & {
  /** Where it can be made. "camp" is anywhere you can light a fire. */
  station: "camp" | "forge" | "bench";
  /** Which trade it belongs to, for grouping and for skill. */
  craft: "smithing" | "cooking" | "alchemy" | "woodwork";
  /** What it consumes. */
  needs: { item: string; amount?: number }[];
  /** What it produces. */
  makes: { item: string; amount?: number };
  /** Turns of work. */
  turns?: number;
};

export type ItemDef = ContentBase & {
  /**
   * A named item: one exists, and only a boss or a table drops it.
   *
   * Unique items are kept out of the ordinary ground scatter, so finding one
   * means something happened rather than that you walked far enough.
   */
  unique?: boolean;
  /** For the wiki: where this comes from, in words. */
  source?: string;
  /** This is the tool for a trade, so carrying it makes that work faster. */
  tool?: "mining" | "woodcutting" | "foraging";
  /** Several of these stack in the pack rather than taking a line each. */
  stack?: boolean;
  /**
   * Where it is worn. One of the slots in equipment.ts — weapon, offhand,
   * body, head, hands, feet, cloak, ring, amulet — or "shield", which is a
   * friendlier name for offhand. Leave it out for something you only carry,
   * like a potion.
   */
  slot?: string;
  /** Weapon damage, used only in the weapon hand. */
  damage?: number;
  kind?: DamageKind;
  /**
   * Which weapon class this is: dagger, sword, axe, mace, polearm, staff, bow.
   *
   * The class decides reach, swing speed, which attribute the damage scales off
   * and which skill it trains, so it is the most important thing a weapon file
   * says — more so than its damage number, which is only the baseline the class
   * and the material multiply.
   */
  weaponClass?: string;
  /** What it is made of by default: wood, bone, copper, iron, steel, silver, meteoric. */
  material?: string;
  /** What it is worth in coin, before material, quality or haggling. */
  value?: number;
  /**
   * Which attributes it demands, and what it gives.
   *
   * `requires` is a soft requirement: you can wear plate with eight Strength,
   * and it will cost you. `attributes` is added to the wearer outright.
   */
  requires?: Partial<Record<string, number>>;
  attributes?: Partial<Record<string, number>>;
  /** All of these are ADDED to the wearer while it is worn. */
  armour?: number;
  might?: number;
  focus?: number;
  accuracy?: number;
  evasion?: number;
  /** Multiplied into the wearer's resistances: 0 immune, 0.5 halved, 2 double. */
  resist?: Partial<Record<DamageKind, number>>;
  /** Enchantment ids baked into it. */
  enchantments?: string[];
  /** Using it casts this spell. */
  casts?: string;
  /** Uses before it is gone. Absent means it is not consumed. */
  charges?: number;
  weight?: number;
  /** How often it is found. Default 10; 0 means it is never generated. */
  weight_find?: number;
  /** Roughly how deep it starts appearing. */
  depth?: { min?: number; max?: number };
  script?: string;
};

// ---------------------------------------------------------------------------
// Tiles — content/tiles/*.json
// ---------------------------------------------------------------------------

export type TileDef = ContentBase & {
  solid?: boolean;
  opaque?: boolean;
  /** Movement cost, 1 being normal. */
  cost?: number;
  /** What stepping on it does: "stairs-down", "stairs-up", "dungeon-entrance". */
  on?: string;
  /** Which biome palettes use it. */
  biomes?: string[];
  /**
   * What you get for working at it, and what it leaves behind.
   *
   * A tree is wood, an ore vein is ore, a great mushroom is food. The tile is
   * replaced by `becomes` when it is used up — or, left out, by whatever was
   * drawn underneath it, which is what makes a felled tree turn back into the
   * grass it grew from without every tile having to say so.
   */
  /**
   * This tile is a crafting station: stand next to it to use its recipes.
   *
   * On the tile rather than on the recipe because a station is a thing in the
   * world you walk up to, and the renderer, the look panel and the crafting
   * screen all need to agree on which tiles those are.
   */
  station?: "camp" | "forge" | "bench";
  harvest?: {
    /** Which skill this trains and which tool helps: mining, woodcutting, foraging. */
    skill: "mining" | "woodcutting" | "foraging";
    /** Turns of work. Each turn the world takes its turn too. */
    turns?: number;
    /** An item that must be carried or worn. Without it the work is slower. */
    tool?: string;
    /** What it leaves. Omit to leave the ground it was standing on. */
    becomes?: string;
    yields: { item: string; chance: number; amount?: number }[];
  };
};

// ---------------------------------------------------------------------------
// Species — content/species/*.json
// ---------------------------------------------------------------------------

/**
 * What you ARE, as opposed to what you trained as.
 *
 * Crawl splits a character into a species and a background, and the split is
 * worth keeping: the species decides the body — how much it can take, how
 * fast it moves, what it is immune to — and the background decides what you
 * walked in carrying. Both contribute to the same totals, which is why they
 * share a shape.
 */
export type SpeciesDef = ContentBase & {
  /** Added to the 100/100/50 base. */
  pools?: Partial<Record<"hp" | "stamina" | "mana", number>>;
  armour?: number;
  resist?: Partial<Record<DamageKind, number>>;
  stats?: Partial<Record<"might" | "focus" | "accuracy" | "evasion", number>>;
  /** 100 is an ordinary pace. */
  speed?: number;
  /** Spells and abilities the body itself grants. */
  spells?: string[];
  abilities?: string[];
  /** How this body differs from the average of 10 in each attribute. */
  attributes?: Partial<Record<string, number>>;
  /** One line on the species-select screen. */
  blurb?: string;
  /** Lower is easier to play. Shown as a hint, nothing more. */
  difficulty?: number;
};

// ---------------------------------------------------------------------------
// Upgrades — content/upgrades/*.json
// ---------------------------------------------------------------------------

/**
 * A permanent improvement offered at a level-up.
 *
 * These sit alongside spells in the roll of five, so adding one is writing a
 * file — the same promise as everything else.
 */
export type UpgradeDef = ContentBase & {
  /** What it raises. Added to the current value, so negatives are allowed. */
  modify?: Partial<Record<
    "might" | "focus" | "accuracy" | "evasion" | "armour" | "hpMax" | "staminaMax" | "manaMax",
    number
  >>;
  /**
   * What it changes outside combat: trades, companions, regeneration.
   *
   * Separate from `modify` because these are not numbers on the actor — they are
   * things the Game consults when working out how fast a seam gives way or how
   * many companions you may keep, and putting them on the actor would mean
   * equipment could accidentally change them.
   */
  perks?: Partial<Record<
    | "gatherSpeed"      // turns off every harvest
    | "gatherLuck"       // better odds on the rare yields, as a fraction
    | "craftSpeed"       // turns off every craft
    | "party"            // more companions
    | "tame"             // better taming odds, as a fraction
    | "regen"            // health regained per turn once the delay has passed
    | "regenDelay",      // turns of not being hit before regeneration starts
    number
  >>;
  /**
   * Which part of a character this belongs to.
   *
   * The roll takes a spread across groups rather than a flat draw, so that a
   * level-up is a choice between KINDS of thing — tougher, deadlier, better at a
   * trade — instead of five variations on max health.
   */
  group?: "body" | "arms" | "magic" | "trade" | "company";
  /**
   * 1 is common, 3 is a capstone. Gated against level like a spell's tier.
   */
  tier?: number;
  /**
   * Only offered at a milestone level, and only once.
   *
   * Talents are the big ones. Mixing them into the ordinary roll would mean
   * either seeing one at level 2 or never seeing one at all, so they get their
   * own levels.
   */
  talent?: boolean;
  /** Relative commonness in the roll. Default 10. */
  weight?: number;
};

/** Every kind of content file, by folder name. */
export const CONTENT_KINDS = [
  "species", "classes", "enemies", "spells", "abilities", "enchantments", "statuses", "tiles", "items", "upgrades",
  "recipes",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
