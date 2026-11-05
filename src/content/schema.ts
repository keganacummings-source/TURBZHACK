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
  /**
   * Statuses that only MAY land, each rolled separately for each creature hit.
   *
   * `applies` is the sure thing; this is the gamble. A spell with
   * `{ "status": "burning", "chance": 0.4 }` sets about two in five of whatever
   * it hits alight, and a beam through three goblins rolls three times.
   */
  inflicts?: { status: string; chance: number; turns?: number }[];
  /**
   * After the first target, leap on to more.
   *
   * Each hop goes to the nearest other hostile creature within `range` of the
   * one just struck, one it can see, for `falloff` of the previous hop's damage
   * (0.75 means a quarter weaker each time). Every creature it reaches rolls its
   * own statuses. Only for `target: "actor"`.
   */
  bounce?: { jumps: number; range?: number; falloff?: number };
  /** Fraction of ALL the damage this spell deals that comes back to the caster as health. */
  leech?: number;
  /** Set on spells built by the generator in engine/spellgen.ts, not by files. */
  generated?: boolean;
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
/**
 * An on-hit effect: something that happens when an attack lands, over and above
 * the damage itself.
 *
 * This is what makes an enchantment more than a stat stick. A sword that arcs
 * lightning to the next creature, a whip that cracks fire around whatever it
 * strikes, an axe that cleaves everything it stands beside — all of them are one
 * of these, carried by an affix and fired by the attack that rolls it.
 *
 * Every field after `kind` is optional and has a sensible default, so the
 * shortest proc is `{ "kind": "lifesteal", "leech": 0.2 }`.
 */
export type ProcDef = {
  /**
   * What it does:
   *   chain     — leaps to further nearby creatures, each for `damage`
   *   burst     — hits everything within `radius` of the one struck
   *   cleave    — hits everything adjacent to the attacker
   *   lifesteal — heals the attacker for `leech` of the damage dealt
   *   execute   — finishes a creature already under `threshold` of its health
   *   knockback — shoves the struck creature a tile away
   *   stun      — applies its statuses without extra damage
   */
  kind: "chain" | "burst" | "cleave" | "lifesteal" | "execute" | "knockback" | "stun";
  /** 0-1 chance to fire on a landed hit. Default 1 (always). */
  chance?: number;
  /** Damage to each creature it catches. */
  damage?: number;
  /** The element of that damage. Default follows the weapon. */
  dkind?: DamageKind;
  /** chain: how many further creatures it leaps to. Default 2. */
  jumps?: number;
  /** burst: how far from the struck creature it reaches. Default 1. */
  radius?: number;
  /** Statuses laid on everything it catches. */
  applies?: string[];
  /** How long those statuses last. */
  statusTurns?: number;
  /** execute: finish anything already below this fraction of max health. */
  threshold?: number;
  /** lifesteal: fraction of damage dealt returned to the attacker. */
  leech?: number;
  /** A line for the log when it goes off. `{target}` and `{caster}` expand. */
  say?: string;
};

export type AbilityDef = ContentBase & {
  damage: number;
  /** Pushes a surviving target one tile away after a hit. */
  knockback?: boolean;
  /** On-hit effects, folded in from the weapon's affixes. */
  procs?: ProcDef[];
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
  /** Body scale; larger creatures are harder to displace. */
  size?: "tiny" | "small" | "medium" | "large" | "huge";
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
/**
 * An affix: a random modifier that makes one piece of gear its own.
 *
 * Every piece of equipment that enters the game — crafted, bought, found,
 * dropped — can carry up to a couple of these, so two Steel Axes are rarely the
 * same object. An affix is a prefix ("Flaming") or a suffix ("of the Bear"), and
 * which it is decides where it sits in the name, so a fully-rolled item reads
 * "Flaming Steel Axe of the Bear".
 *
 * (The field is still called "enchantments" in the content folder for
 * continuity, but an enchantment and an affix are the same thing: a named bundle
 * of modifiers that rides on an item.)
 */
export type EnchantmentDef = ContentBase & {
  /** Where its name goes: before the item ("Flaming") or after ("of the Bear"). */
  place?: "prefix" | "suffix";
  /** Which slots it can land on. Empty means any. "weapon" includes the off-hand. */
  slots?: string[];
  /** Added to the bearer's stats and pools. */
  modify?: Partial<Record<
    "hpMax" | "staminaMax" | "manaMax" | "armour" | "speed"
    | "might" | "focus" | "accuracy" | "evasion", number>>;
  /** Added to the bearer's attributes while worn. */
  attributes?: Partial<Record<string, number>>;
  /** Multipliers added to the bearer's resistances. */
  resist?: Partial<Record<DamageKind, number>>;
  /** Extra damage on the bearer's attacks, and what kind. */
  bonusDamage?: number;
  bonusKind?: DamageKind;
  /** Statuses the bearer's attacks apply. */
  applies?: string[];
  /** On-hit effects the bearer's attacks carry — chain lightning, cleave, leech. */
  procs?: ProcDef[];
  /**
   * A chance, each time the bearer takes a plain step, of a second free step.
   * Boots of the wind. 1 means every move is doubled; 0.5 means half of them.
   */
  extraMove?: number;
  /** How good it is: 1 common, 3 rare. Decides when it appears and what it adds. */
  tier?: number;
  /** Relative commonness within its tier. Default 10. */
  weight?: number;
  script?: string;
};

// ---------------------------------------------------------------------------
// Items — content/items/*.json
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NPCs — content/npcs/*.json
// ---------------------------------------------------------------------------

/**
 * Somebody who lives in a village.
 *
 * An NPC is a role rather than a person: "the smith" is a file, and each village
 * that has one gets its own, with its own name and its own stock. That is what
 * lets a seed have nine villages with nine different smiths without nine
 * content files — and it means adding a new kind of villager is still one file,
 * which is the rule the whole content system is built on.
 */
export type NpcDef = ContentBase & {
  /** What they do, which decides what the conversation offers. */
  role: "trader" | "smith" | "alchemist" | "trainer" | "elder" | "stablemaster" | "guard";
  /** Which village trades they turn up in. Empty means all of them. */
  trades?: string[];
  /** How likely they are to be present at all, 0-1. Default 1. */
  chance?: number;
  /** What they say when you open the conversation, picked at random. */
  greetings?: string[];
  /** Things they will say if asked about the area. */
  gossip?: string[];
  /**
   * Which goods they deal in, beyond whatever the village produces.
   *
   * A trader deals in everything the village has; a specialist deals in their
   * own line as well, which is what makes it worth finding the right person
   * rather than the nearest one.
   */
  deals?: string[];
  /** Weapon or trade skills they will teach, and what it costs per point. */
  teaches?: { skill: string; price: number }[];
  /** Quest ids they may offer. */
  quests?: string[];
};

// ---------------------------------------------------------------------------
// Quests — content/quests/*.json
// ---------------------------------------------------------------------------

/**
 * Something somebody wants done.
 *
 * Quests are templates rather than fixed errands: "kill eight of something that
 * lives near here" is one file, and the particular creature, the count and the
 * reward are filled in from the world when it is offered. A hand-written quest
 * for every creature in a 71-strong bestiary would be 71 files that all say the
 * same thing, and the ones nobody ever sees would rot.
 */
export type QuestDef = ContentBase & {
  /**
   * What shape of task this is.
   *   "bounty"  — kill a number of a particular creature
   *   "slay"    — kill one named thing: a world boss or a dungeon keeper
   *   "gather"  — bring back a number of a particular good
   *   "deliver" — carry something to another village
   *   "delve"   — reach a given depth of a particular dungeon
   */
  kind: "bounty" | "slay" | "gather" | "deliver" | "delve";
  /** Who offers it. Roles, not names. */
  from?: string[];
  /** Difficulty band, 1-5, which decides what gets asked and what is paid. */
  tier?: number;
  /** How the request is phrased. `{what}`, `{count}` and `{where}` are filled in. */
  ask?: string[];
  /** What they say when it is done. */
  thanks?: string[];
  /** Coin, as a multiple of the tier. The real reward is worked out from the task. */
  pay?: number;
  /** An item handed over on completion, if any. */
  reward?: string;
  /** How much standing it earns with the village. */
  standing?: number;
};

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
  /**
   * What it consumes.
   *
   * A need is usually a specific item. A forge recipe can instead ask for an
   * amount of a MATERIAL FAMILY — `{ metal: 2 }` or `{ timber: 1 }` — which any
   * item of that family satisfies, and the best one used decides what the result
   * is made of. That is what lets a single "forge a sword" recipe produce an
   * iron, steel or meteoric sword without a recipe per metal.
   */
  needs: { item?: string; amount?: number; metal?: number; timber?: number }[];
  /** What it produces. */
  makes: { item: string; amount?: number };
  /** Turns of work. */
  turns?: number;
  /**
   * This recipe forges a piece of equipment, so the result rolls a quality and
   * takes a material.
   *
   * The material is whichever material-bearing ingredient was used — a sword
   * forged from steel ingots is a steel sword — and the quality is rolled from
   * the smith's skill, their Cunning, and the dice. That is where the depth of
   * crafting lives: the same recipe makes a crude iron blade in a beginner's
   * hands and a masterwork meteoric one in a master's.
   */
  forge?: boolean;
  /**
   * Hidden until learned.
   *
   * A recipe marked secret does not appear on the crafting screen until it has
   * been discovered — taught by a trainer, found written down, or worked out by
   * having its ingredients to hand. The basics are always known; the good things
   * are the reward for exploring the trade.
   */
  secret?: boolean;
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
  /** Which family this material belongs to, for recipes that take "any metal". */
  family?: "metal" | "timber";
  /**
   * This item is a lump of a material: an ingot, a plank, a hide.
   *
   * A recipe that forges equipment takes the material of whichever such
   * ingredient it consumed, so "forge a sword" plus a steel ingot is a steel
   * sword. One field rather than a recipe per material is what keeps the recipe
   * book from being seven near-identical copies of every weapon.
   */
  provides?: string;
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
   * Which paper-doll overlay to draw on the player when this is worn.
   *
   * A sprite key like "ovl-body-plate". Weapons leave it out and the renderer
   * picks the overlay from the weapon's class instead, so a new sword needs no
   * art. Left out on a non-visible item (a ring, an amulet), which correctly
   * shows nothing.
   */
  overlay?: string;
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
  /** Added to the wearer's maximum stamina while worn. */
  staminaMax?: number;
  /** Multiplied into the wearer's resistances: 0 immune, 0.5 halved, 2 double. */
  resist?: Partial<Record<DamageKind, number>>;
  /** Enchantment ids baked into it. */
  enchantments?: string[];
  /** Using it casts this spell. */
  casts?: string;
  /** Uses before it is gone. Absent means it is not consumed. */
  charges?: number;
  weight?: number;
  /**
   * Squares a weapon reaches, over its class's. A whip is a light weapon that
   * hits two squares away; saying so here is the whole change.
   */
  reach?: number;
  /** What using it is called in the log: "shoot", "lash". Defaults by class. */
  verb?: string;
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
  /** Body scale for forced-movement rules. */
  size?: "tiny" | "small" | "medium" | "large" | "huge";
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
  /**
   * The body plan, which decides what worn gear can be SHOWN on the sprite.
   *
   * "humanoid" (the default) wears everything visibly. "serpentine" (a naga)
   * has no feet, so boots never show. "amorphous" (an octopode) has no shape to
   * hang armour on, so only a weapon and something on the head appear. This is
   * the "only where the race has a matching style it can reference" rule: gear
   * with no matching place on the body is still worn and still works — it simply
   * is not drawn, rather than drawn somewhere wrong.
   */
  build?: "humanoid" | "serpentine" | "amorphous";
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
  "recipes", "npcs", "quests",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
