/**
 * The content registry: every file under content/, loaded and checked.
 *
 * This is the piece that makes the game moddable. It knows nothing about any
 * particular enemy or spell — it reads whatever files are there, validates
 * them, fills in defaults, and hands the engine a lookup table.
 *
 * Three rules it is built around:
 *
 *   1. ONE FILE, ONE THING. content/enemies/goblin.json is the goblin. Its id
 *      defaults to its file name, so a new enemy needs no registration step
 *      anywhere — drop the file in and it is in the game.
 *
 *   2. NEVER FAIL SILENTLY. A typo in a mod file produces a loud, specific
 *      problem naming the file and the field. A broken file is skipped and the
 *      rest of the game still loads, because losing your whole game to one
 *      stray comma is how people give up on modding.
 *
 *   3. LAYERS. Later sources override earlier ones by id, so a mod can replace
 *      the base game's goblin by shipping its own goblin.json, without anyone
 *      editing the original.
 */
import { CARRIED_SLOTS } from "../engine/equipment.ts";
import { ATTRIBUTES } from "../engine/attributes.ts";
import { MATERIALS, WEAPON_CLASSES } from "../engine/weapons.ts";
import {
  CONTENT_KINDS,
  type AbilityDef, type ClassDef, type ContentKind, type EnchantmentDef,
  type EnemyDef, type ItemDef, type SpeciesDef, type SpellDef, type TileDef, type UpgradeDef,
} from "./schema.ts";
import type { NpcDef, QuestDef, RecipeDef } from "./schema.ts";
import type { StatusDef } from "../engine/status.ts";

/** Where a definition came from, so errors can point at a real file. */
export type Origin = { source: string; file: string };

export type Problem = {
  /** Which file. */
  where: string;
  /** What is wrong, in words a person can act on. */
  what: string;
  /** "error" means the file was skipped; "warn" means it loaded anyway. */
  level: "error" | "warn";
};

/** One place content comes from: the base game, or a mod folder. */
export type ContentSource = {
  /** Shown in problem reports. */
  name: string;
  /** kind -> file stem -> parsed JSON. */
  files: Partial<Record<ContentKind, Record<string, unknown>>>;
  /** Script module path -> module, for the `script` hooks. */
  scripts?: Record<string, unknown>;
};

export class Registry {
  readonly species = new Map<string, SpeciesDef>();
  readonly classes = new Map<string, ClassDef>();
  readonly enemies = new Map<string, EnemyDef>();
  readonly recipes = new Map<string, RecipeDef>();
  readonly npcs = new Map<string, NpcDef>();
  readonly quests = new Map<string, QuestDef>();
  readonly spells = new Map<string, SpellDef>();
  readonly abilities = new Map<string, AbilityDef>();
  readonly enchantments = new Map<string, EnchantmentDef>();
  readonly statuses = new Map<string, StatusDef>();
  readonly tiles = new Map<string, TileDef>();
  readonly items = new Map<string, ItemDef>();
  readonly upgrades = new Map<string, UpgradeDef>();
  readonly origins = new Map<string, Origin>();
  readonly scripts = new Map<string, unknown>();
  readonly problems: Problem[] = [];

  /** The map for a kind, so loading can be written once rather than eight times. */
  private mapFor(kind: ContentKind): Map<string, Record<string, unknown>> {
    switch (kind) {
      case "species": return this.species as never;
      case "classes": return this.classes as never;
      case "enemies": return this.enemies as never;
      case "recipes": return this.recipes as never;
      case "npcs": return this.npcs as never;
      case "quests": return this.quests as never;
      case "spells": return this.spells as never;
      case "abilities": return this.abilities as never;
      case "enchantments": return this.enchantments as never;
      case "statuses": return this.statuses as never;
      case "tiles": return this.tiles as never;
      case "items": return this.items as never;
      case "upgrades": return this.upgrades as never;
    }
  }

  /**
   * Add a source. Later calls win on id, which is what lets a mod replace a
   * base-game file without editing it.
   */
  add(source: ContentSource): void {
    for (const kind of CONTENT_KINDS) {
      const files = source.files[kind];
      if (!files) continue;
      for (const [stem, raw] of Object.entries(files)) {
        const where = `${source.name}:content/${kind}/${stem}.json`;
        const def = this.prepare(kind, stem, raw, where);
        if (!def) continue;
        const id = String(def.id);
        if (def.enabled === false) continue;
        this.mapFor(kind).set(id, def);
        this.origins.set(`${kind}:${id}`, { source: source.name, file: where });
      }
    }
    for (const [path, mod] of Object.entries(source.scripts ?? {})) {
      this.scripts.set(path, mod);
    }
  }

  /** Check one file and fill in its defaults. Returns null if it must be skipped. */
  private prepare(kind: ContentKind, stem: string, raw: unknown, where: string): Record<string, unknown> | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      this.problems.push({ where, what: "this file is not a JSON object", level: "error" });
      return null;
    }
    const def = { ...(raw as Record<string, unknown>) };

    // The id defaults to the file name. That is the rule that makes "drop in a
    // file and it exists" true, so it is applied before anything else.
    if (def.id === undefined) def.id = stem;
    if (typeof def.id !== "string" || !def.id.trim()) {
      this.problems.push({ where, what: `"id" must be a non-empty string`, level: "error" });
      return null;
    }
    if (def.name === undefined) {
      // A missing name is survivable: use the id, and say so.
      def.name = String(def.id);
      this.problems.push({ where, what: `no "name", so the id is being shown to the player`, level: "warn" });
    }
    if (typeof def.name !== "string") {
      this.problems.push({ where, what: `"name" must be a string`, level: "error" });
      return null;
    }
    if (def.sprite === undefined) def.sprite = def.id;

    const errors = checkKind(kind, def);
    for (const what of errors) this.problems.push({ where, what, level: "error" });
    if (errors.length) return null;

    return def;
  }

  /**
   * Cross-check every reference: a spell that applies a status that does not
   * exist, a class that starts with a spell nobody wrote.
   *
   * Run after everything is loaded, because a mod is allowed to refer forward
   * to something another mod provides.
   */
  checkReferences(): void {
    const ref = (from: string, kind: ContentKind, id: unknown, field: string) => {
      if (typeof id !== "string") return;
      if (this.mapFor(kind).has(id)) return;
      this.problems.push({
        where: this.origins.get(from)?.file ?? from,
        what: `${field} points at "${id}", which is not a file in content/${kind}/`,
        level: "warn",
      });
    };

    for (const [id, sp] of this.species) {
      for (const s of sp.spells ?? []) ref(`species:${id}`, "spells", s, `"spells"`);
      for (const a of sp.abilities ?? []) ref(`species:${id}`, "abilities", a, `"abilities"`);
    }
    for (const [id, c] of this.classes) {
      for (const s of c.spells ?? []) ref(`classes:${id}`, "spells", s, `"spells"`);
      for (const a of c.abilities ?? []) ref(`classes:${id}`, "abilities", a, `"abilities"`);
      for (const i of c.items ?? []) ref(`classes:${id}`, "items", i, `"items"`);
    }
    for (const [id, e] of this.enemies) {
      for (const s of e.spells ?? []) ref(`enemies:${id}`, "spells", s, `"spells"`);
      for (const a of e.abilities ?? []) ref(`enemies:${id}`, "abilities", a, `"abilities"`);
      for (const d of e.drops ?? []) ref(`enemies:${id}`, "items", d.item, `"drops"`);
    }
    for (const [id, s] of this.spells) {
      for (const st of s.applies ?? []) ref(`spells:${id}`, "statuses", st, `"applies"`);
    }
    for (const [id, a] of this.abilities) {
      for (const st of a.applies ?? []) ref(`abilities:${id}`, "statuses", st, `"applies"`);
    }
    for (const [id, t] of this.tiles) {
      const h = t.harvest;
      if (!h) continue;
      if (h.tool) ref(`tiles:${id}`, "items", h.tool, `"harvest.tool"`);
      if (h.becomes) ref(`tiles:${id}`, "tiles", h.becomes, `"harvest.becomes"`);
      for (const y of h.yields ?? []) ref(`tiles:${id}`, "items", y.item, `"harvest.yields"`);
    }
    for (const [id, e] of this.enemies) {
      for (const f of e.tameable?.food ?? []) ref(`enemies:${id}`, "items", f, `"tameable.food"`);
    }
    for (const [id, r] of this.recipes) {
      for (const n of r.needs ?? []) ref(`recipes:${id}`, "items", n.item, `"needs"`);
      if (r.makes?.item) ref(`recipes:${id}`, "items", r.makes.item, `"makes"`);
    }
    for (const [id, n] of this.npcs) {
      for (const d of n.deals ?? []) ref(`npcs:${id}`, "items", d, `"deals"`);
      for (const q of n.quests ?? []) ref(`npcs:${id}`, "quests", q, `"quests"`);
    }
    for (const [id, q] of this.quests) {
      if (q.reward) ref(`quests:${id}`, "items", q.reward, `"reward"`);
    }
    for (const [id, i] of this.items) {
      if (i.casts) ref(`items:${id}`, "spells", i.casts, `"casts"`);
      for (const e of i.enchantments ?? []) ref(`items:${id}`, "enchantments", e, `"enchantments"`);
    }
  }

  /** Everything that went wrong, worst first, ready to print. */
  report(): string[] {
    return [...this.problems]
      .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1))
      .map((p) => `[${p.level}] ${p.where}: ${p.what}`);
  }

  get errorCount(): number {
    return this.problems.filter((p) => p.level === "error").length;
  }
}

// ---------------------------------------------------------------------------
// Per-kind checks
// ---------------------------------------------------------------------------

const DAMAGE_KINDS = new Set(["physical", "fire", "cold", "shock", "poison", "pure"]);

/** Problems with a definition, as sentences. Empty means it is fine. */
function checkKind(kind: ContentKind, def: Record<string, unknown>): string[] {
  const out: string[] = [];
  const num = (field: string, { min = -Infinity, max = Infinity } = {}) => {
    const v = def[field];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      out.push(`"${field}" must be a number`);
    } else if (v < min || v > max) {
      out.push(`"${field}" is ${v}, which is outside ${min}..${max}`);
    }
  };
  const strList = (field: string) => {
    const v = def[field];
    if (v === undefined) return;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      out.push(`"${field}" must be a list of ids, like ["fire", "freeze"]`);
    }
  };
  const damageKind = (field: string) => {
    const v = def[field];
    if (v === undefined) return;
    if (typeof v !== "string" || !DAMAGE_KINDS.has(v)) {
      out.push(`"${field}" must be one of ${[...DAMAGE_KINDS].join(", ")}`);
    }
  };
  const oneOf = (field: string, allowed: string[]) => {
    const v = def[field];
    if (v === undefined) return;
    if (typeof v !== "string" || !allowed.includes(v)) {
      out.push(`"${field}" must be one of ${allowed.join(", ")}`);
    }
  };

  switch (kind) {
    case "spells":
      num("mana", { min: 0 });
      num("stamina", { min: 0 });
      num("damage", { min: 0 });
      num("range", { min: 0 });
      num("radius", { min: 0 });
      num("heal", { min: 0 });
      num("cooldown", { min: 0 });
      num("statusTurns", { min: 1 });
      num("tier", { min: 1, max: 5 });
      damageKind("kind");
      oneOf("target", ["actor", "self", "beam", "burst"]);
      strList("applies");
      if (def.mana === undefined) out.push(`"mana" is required — write 0 if it is free`);
      break;

    case "abilities":
      num("damage", { min: 0 });
      num("stamina", { min: 0 });
      num("mana", { min: 0 });
      num("range", { min: 0 });
      num("cooldown", { min: 0 });
      damageKind("kind");
      strList("applies");
      if (def.damage === undefined) out.push(`"damage" is required — write 0 for an ability that does none`);
      break;

    case "species":
      num("armour");
      num("speed", { min: 1 });
      num("difficulty", { min: 0 });
      strList("spells");
      strList("abilities");
      checkPools(def, out);
      checkResist(def, out);
      checkStats(def, out);
      break;

    case "classes":
      num("armour");
      strList("spells");
      strList("abilities");
      strList("items");
      checkPools(def, out);
      checkResist(def, out);
      checkStats(def, out);
      break;

    case "enemies":
      num("armour");
      num("speed", { min: 1 });
      num("sight", { min: 0 });
      num("weight", { min: 0 });
      num("xp", { min: 0 });
      strList("spells");
      strList("abilities");
      strList("biomes");
      checkBand(def, "region", 0, 5, out);
      checkAttributeMap(def, "attributes", out);
      checkDrops(def, out);
      oneOf("ai", ["melee", "caster", "wander", "skittish"]);
      oneOf("stance", ["hostile", "neutral", "friendly"]);
      checkPools(def, out);
      checkResist(def, out);
      checkStats(def, out);
      break;

    case "npcs":
      oneOf("role", ["trader", "smith", "alchemist", "trainer", "elder", "stablemaster", "guard"]);
      num("chance", { min: 0, max: 1 });
      strList("trades");
      strList("greetings");
      strList("gossip");
      strList("deals");
      strList("quests");
      break;

    case "quests":
      oneOf("kind", ["bounty", "slay", "gather", "deliver", "delve"]);
      num("tier", { min: 1, max: 5 });
      num("pay", { min: 0 });
      num("standing", { min: 0 });
      strList("from");
      strList("ask");
      strList("thanks");
      break;

    case "npcs":
      oneOf("role", ["trader", "smith", "alchemist", "trainer", "elder", "stablemaster", "guard"]);
      num("chance", { min: 0, max: 1 });
      strList("trades");
      strList("greetings");
      strList("gossip");
      strList("deals");
      strList("quests");
      break;

    case "quests":
      oneOf("kind", ["bounty", "slay", "gather", "deliver", "delve"]);
      num("tier", { min: 1, max: 5 });
      num("pay", { min: 0 });
      num("standing", { min: 0 });
      strList("from");
      strList("ask");
      strList("thanks");
      break;

    case "recipes":
      oneOf("station", ["camp", "forge", "bench"]);
      oneOf("craft", ["smithing", "cooking", "alchemy", "woodwork"]);
      num("turns", { min: 1 });
      checkParts(def, out);
      break;

    case "upgrades":
      oneOf("group", ["body", "arms", "magic", "trade", "company"]);
      num("tier", { min: 1, max: 3 });
      num("weight", { min: 0 });
      checkEffect(def, out);
      break;

    case "enchantments":
      oneOf("place", ["prefix", "suffix"]);
      num("tier", { min: 1, max: 3 });
      num("weight", { min: 0 });
      num("bonusDamage", { min: 0 });
      num("extraMove", { min: 0, max: 1 });
      strList("slots");
      strList("applies");
      checkAttributeMap(def, "attributes", out);
      checkResist(def, out);
      checkProcs(def, out);
      break;

    case "statuses":
      num("turns", { min: 1 });
      num("breakChance", { min: 0, max: 1 });
      if (def.turns === undefined) out.push(`"turns" is required — how long does it last?`);
      if (def.tick !== undefined) {
        const t = def.tick;
        if (t === null || typeof t !== "object") {
          out.push(`"tick" must be an object like {"kind": "fire", "percent": 0.25, "of": "sourceDamage"}`);
        } else {
          const tick = t as Record<string, unknown>;
          if (!DAMAGE_KINDS.has(String(tick.kind))) {
            out.push(`"tick.kind" must be one of ${[...DAMAGE_KINDS].join(", ")}`);
          }
          if (tick.amount === undefined && tick.percent === undefined) {
            out.push(`"tick" needs either "amount" (flat) or "percent" (a fraction)`);
          }
          if (tick.of !== undefined && !["sourceDamage", "maxHp", "currentHp"].includes(String(tick.of))) {
            out.push(`"tick.of" must be sourceDamage, maxHp or currentHp`);
          }
        }
      }
      break;

    case "enchantments":
      num("tier", { min: 0 });
      num("bonusDamage");
      damageKind("bonusKind");
      strList("applies");
      checkResist(def, out);
      break;

    case "items":
      num("damage", { min: 0 });
      num("armour");
      num("might");
      num("focus");
      num("accuracy");
      num("evasion");
      num("charges", { min: 0 });
      num("weight", { min: 0 });
      num("reach", { min: 1 });
      num("weight_find", { min: 0 });
      num("value", { min: 0 });
      damageKind("kind");
      strList("enchantments");
      oneOf("weaponClass", [...WEAPON_CLASSES]);
      oneOf("material", [...MATERIALS]);
      oneOf("provides", [...MATERIALS]);
      checkResist(def, out);
      checkAttributeMap(def, "requires", out);
      checkAttributeMap(def, "attributes", out);
      /*
       * A weapon has to say what kind of weapon it is.
       *
       * Without a class it falls back to "unarmed", which means a sword that
       * forgot the field would quietly have the reach, speed and scaling of a
       * fist — and look fine on the character sheet while doing a third of the
       * damage its file claims.
       */
      if (def.slot === "weapon" && def.weaponClass === undefined) {
        out.push(`is a weapon with no "weaponClass", so it would swing like a fist`);
      }
      if (def.slot !== undefined) {
        const slots = ["weapon", "offhand", "shield", "body", "head", "hands", "feet", "cloak", "ring", "amulet"];
        if (typeof def.slot !== "string") out.push(`"slot" must be a string`);
        else if (!slots.includes(def.slot) && !(CARRIED_SLOTS as readonly string[]).includes(def.slot)) {
          out.push(`"slot" is "${def.slot}" — use one of ${slots.join(", ")}, or potion/scroll/misc for something only carried`);
        }
      }
      break;

    case "tiles":
      oneOf("station", ["camp", "forge", "bench"]);
      num("cost", { min: 0 });
      strList("biomes");
      break;

    case "upgrades": {
      num("weight", { min: 0 });
      const m = def.modify;
      if (m === undefined) {
        out.push(`"modify" is required — what does this upgrade raise?`);
        break;
      }
      if (m === null || typeof m !== "object" || Array.isArray(m)) {
        out.push(`"modify" must be an object like {"might": 2}`);
        break;
      }
      const allowed = ["might", "focus", "accuracy", "evasion", "armour", "hpMax", "staminaMax", "manaMax"];
      const entries = Object.entries(m as Record<string, unknown>);
      if (!entries.length) out.push(`"modify" is empty, so this upgrade does nothing`);
      for (const [k, v] of entries) {
        if (!allowed.includes(k)) out.push(`"modify.${k}" is not something an upgrade can raise — use ${allowed.join(", ")}`);
        else if (typeof v !== "number" || !Number.isFinite(v)) out.push(`"modify.${k}" must be a number`);
      }
      break;
    }
  }
  return out;
}

/**
 * A `{ min, max }` band, checked so a typo fails loudly.
 *
 * A band with min above max matches nothing, which in a spawn table means a
 * creature that silently never appears anywhere — the worst kind of content
 * bug, because the game looks like it is working.
 */
function checkBand(
  def: Record<string, unknown>, field: string, low: number, high: number, out: string[],
): void {
  const band = def[field];
  if (band === undefined) return;
  if (typeof band !== "object" || band === null || Array.isArray(band)) {
    out.push(`"${field}" must be an object like { "min": 1, "max": 3 }`);
    return;
  }
  const { min, max } = band as { min?: unknown; max?: unknown };
  for (const [name, value] of [["min", min], ["max", max]] as [string, unknown][]) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      out.push(`"${field}.${name}" must be a number`);
    } else if (value < low || value > high) {
      out.push(`"${field}.${name}" is ${value}, outside ${low}-${high}`);
    }
  }
  if (typeof min === "number" && typeof max === "number" && min > max) {
    out.push(`"${field}" has min ${min} above max ${max}, so it matches nothing`);
  }
}

/** A drop table: every entry needs an item and a chance between 0 and 1. */
function checkDrops(def: Record<string, unknown>, out: string[]): void {
  const drops = def["drops"];
  if (drops === undefined) return;
  if (!Array.isArray(drops)) {
    out.push(`"drops" must be a list of { "item": ..., "chance": ... }`);
    return;
  }
  drops.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      out.push(`"drops[${i}]" is not an object`);
      return;
    }
    const { item, chance } = entry as { item?: unknown; chance?: unknown };
    if (typeof item !== "string" || !item) out.push(`"drops[${i}].item" must name an item`);
    if (typeof chance !== "number" || !(chance > 0) || chance > 1) {
      out.push(`"drops[${i}].chance" must be above 0 and at most 1, not ${String(chance)}`);
    }
  });
}

/** Attribute names, for `requires` and `attributes` on an item. */
function checkAttributeMap(def: Record<string, unknown>, field: string, out: string[]): void {
  const map = def[field];
  if (map === undefined) return;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    out.push(`"${field}" must be an object like { "strength": 12 }`);
    return;
  }
  for (const [key, value] of Object.entries(map)) {
    if (!(ATTRIBUTES as readonly string[]).includes(key)) {
      out.push(`"${field}.${key}" is not an attribute — use ${ATTRIBUTES.join(", ")}`);
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      out.push(`"${field}.${key}" must be a number`);
    }
  }
}

/** A recipe's inputs and output: both have to name real amounts of real items. */
function checkParts(def: Record<string, unknown>, out: string[]): void {
  const needs = def["needs"];
  if (!Array.isArray(needs) || !needs.length) {
    out.push(`"needs" must be a non-empty list of { "item": ..., "amount": ... }`);
  } else {
    needs.forEach((n, i) => {
      const { item, amount, metal, timber } = (n ?? {}) as
        { item?: unknown; amount?: unknown; metal?: unknown; timber?: unknown };
      const kinds = [item, metal, timber].filter((x) => x !== undefined).length;
      if (kinds === 0) out.push(`"needs[${i}]" must have an "item", a "metal" or a "timber"`);
      if (kinds > 1) out.push(`"needs[${i}]" mixes item/metal/timber — pick one`);
      if (item !== undefined && (typeof item !== "string" || !item)) out.push(`"needs[${i}].item" must name an item`);
      for (const [k, v] of [["metal", metal], ["timber", timber], ["amount", amount]] as [string, unknown][]) {
        if (v !== undefined && (typeof v !== "number" || v < 1)) out.push(`"needs[${i}].${k}" must be at least 1`);
      }
    });
  }
  const makes = def["makes"] as { item?: unknown; amount?: unknown } | undefined;
  if (!makes || typeof makes !== "object") out.push(`"makes" must be { "item": ..., "amount": ... }`);
  else if (typeof makes.item !== "string" || !makes.item) out.push(`"makes.item" must name an item`);
}

/**
 * An upgrade has to actually do something.
 *
 * It can raise a stat, or grant a perk, or both — but one with neither is a
 * level-up spent on nothing, and the only way the player finds out is by taking
 * it.
 */
function checkEffect(def: Record<string, unknown>, out: string[]): void {
  const modify = def["modify"] as Record<string, unknown> | undefined;
  const perks = def["perks"] as Record<string, unknown> | undefined;
  const hasModify = !!modify && Object.values(modify).some((v) => typeof v === "number" && v !== 0);
  const hasPerk = !!perks && Object.values(perks).some((v) => typeof v === "number" && v !== 0);
  if (!hasModify && !hasPerk) out.push(`has neither a "modify" nor a "perks" effect, so taking it would do nothing`);

  const PERKS = ["gatherSpeed", "gatherLuck", "craftSpeed", "party", "tame", "regen", "regenDelay"];
  for (const key of Object.keys(perks ?? {})) {
    if (!PERKS.includes(key)) out.push(`"perks.${key}" is not a perk — use ${PERKS.join(", ")}`);
  }
}

function checkPools(def: Record<string, unknown>, out: string[]): void {
  const p = def.pools;
  if (p === undefined) return;
  if (p === null || typeof p !== "object" || Array.isArray(p)) {
    out.push(`"pools" must be an object like {"hp": 20, "mana": -10}`);
    return;
  }
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (!["hp", "stamina", "mana"].includes(k)) {
      out.push(`"pools.${k}" is not a pool — use hp, stamina or mana`);
    } else if (typeof v !== "number" || !Number.isFinite(v)) {
      out.push(`"pools.${k}" must be a number (it is added to the base, so it may be negative)`);
    }
  }
}

function checkStats(def: Record<string, unknown>, out: string[]): void {
  const st = def.stats;
  if (st === undefined) return;
  if (st === null || typeof st !== "object" || Array.isArray(st)) {
    out.push(`"stats" must be an object like {"accuracy": 90, "might": 2}`);
    return;
  }
  for (const [k, v] of Object.entries(st as Record<string, unknown>)) {
    if (!["might", "focus", "accuracy", "evasion"].includes(k)) {
      out.push(`"stats.${k}" is not a combat stat — use might, focus, accuracy or evasion`);
    } else if (typeof v !== "number" || !Number.isFinite(v)) {
      out.push(`"stats.${k}" must be a number`);
    }
  }
}

function checkResist(def: Record<string, unknown>, out: string[]): void {
  const r = def.resist;
  if (r === undefined) return;
  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    out.push(`"resist" must be an object like {"fire": 0.5, "cold": 0}`);
    return;
  }
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (!DAMAGE_KINDS.has(k)) {
      out.push(`"resist.${k}" is not a damage kind — use ${[...DAMAGE_KINDS].join(", ")}`);
    } else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      out.push(`"resist.${k}" must be a number at or above 0 (0 immune, 1 normal, 2 double)`);
    }
  }
}

const PROC_KINDS = new Set(["chain", "burst", "cleave", "lifesteal", "execute", "knockback", "stun"]);

/** Check an enchantment's on-hit effects: each must name a known kind. */
function checkProcs(def: Record<string, unknown>, out: string[]): void {
  const p = def.procs;
  if (p === undefined) return;
  if (!Array.isArray(p)) {
    out.push(`"procs" must be a list, like [{"kind": "chain", "damage": 8}]`);
    return;
  }
  for (const raw of p) {
    if (raw === null || typeof raw !== "object") {
      out.push(`each entry in "procs" must be an object with a "kind"`);
      continue;
    }
    const proc = raw as Record<string, unknown>;
    if (!PROC_KINDS.has(String(proc.kind))) {
      out.push(`"procs" has kind "${String(proc.kind)}" — use one of ${[...PROC_KINDS].join(", ")}`);
    }
    if (proc.dkind !== undefined && !DAMAGE_KINDS.has(String(proc.dkind))) {
      out.push(`"procs" dkind "${String(proc.dkind)}" is not a damage kind`);
    }
    if (proc.chance !== undefined && (typeof proc.chance !== "number" || proc.chance < 0 || proc.chance > 1)) {
      out.push(`"procs" chance must be between 0 and 1`);
    }
  }
}
