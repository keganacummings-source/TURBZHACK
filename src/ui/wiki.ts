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
import type { EnemyDef, ItemDef, RecipeDef, SpellDef, TileDef } from "../content/schema.ts";
import { describe } from "../engine/equipment.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

export type WikiSection = "enemies" | "items" | "spells" | "species" | "classes" | "recipes" | "tiles";

export const SECTIONS: { id: WikiSection; name: string }[] = [
  { id: "enemies", name: "Bestiary" },
  { id: "items", name: "Items" },
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
    return `
      <h2>${esc(it.name ?? id)}</h2>
      ${it.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(it.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(it.about ?? "")}</p>
      ${facts([
        ["Slot", it.slot ?? "carried"],
        ["Effect", esc(describe(it))],
        ["Found on floors", it.depth ? `${it.depth.min ?? 0}–${it.depth.max ?? 12}` : it.unique ? "never scattered" : "any"],
      ])}
      ${it.unique ? `<p class="wiki-note">A named item. It is never found lying around.</p>` : ""}
      ${from.length ? `<h3>Dropped by</h3>${list(from)}` : ""}
      ${dug.length ? `<h3>Gathered from</h3>${list(dug)}` : ""}
      ${makes.length ? `<h3>Made by</h3>${list(makes)}` : ""}
      ${uses.length ? `<h3>Used in</h3>${list(uses)}` : ""}
      ${!from.length && !dug.length && !makes.length && !it.unique
        ? `<p class="dim">Found lying around.</p>` : ""}`;
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
      ${list((r.needs ?? []).map((n) => `${n.amount ?? 1} × ${name(reg.items as never, n.item)}`))}
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
    const d = map.get(id) as { name?: string; about?: string; sprite?: string; pools?: Record<string, number>; spells?: string[]; items?: string[] } | undefined;
    if (!d) return `<p class="dim">No such thing.</p>`;
    return `
      <h2>${esc(d.name ?? id)}</h2>
      ${d.sprite ? `<div class="sheet-art"><img src="assets/tiles16/${esc(d.sprite)}.png" alt=""></div>` : ""}
      <p>${esc(d.about ?? "")}</p>
      ${facts([
        ["Health", `${100 + (d.pools?.["hp"] ?? 0)}`],
        ["Stamina", `${100 + (d.pools?.["stamina"] ?? 0)}`],
        ["Mana", `${50 + (d.pools?.["mana"] ?? 0)}`],
        ["Spells", (d.spells ?? []).map((s) => name(reg.spells as never, s)).join(", ")],
        ["Kit", (d.items ?? []).map((i) => name(reg.items as never, i)).join(", ")],
      ])}`;
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
