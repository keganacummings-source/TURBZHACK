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
import { describe } from "../engine/equipment.ts";
import { ATTRIBUTES, ATTRIBUTE_BASE, ATTRIBUTE_INFO, derive, type Attributes, type AttributeId } from "../engine/attributes.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

export type WikiSection = "enemies" | "items" | "enchantments" | "spells" | "species" | "classes" | "recipes" | "tiles";

export const SECTIONS: { id: WikiSection; name: string }[] = [
  { id: "enemies", name: "Bestiary" },
  { id: "items", name: "Items" },
  { id: "enchantments", name: "Enchantments" },
  { id: "recipes", name: "Recipes" },
  { id: "spells", name: "Spells" },
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

export function indexWiki(reg: Registry): WikiEntry[] {
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
  add("species", reg.species as never);
  add("classes", reg.classes as never);
  add("tiles", reg.tiles as never);
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
  const out: string[] = [];
  const m = a.modify ?? {};
  const label: Record<string, string> = {
    armour: "armour", might: "ability damage", focus: "spell damage",
    accuracy: "% hit", evasion: "% dodge", hpMax: "health",
    staminaMax: "stamina", manaMax: "mana", speed: "speed",
  };
  for (const [k, v] of Object.entries(m)) {
    if (typeof v !== "number" || !v) continue;
    out.push(`${v > 0 ? "+" : ""}${v} ${label[k] ?? k}`);
  }
  for (const [k, v] of Object.entries(a.attributes ?? {})) {
    if (typeof v === "number" && v) out.push(`${v > 0 ? "+" : ""}${v} ${k}`);
  }
  if (a.bonusDamage) out.push(`+${a.bonusDamage} ${a.bonusKind ?? "physical"} on every hit`);
  for (const s of a.applies ?? []) out.push(`attacks apply ${reg.statuses.get(s)?.name ?? s}`);
  for (const [k, v] of Object.entries(a.resist ?? {})) {
    if (typeof v !== "number") continue;
    out.push(`${k} ${v === 0 ? "immunity" : v < 1 ? `${Math.round((1 - v) * 100)}% resisted` : `${Math.round((v - 1) * 100)}% more taken`}`);
  }
  if (a.extraMove) out.push(a.extraMove >= 1 ? "a free step every move" : `${Math.round(a.extraMove * 100)}% chance of a free step`);
  for (const p of a.procs ?? []) out.push(procWords(p));
  return out;
}

const facts = (rows: [string, string][]): string =>
  `<table class="sheet">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("")}</table>`;

const list = (items: string[]): string =>
  items.length ? `<ul class="wiki-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";

/** One page. `id` is `section/thing`, which is also what the context menu links to. */
export function pageHtml(reg: Registry, section: WikiSection, id: string): string {
  const name = (map: Map<string, { name?: string }>, key: string) => map.get(key)?.name ?? key;

  if (section === "enemies") {
    const e = reg.enemies.get(id);
    if (!e) return `<p class="dim">Nothing known about ${esc(id)}.</p>`;
    const attacks = [...(e.abilities ?? []).map((a) => name(reg.abilities as never, a)),
                     ...(e.spells ?? []).map((s) => name(reg.spells as never, s))];
    const resist = Object.entries(e.resist ?? {})
      .map(([k, v]) => `${k} ${v === 0 ? "immune" : v! < 1 ? `${Math.round((1 - v!) * 100)}% less` : `${Math.round((v! - 1) * 100)}% more`}`);
    const drops = (e.drops ?? []).map((d) =>
      `${name(reg.items as never, d.item)} — ${Math.round(d.chance * 100)}%`);
    const tame = e.tameable;

    return `
      <h2>${esc(e.title ?? e.name ?? id)}</h2>
      ${e.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(e.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(e.about ?? "")}</p>
      ${facts([
        ["Health", String(100 + (e.pools?.hp ?? 0))],
        ["Armour", e.armour ? String(e.armour) : ""],
        ["Speed", e.speed && e.speed !== 100 ? `${e.speed} — ${e.speed > 100 ? "faster" : "slower"} than you` : "your pace"],
        ["Behaviour", e.ai ?? "melee"],
        ["Resists", resist.join(", ")],
        ["Worth", e.xp ? `${e.xp} xp` : ""],
        ["Found in", (e.biomes ?? []).join(", ") || "anywhere"],
        ["How far out", e.boss ? "its lair, and nowhere else" : `${band(e.region)} — ${HOW_FAR[e.region?.min ?? 0] ?? ""}`],
        // A boss lives in its lair and nowhere else, so a floor range for it
        // would read as "found on dungeon floor 0 to 0", which is nonsense.
        ["Dungeon floors", e.boss ? "" : e.depth ? `${e.depth.min ?? 0}–${e.depth.max ?? 12}` : "any"],
      ])}
      ${attacks.length ? `<h3>Attacks</h3>${list(attacks)}` : ""}
      ${drops.length ? `<h3>Drops</h3>${list(drops)}` : ""}
      ${tame ? `<h3>Taming</h3><p>Base chance ${Math.round(tame.chance * 100)}%. Offering it food adds 30%; hurting it badly first adds up to 40% more.</p>
        ${tame.food?.length ? `<p class="dim">It will take: ${esc(tame.food.map((f) => name(reg.items as never, f)).join(", "))}.</p>` : ""}` : ""}
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
        ["Effect", esc(describe(it))],
        ["Weapon", it.slot === "weapon" && it.weaponClass ? `${it.weaponClass}${it.material ? `, ${it.material}` : ""}` : ""],
        ["Worth", it.value ? `${it.value} coin` : ""],
        ["Found on floors", it.depth ? `${it.depth.min ?? 0}–${it.depth.max ?? 12}` : it.unique ? "never scattered" : "any"],
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
        ["Damage", sp.damage ? `${sp.damage} ${sp.kind ?? "pure"}` : ""],
        ["Range", String(sp.range ?? 6)],
        ["Tier", String(sp.tier ?? 1)],
        ["Applies", (sp.applies ?? []).map((a) => name(reg.statuses as never, a)).join(", ")],
      ])}`;
  }

  if (section === "species" || section === "classes") {
    const map = section === "species" ? reg.species : reg.classes;
    const d = map.get(id) as {
      name?: string; about?: string; sprite?: string;
      pools?: Record<string, number>; attributes?: Record<string, number>;
      spells?: string[]; items?: string[];
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
        ["Kit", (d.items ?? []).map((i) => name(reg.items as never, i)).join(", ")],
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
): string {
  const hits = searchWiki(entries, query).filter((e) => !query.trim() ? e.section === section : true);
  const shown = hits.slice(0, 200);

  return `
    <h2>Wiki</h2>
    <div class="wiki">
      <div class="wiki-side">
        <input id="wiki-search" class="wiki-search" type="text" placeholder="Search everything" value="${esc(query)}" autocomplete="off">
        <div class="wiki-tabs">
          ${SECTIONS.map((s) => `<button class="wiki-tab ${s.id === section && !query.trim() ? "on" : ""}" data-wiki-section="${s.id}">${esc(s.name)}</button>`).join("")}
        </div>
        <div class="rows wiki-rows">
          ${shown.length ? shown.map((e) => `
            <button class="row ${openId === `${e.section}/${e.id}` ? "on" : ""}" data-wiki-open="${esc(e.section)}/${esc(e.id)}">
              ${e.sprite ? `<img src="assets/tiles16/${esc(e.sprite)}.png" alt="" width="20" height="20">` : `<span class="row-gap"></span>`}
              <span class="row-name">${esc(e.name)}</span>
              ${query.trim() ? `<span class="row-sub">${esc(e.section)}</span>` : ""}
            </button>`).join("")
            : `<p class="dim">Nothing matches that.</p>`}
        </div>
        ${hits.length > shown.length ? `<p class="dim">${hits.length - shown.length} more — narrow the search.</p>` : ""}
      </div>
      <div class="wiki-page">
        ${openId
          ? pageHtml(reg, openId.split("/")[0] as WikiSection, openId.split("/").slice(1).join("/"))
          : `<p class="dim">Pick something on the left, or right-click anything in the world and choose "look up".</p>`}
      </div>
    </div>`;
}
