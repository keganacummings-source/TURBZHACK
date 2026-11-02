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
  /** A sibling .js file with an `onCast` export, for anything the above cannot say. */
  script?: string;
};

// ---------------------------------------------------------------------------
// Classes — content/classes/*.json
// ---------------------------------------------------------------------------

export type ClassDef = ContentBase & {
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
  /** Relative commonness within its band. Default 10. */
  weight?: number;
  /** Experience for killing it. */
  xp?: number;
  /** A sibling .js file: `onTurn`, `onHurt`, `onDeath`. */
  script?: string;
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

export type ItemDef = ContentBase & {
  /** "weapon" | "armour" | "potion" | "scroll" | "misc" — free text, used for sorting. */
  slot?: string;
  damage?: number;
  kind?: DamageKind;
  armour?: number;
  /** Enchantment ids baked into it. */
  enchantments?: string[];
  /** Using it casts this spell. */
  casts?: string;
  /** Uses before it is gone. Absent means it is not consumed. */
  charges?: number;
  weight?: number;
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
};

/** Every kind of content file, by folder name. */
export const CONTENT_KINDS = [
  "classes", "enemies", "spells", "abilities", "enchantments", "statuses", "tiles", "items",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
