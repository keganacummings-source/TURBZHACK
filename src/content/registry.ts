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
import {
  CONTENT_KINDS,
  type AbilityDef, type ClassDef, type ContentKind, type EnchantmentDef,
  type EnemyDef, type ItemDef, type SpellDef, type TileDef, type UpgradeDef,
} from "./schema.ts";
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
  readonly classes = new Map<string, ClassDef>();
  readonly enemies = new Map<string, EnemyDef>();
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
      case "classes": return this.classes as never;
      case "enemies": return this.enemies as never;
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

    for (const [id, c] of this.classes) {
      for (const s of c.spells ?? []) ref(`classes:${id}`, "spells", s, `"spells"`);
      for (const a of c.abilities ?? []) ref(`classes:${id}`, "abilities", a, `"abilities"`);
      for (const i of c.items ?? []) ref(`classes:${id}`, "items", i, `"items"`);
    }
    for (const [id, e] of this.enemies) {
      for (const s of e.spells ?? []) ref(`enemies:${id}`, "spells", s, `"spells"`);
      for (const a of e.abilities ?? []) ref(`enemies:${id}`, "abilities", a, `"abilities"`);
    }
    for (const [id, s] of this.spells) {
      for (const st of s.applies ?? []) ref(`spells:${id}`, "statuses", st, `"applies"`);
    }
    for (const [id, a] of this.abilities) {
      for (const st of a.applies ?? []) ref(`abilities:${id}`, "statuses", st, `"applies"`);
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
      oneOf("ai", ["melee", "caster", "wander", "skittish"]);
      oneOf("stance", ["hostile", "neutral", "friendly"]);
      checkPools(def, out);
      checkResist(def, out);
      checkStats(def, out);
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
      num("charges", { min: 0 });
      num("weight", { min: 0 });
      damageKind("kind");
      strList("enchantments");
      break;

    case "tiles":
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
