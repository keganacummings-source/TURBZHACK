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

export type View = {
  /** Whole-number zoom; fractional scaling blurs pixel art. */
  scale: number;
  /** Top-left tile of the visible area. */
  camX: number;
  camY: number;
  /** Size of the drawing area in tiles. */
  cols: number;
  rows: number;
};

/** Work out the camera for a canvas size, centred on the player and clamped to the map. */
export function viewFor(game: Game, canvas: HTMLCanvasElement, scale: number): View {
  const cols = Math.max(1, Math.floor(canvas.width / (TILE * scale)));
  const rows = Math.max(1, Math.floor(canvas.height / (TILE * scale)));
  const level = game.level;
  // Centre on the player, then clamp so the camera never shows past the edge —
  // except on a map smaller than the view, where it is pinned at 0.
  const camX = level.w <= cols ? 0 : Math.max(0, Math.min(level.w - cols, game.player.pos.x - (cols >> 1)));
  const camY = level.h <= rows ? 0 : Math.max(0, Math.min(level.h - rows, game.player.pos.y - (rows >> 1)));
  return { scale, camX, camY, cols, rows };
}

export function draw(ctx: CanvasRenderingContext2D, game: Game, atlas: Atlas, view: View): void {
  const { scale, camX, camY, cols, rows } = view;
  const size = TILE * scale;
  const level = game.level;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0a0e";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const tx = camX + rx, ty = camY + ry;
      if (!level.inBounds(tx, ty)) continue;
      const i = level.idx(tx, ty);
      const seen = level.known[i];
      if (!seen) continue;

      const px = rx * size, py = ry * size;
      const tile = level.palette[level.tiles[i]!];
      drawSprite(ctx, atlas, tile?.sprite ?? "stone", px, py, scale);

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

      // Creatures are only drawn where you can actually see them.
      const who = game.actorAt(tx, ty);
      if (who) {
        drawSprite(ctx, atlas, who.sprite, px, py, scale);
        if (who !== game.player) drawHealthPip(ctx, who, px, py, size);
        if (who.statuses.length) drawStatusPips(ctx, who, px, py, size, scale);
      }
    }
  }

  // The player last, so nothing is ever drawn over them.
  const pxl = (game.player.pos.x - camX) * size;
  const pyl = (game.player.pos.y - camY) * size;
  if (game.player.pos.x >= camX && game.player.pos.y >= camY &&
      game.player.pos.x < camX + cols && game.player.pos.y < camY + rows) {
    drawSprite(ctx, atlas, game.player.sprite, pxl, pyl, scale);
    ctx.strokeStyle = "rgba(255,240,190,.75)";
    ctx.lineWidth = Math.max(1, Math.round(scale / 2));
    ctx.strokeRect(pxl + 0.5, pyl + 0.5, size - 1, size - 1);
  }
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
