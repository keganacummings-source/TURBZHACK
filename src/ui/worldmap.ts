/**
 * The world map screen.
 *
 * Two halves: `mapData` works out what to draw on the map itself — habitat
 * tinting, resource dots, and the markers for villages, dungeons and lairs — and
 * `mapSidebarHtml` builds the panel of filters and the index of what has been
 * found. The one rule both obey is the one the player asked for: nothing appears
 * until the ground it sits on has actually been seen. `level.known` is the only
 * authority on that, so every feature is checked against it before it is shown.
 */
import type { Game } from "../game.ts";
import type { Registry } from "../content/registry.ts";
import type { MapMarker } from "../render/draw.ts";

export type MapFilters = {
  villages: boolean;
  dungeons: boolean;
  lairs: boolean;
  timber: boolean;
  ore: boolean;
  fungus: boolean;
  creature: string | null;
};

export const DEFAULT_MAP_FILTERS: MapFilters = {
  villages: true, dungeons: true, lairs: true,
  timber: false, ore: false, fungus: false, creature: null,
};

const COLOR = {
  village: "#ecc659",
  dungeon: "#e2655a",
  lair: "#cba6ec",
  lairCleared: "#6a5a4a",
  timber: "#6fae55",
  ore: "#b8c2cf",
  fungus: "#d89be0",
  habitat: "#ff8f6a",
} as const;

/** Which resource a tile yields, by the skill it is harvested with. */
function resourceOf(reg: Registry, tileId: string): "timber" | "ore" | "fungus" | null {
  const skill = reg.tiles.get(tileId)?.harvest?.skill;
  if (skill === "woodcutting") return "timber";
  if (skill === "mining") return "ore";
  if (skill === "foraging") return "fungus";
  return null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

/** A compass bearing and tile distance from the player to a point. */
function bearing(game: Game, x: number, y: number): string {
  const dx = x - game.player.pos.x, dy = y - game.player.pos.y;
  const dist = Math.round(Math.hypot(dx, dy));
  if (dist <= 2) return "here";
  const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const a = (Math.atan2(dy, dx) * 4 / Math.PI + 8) % 8;
  return `${dirs[Math.round(a) % 8]} · ${dist}`;
}

const known = (game: Game, x: number, y: number): boolean =>
  game.level.inBounds(x, y) && !!game.level.known[game.level.idx(x, y)];

/** The creatures whose territory the player has uncovered, for the picker. */
function knownQuarry(game: Game, reg: Registry): { id: string; name: string }[] {
  if (game.place.kind !== "overworld") return [];
  const seen = new Set<string>();
  const level = game.level;
  for (let i = 0; i < level.known.length; i++) if (level.known[i]) seen.add(game.continent.biome[i]!);
  const out: { id: string; name: string }[] = [];
  for (const [id, e] of reg.enemies) {
    if (e.boss) continue;
    const biomes = e.biomes ?? [];
    if (biomes.length && !biomes.some((b) => seen.has(b))) continue;
    if (!biomes.length) continue;      // creatures with no listed home are not placeable
    out.push({ id, name: e.name ?? id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything to draw on the map, worked out from the filters and what is known.
 */
export function mapData(game: Game, reg: Registry, f: MapFilters): {
  markers: MapMarker[];
  resourceTiles: { x: number; y: number; color: string }[];
  highlight?: Set<number>;
  highlightColor?: string;
} {
  const level = game.level;
  const markers: MapMarker[] = [];
  const resourceTiles: { x: number; y: number; color: string }[] = [];

  if (game.place.kind === "overworld") {
    if (f.villages) {
      for (const v of game.continent.villages) {
        if (known(game, v.pos.x, v.pos.y)) markers.push({ x: v.pos.x, y: v.pos.y, color: COLOR.village });
      }
    }
    if (f.dungeons) {
      for (const e of game.continent.entrances) {
        if (known(game, e.pos.x, e.pos.y)) markers.push({ x: e.pos.x, y: e.pos.y, color: COLOR.dungeon });
      }
    }
    if (f.lairs) {
      for (const l of game.continent.lairs) {
        if (!known(game, l.pos.x, l.pos.y)) continue;
        const cleared = game.bossesKilled.has(l.enemy);
        markers.push({ x: l.pos.x, y: l.pos.y, color: cleared ? COLOR.lairCleared : COLOR.lair, ring: !cleared });
      }
    }

    // Resources: a scan of the revealed map, which only happens when the screen
    // is open, never per frame.
    const wantT = f.timber, wantO = f.ore, wantF = f.fungus;
    if (wantT || wantO || wantF) {
      for (let i = 0; i < level.known.length; i++) {
        if (!level.known[i]) continue;
        const cat = resourceOf(reg, level.palette[level.tiles[i]!]?.id ?? "");
        if (!cat) continue;
        if ((cat === "timber" && wantT) || (cat === "ore" && wantO) || (cat === "fungus" && wantF)) {
          resourceTiles.push({ x: i % level.w, y: (i / level.w) | 0, color: COLOR[cat] });
        }
      }
    }

    // Creature habitat: the revealed tiles where the chosen quarry lives.
    if (f.creature) {
      const def = reg.enemies.get(f.creature);
      if (def?.biomes?.length) {
        const biomes = new Set(def.biomes);
        const min = def.region?.min ?? 0, max = def.region?.max ?? 5;
        const hi = new Set<number>();
        for (let i = 0; i < level.known.length; i++) {
          if (!level.known[i]) continue;
          if (!biomes.has(game.continent.biome[i]!)) continue;
          const band = game.continent.region[i]!;
          if (band < min || band > max) continue;
          hi.add(i);
        }
        if (hi.size) return { markers, resourceTiles, highlight: hi, highlightColor: COLOR.habitat };
      }
    }
  } else {
    // In a dungeon the map is the floor itself; mark the ways in and out.
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        if (!known(game, x, y)) continue;
        const on = level.at(x, y)?.on;
        if (on === "stairs-down") markers.push({ x, y, color: COLOR.dungeon });
        else if (on === "stairs-up") markers.push({ x, y, color: COLOR.village });
        else if (on === "dungeon-exit") markers.push({ x, y, color: COLOR.lair, ring: true });
      }
    }
  }

  return { markers, resourceTiles };
}

/** The sidebar: filters, a legend, and an index of what has been found. */
export function mapSidebarHtml(game: Game, reg: Registry, f: MapFilters): string {
  const overworld = game.place.kind === "overworld";
  const place = esc(game.whereAmI ?? "The world");

  const toggle = (key: keyof MapFilters, label: string, color: string) =>
    `<button class="map-filter ${f[key] ? "on" : ""}" data-mapfilter="${key}">
      <span class="map-dot" style="background:${color}"></span>${esc(label)}
    </button>`;

  if (!overworld) {
    return `<h2>${place}</h2>
      <p class="dim">The floor as you have walked it. Red is the way down, gold the way up${
        game.bossesKilled.has(`keeper:${(game.place as { entrance: number }).entrance}`)
          ? ", and the ringed door leads to the surface" : ""}.</p>
      <p class="dim">Esc or M closes.</p>`;
  }

  // Discovered features, each gated on having been seen.
  const villages = game.continent.villages
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => known(game, v.pos.x, v.pos.y));
  const dungeons = game.continent.entrances
    .filter((e) => known(game, e.pos.x, e.pos.y));
  const lairs = game.continent.lairs
    .filter((l) => known(game, l.pos.x, l.pos.y));

  const feature = (name: string, sub: string, where: { x: number; y: number }, done = false) =>
    `<li class="${done ? "map-done" : ""}">
      <span class="map-feat-name">${esc(name)}</span>
      <span class="map-feat-sub">${esc(sub)}</span>
      <span class="map-feat-dir">${esc(bearing(game, where.x, where.y))}</span>
    </li>`;

  const quarry = knownQuarry(game, reg);
  const creatureSel = quarry.length
    ? `<select id="map-creature" class="map-select">
        <option value="">Creature habitat…</option>
        ${quarry.map((q) => `<option value="${esc(q.id)}" ${f.creature === q.id ? "selected" : ""}>${esc(q.name)}</option>`).join("")}
      </select>`
    : `<p class="dim">Explore to learn where creatures live.</p>`;

  const index = (title: string, rows: string) =>
    rows ? `<h3>${esc(title)}</h3><ul class="map-index">${rows}</ul>`
         : `<h3>${esc(title)}</h3><p class="dim">None found yet.</p>`;

  return `
    <h2>${place}</h2>
    <p class="dim">Only what you have explored. Walk further to fill it in.</p>

    <div class="map-filters">
      ${toggle("villages", "Villages", COLOR.village)}
      ${toggle("dungeons", "Dungeons", COLOR.dungeon)}
      ${toggle("lairs", "Boss lairs", COLOR.lair)}
      ${toggle("timber", "Timber", COLOR.timber)}
      ${toggle("ore", "Ore", COLOR.ore)}
      ${toggle("fungus", "Fungus", COLOR.fungus)}
    </div>
    ${creatureSel}

    ${index("Villages", villages.map(({ v }) =>
      feature(v.name, reg ? `${v.trade}` : "", v.pos)).join(""))}
    ${index("Dungeons", dungeons.map((e) =>
      feature(e.name, `tier ${e.depth}`, e.pos)).join(""))}
    ${index("Boss lairs", lairs.map((l) => {
      const def = reg.enemies.get(l.enemy);
      const done = game.bossesKilled.has(l.enemy);
      return feature(def?.title ?? def?.name ?? l.enemy, done ? "slain" : (def?.biomes?.[0] ?? "lair"), l.pos, done);
    }).join(""))}

    <p class="dim">Esc or M closes.</p>`;
}
