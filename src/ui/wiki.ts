/**
 * The in-game wiki.
 *
 * Built from the content registry rather than written by hand, which is the only
 * version of this that stays true: add an enemy file and it has a wiki page,
 * change a drop chance and the page says the new number. Nothing here is
 * maintained separately from the thing it describes.
 *
 * It answers the questions the content is actually organised around — where does
 * this live, what drops it, what is it made of — by walking the registry
 * backwards. "What drops the Ashmaw's Fang" is not a field on the item; it is
 * every enemy whose drop table mentions it, and that is how it is found here.
 */
import type { Registry } from "../content/registry.ts";
import type { EnchantmentDef, EnemyDef, ItemDef, ProcDef, RecipeDef, SpellDef, TileDef } from "../content/schema.ts";
import type { Game } from "../game.ts";
import { describe } from "../engine/equipment.ts";
import { ATTRIBUTES, ATTRIBUTE_BASE, ATTRIBUTE_INFO, POINTS_PER_LEVEL, derive, type Attributes, type AttributeId } from "../engine/attributes.ts";
import { affixEffect, describeAffixEffect, type Enchants } from "../engine/affixes.ts";
import {
  DUNGEON_FLOORS, DUNGEON_THEME_LABEL, DUNGEON_THEMES, dungeonKeeper,
} from "../world/dungeon.ts";
import { MILESTONE_EVERY, xpForLevel } from "../engine/progress.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

export type WikiSection =
  | "enemies" | "items" | "enchantments" | "spells" | "species" | "classes" | "recipes" | "tiles"
  | "abilities" | "statuses" | "upgrades" | "npcs" | "quests" | "dungeons" | "rules";

export const SECTIONS: { id: WikiSection; name: string }[] = [
  { id: "enemies", name: "Bestiary" },
  { id: "items", name: "Items" },
  { id: "enchantments", name: "Enchantments" },
  { id: "recipes", name: "Recipes" },
  { id: "spells", name: "Spells" },
  { id: "abilities", name: "Abilities" },
  { id: "statuses", name: "Statuses" },
  { id: "upgrades", name: "Level-ups" },
  { id: "quests", name: "Quests" },
  { id: "npcs", name: "Villagers" },
  { id: "dungeons", name: "Dungeons" },
  { id: "rules", name: "Stats & rules" },
  { id: "species", name: "Species" },
  { id: "classes", name: "Backgrounds" },
  { id: "tiles", name: "Terrain" },
];

/** An entry, flattened so search and listing do not care which kind it is. */
export type WikiEntry = {
  section: WikiSection;
  id: string;
  name: string;
  sprite?: string;
  /** Lowercased, for matching. */
  haystack: string;
};

const RULES = [
  { id: "attributes", name: "Attributes", about: "Strength, Agility, Endurance, Wits, Cunning and Presence drive derived character stats. Scores start at 10; each game's attribute modifier is score minus 10." },
  { id: "combat", name: "Combat stats", about: "Might adds ability damage; Focus adds spell damage; Accuracy is hit chance before target Evasion; Evasion reduces incoming hit chance. Armour reduces damage before resistance multipliers." },
  { id: "resistances", name: "Resistances", about: "A resistance value is a damage multiplier: 0 means immunity, 0.5 means half damage, 1 means unchanged, and 2 means double damage." },
  { id: "pools", name: "Health, stamina & mana", about: "Health reaching zero kills the character. Stamina pays for some attacks and actions; mana pays spell costs. Attribute scores, class/species, upgrades and equipment affect maximum pools." },
  { id: "regeneration", name: "Regeneration", about: "Health regenerates after a quiet period without taking damage. Endurance and permanent perks change the amount healed and the delay." },
  { id: "turns", name: "Turns & speed", about: "Actions advance the world. Speed is energy per turn: 100 is standard, and higher speed lets an actor act more often." },
  { id: "levels", name: "Experience & levels", about: `Level L requires round(18 × (L − 1)^1.72) total XP, up to level 99. Level 2 requires ${xpForLevel(2)} XP; each level grants ${POINTS_PER_LEVEL} attribute points and a choice of spell or upgrade, with milestone talents every ${MILESTONE_EVERY} levels.` },
  { id: "weapons", name: "Weapons & practice", about: "Weapon class, attributes, weapon practice, material and quality determine damage and action cost. Reach is measured in tiles; heavier swings generally cost more stamina and time." },
  { id: "equipment", name: "Equipment & enchantments", about: "Worn gear is recomputed from base stats whenever equipment changes. Enchantment resistance values multiply with other resistance sources; negative modifiers and vulnerabilities are real effects." },
  { id: "companions", name: "Companions", about: "Tameable creatures can join the party. Presence and perks affect taming; nearby companions share kill experience and can grow stronger." },
  { id: "shiny-enemies", name: "Shiny enemies & bonus coin", about: "Every spawned enemy gets a stable 1-in-48 shiny roll. Shiny enemies have a gold sparkle marker and always pay bonus coin: at least 10, or half their XP value rounded, in addition to the ordinary coin reward." },
  { id: "dungeon-rules", name: "Dungeon rules", about: `${DUNGEON_FLOORS} floors per dungeon. Floor number and entrance danger tier both increase the challenge; every tenth floor has a keeper's hall and a sealed exit that opens when the keeper is defeated.` },
];

export function indexWiki(reg: Registry, game?: Game): WikiEntry[] {
  const out: WikiEntry[] = [];
  const add = (section: WikiSection, map: Map<string, { id?: string; name?: string; sprite?: string; about?: string }>) => {
    for (const [id, def] of map) {
      out.push({
        section, id,
        name: def.name ?? id,
        sprite: def.sprite,
        haystack: `${id} ${def.name ?? ""} ${def.about ?? ""}`.toLowerCase(),
      });
    }
  };
  add("enemies", reg.enemies as never);
  add("items", reg.items as never);
  add("enchantments", reg.enchantments as never);
  add("recipes", reg.recipes as never);
  add("spells", reg.spells as never);
  add("abilities", reg.abilities as never);
  add("statuses", reg.statuses as never);
  add("upgrades", reg.upgrades as never);
  add("npcs", reg.npcs as never);
  add("quests", reg.quests as never);
  add("species", reg.species as never);
  add("classes", reg.classes as never);
  add("tiles", reg.tiles as never);
  for (const rule of RULES) {
    out.push({
      section: "rules", id: rule.id, name: rule.name,
      haystack: `${rule.id} ${rule.name} ${rule.about}`.toLowerCase(),
    });
  }
  out.push({
    section: "dungeons", id: "overview", name: "Dungeon basics",
    haystack: `dungeons floors keeper ${DUNGEON_FLOORS} depth danger`.toLowerCase(),
  });
  for (const [index, entrance] of (game?.continent.entrances ?? []).entries()) {
    out.push({
      section: "dungeons", id: `entrance-${index}`, name: entrance.name,
      haystack: `${entrance.name} ${entrance.theme} dungeon theme entrance floor depth tier ${entrance.depth}`.toLowerCase(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Matching is substring over name, id and blurb — enough, and predictable. */
export function searchWiki(entries: WikiEntry[], query: string): WikiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.haystack.includes(q));
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const band = (r?: { min?: number; max?: number }): string => {
  if (!r) return "anywhere";
  const min = r.min ?? 0, max = r.max ?? 5;
  if (min === 0 && max >= 5) return "anywhere";
  if (min === max) return `band ${min}`;
  return `bands ${min}–${max}`;
};

const resistanceWord = (kind: string, multiplier: number, immune = "immune"): string => {
  if (multiplier === 0) return `${kind} ${immune}`;
  if (multiplier < 1) return `${kind} ${Math.round((1 - multiplier) * 100)}% less damage`;
  if (multiplier > 1) return `${kind} ${Math.round((multiplier - 1) * 100)}% more damage taken`;
  return `${kind} normal`;
};

const HOW_FAR = [
  "right where you woke up",
  "close to home",
  "a walk out",
  "a fair way out",
  "far out",
  "the edge of the world",
];

/** What drops this item, with the real chances. */
function droppedBy(reg: Registry, itemId: string): string[] {
  const out: string[] = [];
  for (const [id, e] of reg.enemies as Map<string, EnemyDef>) {
    for (const d of e.drops ?? []) {
      if (d.item !== itemId) continue;
      out.push(`${e.name ?? id} — ${Math.round(d.chance * 100)}%`);
    }
  }
  return out;
}

/** What yields this item when harvested. */
function harvestedFrom(reg: Registry, itemId: string): string[] {
  const out: string[] = [];
  for (const [id, t] of reg.tiles as Map<string, TileDef>) {
    for (const y of t.harvest?.yields ?? []) {
      if (y.item !== itemId) continue;
      const amount = (y.amount ?? 1) > 1 ? ` (${y.amount} at a time)` : "";
      out.push(`${t.name ?? id} — ${Math.round(y.chance * 100)}%${amount}`);
    }
  }
  return out;
}

/** What recipes make this, and what recipes use it. */
function recipesFor(reg: Registry, itemId: string): { makes: string[]; uses: string[] } {
  const makes: string[] = [], uses: string[] = [];
  for (const [id, r] of reg.recipes as Map<string, RecipeDef>) {
    if (r.makes?.item === itemId) makes.push(`${r.name ?? id} (at a ${r.station})`);
    if ((r.needs ?? []).some((n) => n.item === itemId)) uses.push(r.name ?? id);
  }
  return { makes, uses };
}

/** One on-hit effect, in words. Mirrors the in-game detail panel. */
function procWords(p: ProcDef): string {
  const chance = (p.chance ?? 1) < 1 ? `${Math.round((p.chance ?? 1) * 100)}% on hit: ` : "on hit: ";
  const dmg = p.damage ? `${p.damage} ${p.dkind ?? "matching"} ` : "";
  switch (p.kind) {
    case "chain": return `${chance}arcs ${dmg}to ${p.jumps ?? 2} more foes`;
    case "burst": return `${chance}bursts ${dmg}around the target`;
    case "cleave": return `${chance}cleaves ${dmg}all around you`;
    case "lifesteal": return `heals ${Math.round((p.leech ?? 0.2) * 100)}% of damage dealt`;
    case "execute": return `${chance}finishes foes under ${Math.round((p.threshold ?? 0.2) * 100)}% health`;
    case "knockback": return `${chance}knocks the target back`;
    case "stun": return `${chance}applies ${p.applies?.join(", ") ?? "a status"}`;
    default: return "on hit: something happens";
  }
}

/** Everything an enchantment does, spelled out from its own fields. */
function enchantWords(reg: Registry, a: EnchantmentDef): string[] {
  return describeAffixEffect(
    affixEffect([String(a.id)], reg.enchantments as Enchants),
    (id) => reg.statuses.get(id)?.name ?? id,
    procWords,
  );
}

const facts = (rows: [string, string][]): string =>
  `<table class="sheet">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;

const list = (items: string[]): string =>
  items.length ? `<ul class="wiki-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";

/** One page. `id` is `section/thing`, which is also what the context menu links to. */
export function pageHtml(reg: Registry, section: WikiSection, id: string, game?: Game): string {
  const name = (map: Map<string, { name?: string }>, key: string) => map.get(key)?.name ?? key;

  if (section === "enemies") {
    const e = reg.enemies.get(id);
    if (!e) return `<p class="dim">Nothing known about ${esc(id)}.</p>`;
    const attacks = [...(e.abilities ?? []).map((a) => name(reg.abilities as never, a)),
                     ...(e.spells ?? []).map((s) => name(reg.spells as never, s))];
    const resist = Object.entries(e.resist ?? {})
      .map(([k, v]) => resistanceWord(k, v!));
    const drops = (e.drops ?? []).map((d) =>
      `${name(reg.items as never, d.item)} — ${Math.round(d.chance * 100)}%`);
    const tame = e.tameable;
    const lair = game?.continent.lairs.find((location) => location.enemy === id);
    const lairBiome = lair
      ? game?.biomeName(game.continent.biome[lair.pos.y * game.continent.level.w + lair.pos.x] ?? "")
      : undefined;

    return `
      <h2>${esc(e.title ?? e.name ?? id)}</h2>
      ${e.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(e.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(e.about ?? "")}</p>
      ${facts([
        ["Health", String(100 + (e.pools?.hp ?? 0))],
        ["Armour", e.armour ? String(e.armour) : ""],
        ["Speed", e.speed && e.speed !== 100 ? `${e.speed} — ${e.speed > 100 ? "faster" : "slower"} than you` : "your pace"],
        ["Accuracy", e.stats?.accuracy !== undefined ? `${e.stats.accuracy}%` : ""],
        ["Evasion", e.stats?.evasion !== undefined ? `${e.stats.evasion}%` : ""],
        ["Ability damage", e.stats?.might ? String(e.stats.might) : ""],
        ["Spell damage", e.stats?.focus ? String(e.stats.focus) : ""],
        ["Stamina / mana", `${100 + (e.pools?.stamina ?? 0)} / ${50 + (e.pools?.mana ?? 0)}`],
        ["Behaviour", e.ai ?? "melee"],
        ["Resists", resist.join(", ")],
        ["Worth", e.xp ? `${e.xp} xp` : ""],
        ["Found in", (e.biomes ?? []).join(", ") || "anywhere"],
        ["Notices you", e.sight ? `${e.sight} tiles` : ""],
        ["How far out", e.boss ? "its lair, and nowhere else" : `${band(e.region)} — ${HOW_FAR[e.region?.min ?? 0] ?? ""}`],
        ["World lair", lair ? `${lairBiome ?? "unknown biome"} at ${lair.pos.x}, ${lair.pos.y}` : ""],
        ["World-boss state", e.boss && game ? (game.bossesKilled.has(id) ? "defeated in this run" : "alive in this world") : ""],
        // A boss lives in its lair and nowhere else, so a floor range for it
        // would read as "found on dungeon floor 0 to 0", which is nonsense.
        ["Dungeon floors", e.boss ? "" : e.depth ? `${e.depth.min ?? 0}–${e.depth.max ?? 12}` : "any"],
      ])}
      ${attacks.length ? `<h3>Attacks</h3>${list(attacks)}` : ""}
      ${drops.length ? `<h3>Drops</h3>${list(drops)}` : ""}
      ${tame ? `<h3>Taming</h3><p>Base chance ${Math.round(tame.chance * 100)}%. Offering it food adds 30%; hurting it badly first adds up to 40% more.</p>
        ${tame.food?.length ? `<p class="dim">It will take: ${esc(tame.food.map((f) => name(reg.items as never, f)).join(", "))}.</p>` : ""}` : ""}
      <p class="wiki-note">Any spawned enemy has a deterministic 1-in-48 shiny chance. Shiny enemies are marked in the world and always add at least 10 bonus coin when defeated.</p>
      ${e.boss ? `<p class="wiki-note">A world boss. One exists per world, in a fixed lair.</p>` : ""}`;
  }

  if (section === "items") {
    const it = reg.items.get(id) as ItemDef | undefined;
    if (!it) return `<p class="dim">Nothing known about ${esc(id)}.</p>`;
    const from = droppedBy(reg, id);
    const dug = harvestedFrom(reg, id);
    const { makes, uses } = recipesFor(reg, id);
    // On-hit effects and bonuses that are part of the item itself (a named
    // artifact's signature), rather than rolled onto a copy of it.
    const baked = (it.enchantments ?? []).flatMap((eid) => {
      const a = reg.enchantments.get(eid);
      return a ? enchantWords(reg, a) : [];
    });
    return `
      <h2>${esc(it.name ?? id)}</h2>
      ${it.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(it.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(it.about ?? "")}</p>
      ${facts([
        ["Slot", it.slot ?? "carried"],
        ["Effect", describe(it)],
        ["Weapon", it.slot === "weapon" && it.weaponClass ? `${it.weaponClass}${it.material ? `, ${it.material}` : ""}` : ""],
        ["Base damage", it.slot === "weapon" && it.damage ? `${it.damage} ${it.kind ?? "physical"}` : ""],
        ["Armour", it.armour ? String(it.armour) : ""],
        ["Attributes", Object.entries(it.attributes ?? {}).map(([attribute, value]) => `${Number(value) > 0 ? "+" : ""}${value} ${attribute}`).join(", ")],
        ["Combat modifiers", [
          it.might ? `${it.might > 0 ? "+" : ""}${it.might} ability damage` : "",
          it.focus ? `${it.focus > 0 ? "+" : ""}${it.focus} spell damage` : "",
          it.accuracy ? `${it.accuracy > 0 ? "+" : ""}${it.accuracy}% accuracy` : "",
          it.evasion ? `${it.evasion > 0 ? "+" : ""}${it.evasion}% evasion` : "",
          it.staminaMax ? `${it.staminaMax > 0 ? "+" : ""}${it.staminaMax} stamina maximum` : "",
        ].filter(Boolean).join(", ")],
        ["Resistances", Object.entries(it.resist ?? {}).map(([kind, multiplier]) =>
          resistanceWord(kind, multiplier!, "immunity")).join(", ")],
        ["Requirements", Object.entries(it.requires ?? {}).map(([attribute, value]) => `${value} ${attribute}`).join(", ")],
        ["Worth", it.value ? `${it.value} coin` : ""],
        ["Found on floors", it.depth ? `${it.depth.min ?? 0}–${it.depth.max ?? 12}` : it.unique ? "never scattered" : "any"],
        ["Source", it.source ?? ""],
        ["Tool", it.tool ?? ""],
      ])}
      ${baked.length ? `<h3>Enchantments</h3>${list(baked)}` : ""}
      ${it.unique ? `<p class="wiki-note">A named item. It is never found lying around.</p>` : ""}
      ${from.length ? `<h3>Dropped by</h3>${list(from)}` : ""}
      ${dug.length ? `<h3>Gathered from</h3>${list(dug)}` : ""}
      ${makes.length ? `<h3>Made by</h3>${list(makes)}` : ""}
      ${uses.length ? `<h3>Used in</h3>${list(uses)}` : ""}
      ${!from.length && !dug.length && !makes.length && !it.unique
        ? `<p class="dim">Found lying around.</p>` : ""}`;
  }

  if (section === "enchantments") {
    const a = reg.enchantments.get(id) as EnchantmentDef | undefined;
    if (!a) return `<p class="dim">No such enchantment.</p>`;
    const where = (a.slots ?? []).length ? (a.slots ?? []).join(", ") : "anything you can wear or wield";
    // Which named items carry this baked in — the artifacts worth hunting for it.
    const baked: string[] = [];
    for (const [iid, it] of reg.items as Map<string, ItemDef>) {
      if ((it.enchantments ?? []).includes(id)) baked.push(it.name ?? iid);
    }
    return `
      <h2>${esc(a.name ?? id)}</h2>
      <p>${esc(a.about ?? "")}</p>
      ${facts([
        ["Kind", (a.place ?? "prefix") === "suffix" ? "suffix (of …)" : "prefix"],
        ["Goes on", where],
        ["Rarity", `tier ${a.tier ?? 1} — ${(a.tier ?? 1) >= 3 ? "rare, deep finds and bosses" : (a.tier ?? 1) === 2 ? "uncommon" : "common"}`],
      ])}
      <h3>What it does</h3>
      ${list(enchantWords(reg, a))}
      ${baked.length ? `<h3>Always on</h3>${list(baked)}` : ""}`;
  }

  if (section === "recipes") {
    const r = reg.recipes.get(id);
    if (!r) return `<p class="dim">No such recipe.</p>`;
    return `
      <h2>${esc(r.name ?? id)}</h2>
      <p>${esc(r.about ?? "")}</p>
      ${facts([
        ["Station", r.station],
        ["Trade", r.craft],
        ["Work", `${r.turns ?? 2} turns, less as the trade improves`],
      ])}
      <h3>Takes</h3>
      ${list((r.needs ?? []).map((n) =>
        n.item ? `${n.amount ?? 1} × ${name(reg.items as never, n.item)}`
        : n.metal ? `${n.metal} × any metal`
        : n.timber ? `${n.timber} × any timber` : "something"))}
      <h3>Makes</h3>
      ${list([`${r.makes.amount ?? 1} × ${name(reg.items as never, r.makes.item)}`])}`;
  }

  if (section === "spells") {
    const sp = reg.spells.get(id) as SpellDef | undefined;
    if (!sp) return `<p class="dim">No such spell.</p>`;
    return `
      <h2>${esc(sp.name ?? id)}</h2>
      <p>${esc(sp.about ?? "")}</p>
      ${facts([
        ["Mana", String(sp.mana ?? 0)],
        ["Stamina", String(sp.stamina ?? 0)],
        ["Damage", sp.damage ? `${sp.damage} ${sp.kind ?? "pure"}` : ""],
        ["Range", String(sp.range ?? 6)],
        ["Target", sp.target ?? "one visible actor"],
        ["Burst radius", sp.target === "burst" ? `${sp.radius ?? 1} tiles` : ""],
        ["Healing", sp.heal ? String(sp.heal) : ""],
        ["Cooldown", sp.cooldown ? `${sp.cooldown} turns` : ""],
        ["Life steal", sp.leech ? `${Math.round(sp.leech * 100)}% of damage dealt` : ""],
        ["Tier", String(sp.tier ?? 1)],
        ["Applies", (sp.applies ?? []).map((a) => name(reg.statuses as never, a)).join(", ")],
        ["Status duration", sp.statusTurns ? `${sp.statusTurns} turns` : ""],
        ["Bounces", sp.bounce ? `${sp.bounce.jumps} hops${sp.bounce.falloff ? `, ${Math.round(sp.bounce.falloff * 100)}% damage each hop` : ""}` : ""],
        ["Chance effects", (sp.inflicts ?? []).map((effect) =>
          `${name(reg.statuses as never, effect.status)} — ${Math.round(effect.chance * 100)}%${effect.turns ? `, ${effect.turns} turns` : ""}`).join(", ")],
      ])}`;
  }

  if (section === "abilities") {
    const ability = reg.abilities.get(id);
    if (!ability) return `<p class="dim">No such ability.</p>`;
    return `
      <h2>${esc(ability.name ?? id)}</h2>
      <p>${esc(ability.about ?? "")}</p>
      ${facts([
        ["Damage", `${ability.damage} ${ability.kind ?? "physical"}`],
        ["Range", `${ability.range ?? 1} tile${(ability.range ?? 1) === 1 ? "" : "s"}`],
        ["Action cost", `${ability.cost ?? 1} turns`],
        ["Stamina", String(ability.stamina ?? 0)],
        ["Mana", String(ability.mana ?? 0)],
        ["Cooldown", ability.cooldown ? `${ability.cooldown} turns` : "none"],
        ["Applies", (ability.applies ?? []).map((s) => name(reg.statuses as never, s)).join(", ")],
      ])}
      ${(ability.procs ?? []).length ? `<h3>On-hit effects</h3>${list((ability.procs ?? []).map(procWords))}` : ""}`;
  }

  if (section === "statuses") {
    const status = reg.statuses.get(id);
    if (!status) return `<p class="dim">No such status.</p>`;
    const tick = status.tick
      ? status.tick.percent !== undefined
        ? `${Math.round(status.tick.percent * 100)}% of ${status.tick.of ?? "the target"} each turn (${status.tick.kind})`
        : `${status.tick.amount ?? 0} ${status.tick.kind} damage each turn`
      : "";
    return `
      <h2>${esc(status.name)}</h2>
      <p>${esc(status.messages?.applied ?? status.name)}</p>
      ${facts([
        ["Duration", `${status.turns} turns`],
        ["Prevents action", status.preventsAction ? "yes" : ""],
        ["Prevents movement", status.preventsMove ? "yes" : ""],
        ["Break chance", status.breakChance ? `${Math.round(status.breakChance * 100)}% each turn` : ""],
        ["Damage over time", tick],
        ["Armour", status.modify?.armour ? `${status.modify.armour > 0 ? "+" : ""}${status.modify.armour}` : ""],
        ["Speed", status.modify?.speed ? `${status.modify.speed > 0 ? "+" : ""}${status.modify.speed}` : ""],
      ])}`;
  }

  if (section === "upgrades") {
    const upgrade = reg.upgrades.get(id);
    if (!upgrade) return `<p class="dim">No such level-up choice.</p>`;
    const modifiers = Object.entries(upgrade.modify ?? {})
      .filter(([, value]) => typeof value === "number" && value !== 0)
      .map(([key, value]) => `${Number(value) > 0 ? "+" : ""}${value} ${key}`);
    const perks = Object.entries(upgrade.perks ?? {})
      .filter(([, value]) => typeof value === "number" && value !== 0)
      .map(([key, value]) => `${Number(value) > 0 ? "+" : ""}${value} ${key}`);
    return `
      <h2>${esc(upgrade.name ?? id)}</h2>
      <p>${esc(upgrade.about ?? "")}</p>
      ${facts([
        ["Choice group", upgrade.group ?? "body"],
        ["Tier", String(upgrade.tier ?? 1)],
        ["Availability", upgrade.talent ? "milestone level (every fifth level)" : "ordinary level"],
      ])}
      ${modifiers.length ? `<h3>Character modifiers</h3>${list(modifiers)}` : ""}
      ${perks.length ? `<h3>Permanent perks</h3>${list(perks)}` : ""}`;
  }

  if (section === "quests") {
    const quest = reg.quests.get(id);
    if (!quest) return `<p class="dim">No such quest.</p>`;
    return `
      <h2>${esc(quest.name ?? id)}</h2>
      <p>${esc(quest.about ?? "")}</p>
      ${facts([
        ["Task", quest.kind],
        ["Difficulty tier", String(quest.tier ?? 1)],
        ["Available from", (quest.from ?? []).join(", ") || "eligible villagers"],
        ["Payment scale", `${quest.pay ?? 1} × tier-based reward`],
        ["Standing", quest.standing ? String(quest.standing) : ""],
        ["Item reward", quest.reward ? name(reg.items as never, quest.reward) : ""],
      ])}
      ${quest.ask?.length ? `<h3>Request wording</h3>${list(quest.ask)}` : ""}
      ${quest.thanks?.length ? `<h3>Completion wording</h3>${list(quest.thanks)}` : ""}`;
  }

  if (section === "npcs") {
    const npc = reg.npcs.get(id);
    if (!npc) return `<p class="dim">No such villager role.</p>`;
    return `
      <h2>${esc(npc.name ?? id)}</h2>
      <p>${esc(npc.about ?? "")}</p>
      ${facts([
        ["Role", npc.role],
        ["Village trades", (npc.trades ?? []).join(", ") || "all"],
        ["Chance to appear", `${Math.round((npc.chance ?? 1) * 100)}%`],
        ["Goods", (npc.deals ?? []).join(", ")],
        ["Quests", (npc.quests ?? []).map((q) => name(reg.quests as never, q)).join(", ")],
        ["Training", (npc.teaches ?? []).map((t) => `${t.skill} (${t.price} coin per point)`).join(", ")],
      ])}
      ${npc.greetings?.length ? `<h3>Greetings</h3>${list(npc.greetings)}` : ""}
      ${npc.gossip?.length ? `<h3>Local gossip</h3>${list(npc.gossip)}` : ""}`;
  }

  if (section === "dungeons") {
    if (id === "overview") {
      const entrances = game?.continent.entrances ?? [];
      const keepers = [...reg.enemies.values()]
        .filter((enemy) => !enemy.boss && (enemy.xp ?? 0) >= 150)
        .map((enemy) => enemy.name ?? String(enemy.id));
      return `
        <h2>Dungeon basics</h2>
        <p>Every dungeon has ${DUNGEON_FLOORS} floors. Jungle, swamp, caves, mansion and crypt themes change the floor palette and room layout; the theme also draws creatures from related habitats. The entrance's danger tier and the floor number both contribute to enemy difficulty. The final floor is a keeper's hall; defeat its keeper to open the sealed exit back to the surface. Once you leave a cleared dungeon, that site is retired and a new one appears elsewhere.</p>
        ${facts([
          ["Floors", String(DUNGEON_FLOORS)],
          ["Themes", DUNGEON_THEMES.map((theme) => DUNGEON_THEME_LABEL[theme]).join(", ")],
          ["Danger", "Entrance tier + floor − 1, capped at 12."],
          ["Final-floor boss", "A seeded non-world-boss enemy worth at least 150 XP, scaled to 2.5× health, +4 armour and +5 accuracy."],
          ["Known entrances", String(entrances.length)],
        ])}
        ${keepers.length ? `<h3>Possible keepers</h3>${list(keepers)}` : ""}
        ${entrances.length ? `<h3>This world's entrances</h3>${list(entrances.map((e, i) => `${e.name} — ${DUNGEON_THEME_LABEL[e.theme]}, danger tier ${e.depth}, world position ${e.pos.x}, ${e.pos.y}`))}` : ""}`;
    }
    const entranceIndex = Number(id.replace("entrance-", ""));
    const entrance = Number.isInteger(entranceIndex) ? game?.continent.entrances[entranceIndex] : undefined;
    if (!entrance) return `<p class="dim">This world-specific dungeon is unavailable until a run has been started.</p>`;
    const generation = game?.dungeonGeneration(entranceIndex) ?? 0;
    const seededKeeper = game
      ? dungeonKeeper(game.seed ^ (generation * 104729), entranceIndex, reg.enemies.values())
      : undefined;
    const activeKeeper = game?.place.kind === "dungeon" && game.place.entrance === entranceIndex
      ? game.actors.find((actor) => typeof actor.data["keeper"] === "string")
      : undefined;
    const keeperKey = `keeper:${entranceIndex}`;
    const keeperState = game?.bossesKilled.has(keeperKey)
      ? `${seededKeeper?.name ?? "Keeper"} — defeated`
      : activeKeeper?.name ?? seededKeeper?.name ?? "No eligible keeper definition";
    return `
      <h2>${esc(entrance.name)}</h2>
      <p>A generated ${DUNGEON_THEME_LABEL[entrance.theme]} ${DUNGEON_FLOORS}-floor dungeon in this world.</p>
      ${facts([
        ["World position", `${entrance.pos.x}, ${entrance.pos.y}`],
        ["Theme", DUNGEON_THEME_LABEL[entrance.theme]],
        ["Danger tier", String(entrance.depth)],
        ["Depth", `${DUNGEON_FLOORS} floors`],
        ["Deepest reached", String(game?.deepestIn.get(entranceIndex) ?? 0)],
        ["Dungeon state", game?.bossesKilled.has(keeperKey) ? "keeper defeated" : "keeper alive"],
        ["Keeper", keeperState],
      ])}
      <p class="wiki-note">The final-floor keeper is this seed's eligible high-experience enemy, scaled to 2.5× health, +4 armour and +5 accuracy.</p>`;
  }

  if (section === "rules") {
    const rule = RULES.find((entry) => entry.id === id);
    if (!rule) return `<p class="dim">No such rule.</p>`;
    if (id === "attributes") {
      return `
        <h2>${esc(rule.name)}</h2>
        <p>${esc(rule.about)}</p>
        ${facts(ATTRIBUTES.map((attribute) => [
          ATTRIBUTE_INFO[attribute].name,
          `${ATTRIBUTE_INFO[attribute].about} Modifier: score − ${ATTRIBUTE_BASE}.`,
        ]))}`;
    }
    if (id === "combat") {
      return `
        <h2>${esc(rule.name)}</h2>
        <p>${esc(rule.about)}</p>
        ${facts([
          ["Might", "Added to ability damage."],
          ["Focus", "Added to spell damage."],
          ["Accuracy", "Attacker's hit chance before target Evasion."],
          ["Evasion", "Reduces the attacker's hit chance."],
          ["Armour", "Flat damage reduction before the damage-kind resistance multiplier."],
        ])}`;
    }
    if (id === "levels") {
      return `
        <h2>${esc(rule.name)}</h2>
        <p>${esc(rule.about)}</p>
        ${facts([1, 2, 3, 4, 5, 6, 10].map((level) => [
          `Level ${level}`,
          `${xpForLevel(level)} total XP${level > 1 ? ` · next level at ${xpForLevel(level + 1)} XP` : ""}`,
        ]))}`;
    }
    return `<h2>${esc(rule.name)}</h2><p>${esc(rule.about)}</p>`;
  }

  if (section === "species" || section === "classes") {
    const map = section === "species" ? reg.species : reg.classes;
    const d = map.get(id) as {
      name?: string; about?: string; sprite?: string;
      pools?: Record<string, number>; attributes?: Record<string, number>;
      spells?: string[]; abilities?: string[]; items?: string[];
      stats?: Record<string, number>; resist?: Record<string, number>;
      armour?: number; speed?: number;
    } | undefined;
    if (!d) return `<p class="dim">No such thing.</p>`;

    /*
     * A species or a background is only HALF a character — its attribute
     * differences add to the other half's. So the page shows the shifts this one
     * brings ("+2 Strength"), and the pools those shifts are worth on their own,
     * rather than a flat 100/100/50 that is the same for everyone and true for
     * no one.
     */
    const shifts = ATTRIBUTES
      .map((a) => [a, d.attributes?.[a] ?? 0] as [AttributeId, number])
      .filter(([, v]) => v)
      .map(([a, v]) => `${v > 0 ? "+" : ""}${v} ${ATTRIBUTE_INFO[a].name}`);
    const attrs = Object.fromEntries(
      ATTRIBUTES.map((a) => [a, ATTRIBUTE_BASE + (d.attributes?.[a] ?? 0)]),
    ) as Attributes;
    const dv = derive(attrs);
    const pool = (base: number, k: "hp" | "stamina" | "mana", bonus: number) =>
      Math.max(k === "hp" ? 1 : 0, base + (d.pools?.[k] ?? 0) + bonus);

    return `
      <h2>${esc(d.name ?? id)}</h2>
      ${d.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(d.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(d.about ?? "")}</p>
      ${facts([
        ["Attributes", shifts.length ? shifts.join(", ") : "even across the board"],
        ["Health", `${pool(100, "hp", dv.hpBonus)}${section === "species" ? " on its own" : ""}`],
        ["Stamina", `${pool(100, "stamina", dv.staminaBonus)}`],
        ["Mana", `${pool(50, "mana", dv.manaBonus)}`],
        ["Spells", (d.spells ?? []).map((s) => name(reg.spells as never, s)).join(", ")],
        ["Abilities", (d.abilities ?? []).map((a) => name(reg.abilities as never, a)).join(", ")],
        ["Kit", (d.items ?? []).map((i) => name(reg.items as never, i)).join(", ")],
        ["Armour", d.armour ? String(d.armour) : ""],
        ["Speed", d.speed && d.speed !== 100 ? String(d.speed) : ""],
        ["Combat modifiers", Object.entries(d.stats ?? {}).map(([stat, value]) => `${Number(value) > 0 ? "+" : ""}${value} ${stat}`).join(", ")],
        ["Resistances", Object.entries(d.resist ?? {}).map(([kind, multiplier]) =>
          resistanceWord(kind, multiplier!)).join(", ")],
      ])}
      <p class="dim">A run adds a species and a background together, so your real numbers are these plus the other half.</p>`;
  }

  const t = reg.tiles.get(id);
  if (!t) return `<p class="dim">No such terrain.</p>`;
  const h = t.harvest;
  return `
    <h2>${esc(t.name ?? id)}</h2>
    ${t.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(t.sprite)}.png" alt=""></div>` : ""}
    ${facts([
      ["Walkable", t.solid ? "no" : "yes"],
      ["Blocks sight", t.opaque ? "yes" : "no"],
      ["Station", t.station ?? ""],
      ["Found in", (t.biomes ?? []).join(", ")],
    ])}
    ${h ? `<h3>Harvesting</h3>
      ${facts([
        ["Trade", h.skill],
        ["Work", `${h.turns ?? 2} turns${h.tool ? `, doubled without a ${name(reg.items as never, h.tool).toLowerCase()}` : ""}`],
        ["Leaves", h.becomes ? name(reg.tiles as never, h.becomes) : "the ground it stood on"],
      ])}
      ${list((h.yields ?? []).map((y) =>
        `${name(reg.items as never, y.item)} — ${Math.round(y.chance * 100)}%${(y.amount ?? 1) > 1 ? ` (${y.amount} at a time)` : ""}`))}` : ""}`;
}

/** The whole screen: a search box, the section tabs, a list, and a page. */
export function wikiHtml(
  reg: Registry, entries: WikiEntry[], section: WikiSection, query: string, openId: string | null,
  game?: Game,
): string {
  const hits = searchWiki(entries, query).filter((e) => !query.trim() ? e.section === section : true);

  return `
    <h2>Wiki</h2>
    <div class="wiki">
      <div class="wiki-side">
        <input id="wiki-search" class="wiki-search" type="text" placeholder="Search everything" value="${esc(query)}" autocomplete="off">
        <div class="wiki-tabs">
          ${SECTIONS.map((s) => `<button class="wiki-tab ${s.id === section && !query.trim() ? "on" : ""}" data-wiki-section="${s.id}">${esc(s.name)}</button>`).join("")}
        </div>
        <div class="rows wiki-rows">
          ${hits.length ? hits.map((e) => `
            <button class="row ${openId === `${e.section}/${e.id}` ? "on" : ""}" data-wiki-open="${esc(e.section)}/${esc(e.id)}">
              ${e.sprite ? `<img src="assets/tiles16/${esc(e.sprite)}.png" alt="" width="20" height="20">` : `<span class="row-gap"></span>`}
              <span class="row-name">${esc(e.name)}</span>
              ${query.trim() ? `<span class="row-sub">${esc(e.section)}</span>` : ""}
            </button>`).join("")
            : `<p class="dim">Nothing matches that.</p>`}
        </div>
      </div>
      <div class="wiki-page">
        ${openId
          ? pageHtml(reg, openId.split("/")[0] as WikiSection, openId.split("/").slice(1).join("/"), game)
          : `<p class="dim">Pick something on the left, or right-click anything in the world and choose "look up".</p>`}
      </div>
    </div>`;
}
