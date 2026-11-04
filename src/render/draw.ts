/**
 * Drawing the map.
 *
 * Three states per tile, and getting them right is most of what makes a
 * roguelike readable:
 *
 *   in view      — drawn fully, with whatever is standing on it
 *   remembered   — seen before, drawn dim, WITHOUT creatures: you remember the
 *                  room, not where the goblin wandered off to
 *   never seen   — not drawn at all
 *
 * Pixel art is drawn with smoothing off and on whole-pixel boundaries, or 16x16
 * tiles scaled up turn to mush.
 */
import type { Game } from "../game.ts";
import { drawSprite, TILE, type Atlas } from "./atlas.ts";
import { offsetOf, shotsAt, type Motion } from "./motion.ts";

export type View = {
  /** Whole-number zoom; fractional scaling blurs pixel art. */
  scale: number;
  /** Top-left tile of the visible area. */
  camX: number;
  camY: number;
  /** Size of the drawing area in tiles. */
  cols: number;
  rows: number;
  /**
   * Sub-tile scroll, in pixels, to be subtracted from every draw.
   *
   * The camera has to stay on whole tiles — `camX + rx` is how a tile is looked
   * up, and a fractional origin would read the wrong one — so the smooth part of
   * the scroll lives here instead. The loop draws one extra row and column to
   * cover the strip this shifts into view.
   */
  offX: number;
  offY: number;
};

/**
 * Work out the camera for a canvas size, centred on the player and clamped to
 * the map.
 *
 * `motion` and `now` are optional and only affect where the camera sits: the
 * player's sliding position is used instead of their tile, so the world does not
 * jump a whole tile underneath them halfway through their own step. Leave them
 * out and the camera snaps, which is what the overview map and the tests want.
 */
export function viewFor(
  game: Game, canvas: HTMLCanvasElement, scale: number, motion?: Motion, now = 0,
): View {
  const cols = Math.max(1, Math.floor(canvas.width / (TILE * scale)));
  const rows = Math.max(1, Math.floor(canvas.height / (TILE * scale)));
  const level = game.level;
  // Centre on the player, then clamp so the camera never shows past the edge —
  // except on a map smaller than the view, where it is pinned at 0.
  const slide = motion ? offsetOf(motion, game.player.id, now) : { dx: 0, dy: 0 };
  const wantX = level.w <= cols ? 0 : clamp(game.player.pos.x + slide.dx - (cols >> 1), 0, level.w - cols);
  const wantY = level.h <= rows ? 0 : clamp(game.player.pos.y + slide.dy - (rows >> 1), 0, level.h - rows);
  const camX = Math.floor(wantX);
  const camY = Math.floor(wantY);
  const size = TILE * scale;
  return {
    scale, camX, camY, cols, rows,
    offX: Math.round((wantX - camX) * size),
    offY: Math.round((wantY - camY) * size),
  };
}

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}

export function draw(
  ctx: CanvasRenderingContext2D, game: Game, atlas: Atlas, view: View,
  motion?: Motion, now = 0,
): void {
  const { scale, camX, camY, cols, rows, offX, offY } = view;
  const size = TILE * scale;
  const level = game.level;
  // One extra row and column, because a sub-tile scroll pulls part of the next
  // one into view and an un-drawn strip at the edge looks like a tear.
  const spanX = cols + 1, spanY = rows + 1;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0a0e";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let ry = 0; ry < spanY; ry++) {
    for (let rx = 0; rx < spanX; rx++) {
      const tx = camX + rx, ty = camY + ry;
      if (!level.inBounds(tx, ty)) continue;
      const i = level.idx(tx, ty);
      const seen = level.known[i];
      if (!seen) continue;

      const px = rx * size - offX, py = ry * size - offY;
      const tile = level.palette[level.tiles[i]!];
      // Ground first, then whatever stands on it. For plain ground the two are
      // the same index and this is one extra array read, not a second draw.
      const under = level.floor[i]!;
      if (under !== level.tiles[i]) {
        drawSprite(ctx, atlas, level.palette[under]?.sprite ?? "t-stone", px, py, scale);
      }
      drawSprite(ctx, atlas, tile?.sprite ?? "t-stone", px, py, scale);

      if (!level.visible[i]) {
        /*
         * Remembered, not seen. A dark wash over the tile rather than a redraw
         * at low alpha, because the latter lets the background show through and
         * the map ends up looking like fog instead of memory.
         */
        ctx.fillStyle = "rgba(6,6,12,.58)";
        ctx.fillRect(px, py, size, size);
        continue;
      }

      // Loot first: a creature standing on a sword hides the sword, which is
      // correct — you find out what it was standing on when it is dead.
      const here = game.lootAt(tx, ty);
      if (here.length) {
        const look = game.itemLook(here[0]!);
        drawSprite(ctx, atlas, look.sprite, px, py, scale, look.tint);
        if (look.shimmer > 0) drawShimmer(ctx, px, py, size, look.shimmer, now);
      }

      // Creatures are only drawn where you can actually see them.
      const who = game.actorAt(tx, ty);
      if (who && who !== game.player) {
        const slide = motion ? offsetOf(motion, who.id, now) : { dx: 0, dy: 0 };
        const sx = px + Math.round(slide.dx * size);
        const sy = py + Math.round(slide.dy * size);
        drawSprite(ctx, atlas, who.sprite, sx, sy, scale);
        drawHealthPip(ctx, who, sx, sy, size);
        if (who.statuses.length) drawStatusPips(ctx, who, sx, sy, size, scale);
        // A companion gets a mark, so a tamed wolf is not mistaken for a wolf.
        if (who.data["companion"]) {
          ctx.fillStyle = "#8fc46a";
          const r = Math.max(2, Math.round(scale));
          ctx.fillRect(sx + size - r - 1, sy + size - r - 1, r, r);
        }
      }
    }
  }

  // The player last, so nothing is ever drawn over them.
  const pslide = motion ? offsetOf(motion, game.player.id, now) : { dx: 0, dy: 0 };
  const pxl = Math.round((game.player.pos.x + pslide.dx - camX) * size) - offX;
  const pyl = Math.round((game.player.pos.y + pslide.dy - camY) * size) - offY;
  if (game.player.pos.x >= camX && game.player.pos.y >= camY &&
      game.player.pos.x < camX + cols && game.player.pos.y < camY + rows) {
    // The player is a paper-doll: base plus an overlay for each piece of worn
    // gear the species can show.
    for (const layer of game.playerLayers()) drawSprite(ctx, atlas, layer, pxl, pyl, scale);
    ctx.strokeStyle = "rgba(255,240,190,.75)";
    ctx.lineWidth = Math.max(1, Math.round(scale / 2));
    ctx.strokeRect(pxl + 0.5, pyl + 0.5, size - 1, size - 1);
  }

  // Arrows and bolts last of all: they fly over everything they cross.
  if (motion) {
    for (const s of shotsAt(motion, now)) {
      const len = Math.hypot(s.dx, s.dy) || 1;
      const ux = s.dx / len, uy = s.dy / len;
      const cx = Math.round((s.x + 0.5 - camX) * size) - offX;
      const cy = Math.round((s.y + 0.5 - camY) * size) - offY;
      ctx.lineCap = "round";
      // A short fading tail behind a bright head, so it reads as moving.
      ctx.strokeStyle = "rgba(255,230,170,.35)";
      ctx.lineWidth = Math.max(1, Math.round(scale));
      ctx.beginPath();
      ctx.moveTo(cx - ux * size * 0.7, cy - uy * size * 0.7);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = Math.max(1, Math.round(scale * 1.5));
      ctx.beginPath();
      ctx.moveTo(cx - ux * size * 0.3, cy - uy * size * 0.3);
      ctx.lineTo(cx + ux * size * 0.15, cy + uy * size * 0.15);
      ctx.stroke();
    }
  }
}

/**
 * A glint on an enchanted item lying on the ground.
 *
 * A small sparkle that drifts with the clock, brighter for a richer piece, so a
 * rare drop catches the eye without a legend. Drawn as a couple of bright
 * pixels rather than a glow, which stays crisp at the game's hard-pixel scale.
 */
function drawShimmer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, strength: number, now: number): void {
  const colours = ["#ffe9a8", "#bfe3ff", "#e6b8ff", "#ffd0a0"];
  const colour = colours[Math.min(colours.length - 1, strength - 1)] ?? "#ffe9a8";
  // Two sparkles orbiting the item, offset in phase, fading in and out.
  for (let i = 0; i < 2; i++) {
    const t = now / 650 + i * Math.PI;
    const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7));
    const cx = x + size / 2 + Math.cos(t) * size * 0.32;
    const cy = y + size / 2 + Math.sin(t) * size * 0.32;
    const r = Math.max(1, size * 0.06);
    ctx.globalAlpha = a;
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(cx - r), Math.round(cy - r), Math.round(r * 2), Math.round(r * 2));
  }
  ctx.globalAlpha = 1;
}

/** A thin bar over a wounded creature, so you can tell what is nearly dead. */
function drawHealthPip(ctx: CanvasRenderingContext2D, who: { pools: { hp: number; hpMax: number } }, px: number, py: number, size: number): void {
  const frac = who.pools.hp / Math.max(1, who.pools.hpMax);
  if (frac >= 1) return;
  const h = Math.max(1, Math.round(size * 0.08));
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(px, py, size, h);
  ctx.fillStyle = frac > 0.5 ? "#6fbf5f" : frac > 0.25 ? "#d7b74a" : "#c9453a";
  ctx.fillRect(px, py, Math.round(size * frac), h);
}

/** Tiny marks for burning, frozen and anything else riding on a creature. */
function drawStatusPips(
  ctx: CanvasRenderingContext2D,
  who: { statuses: { id: string; turns: number }[] },
  px: number, py: number, size: number, scale: number,
): void {
  const colours: Record<string, string> = {
    burning: "#ff8a3a",
    frozen: "#8fd6ff",
    chilled: "#b7dcee",
    rooted: "#8a6b3c",
  };
  const r = Math.max(1, Math.round(scale));
  let i = 0;
  for (const s of who.statuses) {
    if (s.turns <= 0) continue;
    ctx.fillStyle = colours[s.id] ?? "#c9a6e8";
    ctx.fillRect(px + 1 + i * (r * 2 + 1), py + size - r * 2 - 1, r * 2, r * 2);
    i++;
    if (i > 3) break;
  }
}

/**
 * The overview map: one pixel per tile, for the whole continent.
 *
 * Only what you have actually seen, which turns the map screen into a record of
 * where you have been rather than a free answer to where everything is.
 */
/** A point of interest on the world map. */
export type MapMarker = { x: number; y: number; color: string; ring?: boolean };

/**
 * The full world map.
 *
 * Draws the revealed terrain large, then the overlays the caller has worked out
 * — habitat tinting, resource dots, and point markers — on top. Everything it is
 * handed is already fog-gated by the caller, so this function never has to know
 * what counts as "discovered"; it just paints what it is given. Returns the
 * transform so the caller can place a legend or react to clicks in map space.
 */
export function drawWorldMap(
  ctx: CanvasRenderingContext2D,
  game: Game,
  biomeColour: (id: string) => string,
  opts: {
    highlight?: Set<number>;
    highlightColor?: string;
    resourceTiles?: { x: number; y: number; color: string }[];
    markers?: MapMarker[];
  } = {},
): { scale: number; offX: number; offY: number } {
  const level = game.level;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const scale = Math.max(1, Math.floor(Math.min(w / level.w, h / level.h)));
  const offX = Math.floor((w - level.w * scale) / 2);
  const offY = Math.floor((h - level.h * scale) / 2);
  const overworld = game.place.kind === "overworld";

  ctx.fillStyle = "#0b0a0e";
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const i = level.idx(x, y);
      if (!level.known[i]) continue;
      const biome = overworld ? game.continent.biome[i]! : "dungeon";
      ctx.fillStyle = overworld
        ? biomeColour(biome)
        : (level.solid(x, y) ? "#2a2730" : "#6d6678");
      ctx.fillRect(offX + x * scale, offY + y * scale, scale, scale);
    }
  }

  // Habitat tint: dim everything, then relight the tiles the quarry lives on.
  if (opts.highlight && opts.highlight.size) {
    ctx.fillStyle = "rgba(8,6,12,.62)";
    ctx.fillRect(offX, offY, level.w * scale, level.h * scale);
    ctx.fillStyle = opts.highlightColor ?? "#ff6a5a";
    for (const i of opts.highlight) {
      const x = i % level.w, y = (i / level.w) | 0;
      ctx.fillRect(offX + x * scale, offY + y * scale, scale, scale);
    }
  }

  // Resource dots.
  for (const r of opts.resourceTiles ?? []) {
    ctx.fillStyle = r.color;
    const s = Math.max(1, scale - 1);
    ctx.fillRect(offX + r.x * scale, offY + r.y * scale, s, s);
  }

  // Point markers, each a filled square with an outline so it reads at any zoom.
  const m = Math.max(3, scale + 2);
  for (const mk of opts.markers ?? []) {
    const px = offX + mk.x * scale - ((m - scale) >> 1);
    const py = offY + mk.y * scale - ((m - scale) >> 1);
    ctx.fillStyle = "#0b0a0e";
    ctx.fillRect(px - 1, py - 1, m + 2, m + 2);
    ctx.fillStyle = mk.color;
    ctx.fillRect(px, py, m, m);
    if (mk.ring) {
      ctx.strokeStyle = "#fff6d8";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 1.5, py - 1.5, m + 3, m + 3);
    }
  }

  // You, last and brightest.
  const pm = Math.max(3, scale + 2);
  const ppx = offX + game.player.pos.x * scale - ((pm - scale) >> 1);
  const ppy = offY + game.player.pos.y * scale - ((pm - scale) >> 1);
  ctx.fillStyle = "#fff6d8";
  ctx.fillRect(ppx, ppy, pm, pm);
  ctx.strokeStyle = "#140e0c";
  ctx.lineWidth = 1;
  ctx.strokeRect(ppx - 0.5, ppy - 0.5, pm + 1, pm + 1);

  return { scale, offX, offY };
}

export function drawOverview(ctx: CanvasRenderingContext2D, game: Game, biomeColour: (id: string) => string): void {
  const level = game.level;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const scale = Math.max(1, Math.floor(Math.min(w / level.w, h / level.h)));
  const offX = Math.floor((w - level.w * scale) / 2);
  const offY = Math.floor((h - level.h * scale) / 2);

  ctx.fillStyle = "#0b0a0e";
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const i = level.idx(x, y);
      if (!level.known[i]) continue;
      const biome = game.place.kind === "overworld" ? game.continent.biome[i]! : "dungeon";
      ctx.fillStyle = game.place.kind === "overworld"
        ? biomeColour(biome)
        : (level.solid(x, y) ? "#2a2730" : "#6d6678");
      ctx.fillRect(offX + x * scale, offY + y * scale, scale, scale);
    }
  }

  // Dungeon mouths you have found, and you.
  if (game.place.kind === "overworld") {
    for (const e of game.continent.entrances) {
      if (!level.known[level.idx(e.pos.x, e.pos.y)]) continue;
      ctx.fillStyle = "#ff6a5a";
      ctx.fillRect(offX + e.pos.x * scale - 1, offY + e.pos.y * scale - 1, scale + 2, scale + 2);
    }
  }
  ctx.fillStyle = "#fff6d8";
  ctx.fillRect(offX + game.player.pos.x * scale - 1, offY + game.player.pos.y * scale - 1, scale + 2, scale + 2);
}
