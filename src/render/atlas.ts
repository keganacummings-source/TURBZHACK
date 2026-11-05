/**
 * Loading sprites, and surviving the ones that are missing.
 *
 * Every tile and creature names a sprite, and that sprite is a 16x16 PNG in
 * assets/tiles16/. A modder WILL add a monster before they draw it, so a
 * missing sprite must never be a crash or an invisible creature — it falls back
 * to a flat colour derived from the name, which is ugly on purpose so that you
 * can see at a glance what still needs drawing.
 */

export const TILE = 16;

export type Atlas = {
  /** Sprite key -> image, once loaded. */
  images: Map<string, HTMLImageElement>;
  /** Keys that failed to load, so the fallback is only reported once each. */
  missing: Set<string>;
  /** Where the PNGs live. */
  base: string;
  /** Tinted copies, cached by `key|colour`, so a material tint is built once. */
  tints: Map<string, HTMLCanvasElement>;
};

export function newAtlas(base = "assets/tiles16/"): Atlas {
  return { images: new Map(), missing: new Set(), base, tints: new Map() };
}

/**
 * A copy of a sprite tinted towards a colour, built once and cached.
 *
 * The tint is a multiply over the sprite's own pixels only — drawn on an
 * offscreen canvas and masked by the sprite's alpha with "source-atop" — so the
 * shape and shading survive and only the hue shifts. That is what lets an iron
 * sword and a steel sword share one drawing and still read as different metals.
 */
export function tinted(atlas: Atlas, key: string, colour: string, strength = 0.5): HTMLCanvasElement | null {
  const img = atlas.images.get(key);
  if (!img) return null;
  const cacheKey = `${key}|${colour}|${strength}`;
  const had = atlas.tints.get(cacheKey);
  if (had) return had;

  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, TILE, TILE);
  g.globalCompositeOperation = "source-atop";   // only where the sprite is
  g.globalAlpha = strength;
  g.fillStyle = colour;
  g.fillRect(0, 0, TILE, TILE);
  atlas.tints.set(cacheKey, c);
  return c;
}

/**
 * Load a list of sprite keys.
 *
 * Settles whatever happens: a key that 404s is recorded as missing rather than
 * rejecting the whole load, because one undrawn monster must not stop the game
 * from starting.
 */
export async function loadSprites(atlas: Atlas, keys: Iterable<string>): Promise<void> {
  const wanted = [...new Set(keys)].filter((k) => !atlas.images.has(k) && !atlas.missing.has(k));
  await Promise.all(wanted.map((key) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { atlas.images.set(key, img); done(); };
    img.onerror = () => { atlas.missing.add(key); done(); };
    img.src = `${atlas.base}${key}.png`;
  })));
}

/**
 * A stable colour for a sprite that has no art yet.
 *
 * From a hash of the name, so the same undrawn monster is the same colour every
 * time you see it and you can still tell two of them apart.
 */
export function fallbackColour(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 45% 45%)`;
}

/** Draw one 16x16 sprite, or its fallback, at a canvas position. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  key: string,
  x: number,
  y: number,
  scale = 1,
  tint?: string,
): void {
  const img = atlas.images.get(key);
  const size = TILE * scale;
  if (img) {
    if (tint) {
      const t = tinted(atlas, key, tint);
      if (t) { ctx.drawImage(t, x, y, size, size); return; }
    }
    ctx.drawImage(img, x, y, size, size);
    return;
  }
  // No art: a flat block with a dark border, which reads as "placeholder"
  // rather than as a tile you were meant to recognise.
  ctx.fillStyle = fallbackColour(key);
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
}
