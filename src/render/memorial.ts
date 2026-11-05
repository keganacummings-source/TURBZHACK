/**
 * Death memorial card — a shareable PNG of the fallen character.
 *
 * Drawn on an off-screen canvas. Download uses a Blob + temporary <a> so it
 * works in ordinary browsers and in the Tauri webview (data-URL click alone is
 * often blocked).
 */
import type { Game } from "../game.ts";
import type { Registry } from "../content/registry.ts";
import { ATTRIBUTES, ATTRIBUTE_INFO, type AttributeId } from "../engine/attributes.ts";
import { drawSprite, TILE, type Atlas } from "./atlas.ts";

const W = 640;
const H = 900;
const PAD = 28;
const PORTRAIT_SCALE = 10; // 16px tile → 160px

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; align?: CanvasTextAlign; weight?: string } = {},
): void {
  ctx.font = `${opts.weight ?? "normal"} ${opts.size ?? 14}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = opts.color ?? "#e8e0d0";
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
}

function line(ctx: CanvasRenderingContext2D, y: number, color = "rgba(255,210,90,0.25)"): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
}

function safeName(game: Game, reg: Registry): string {
  const species = reg.species.get(game.speciesId)?.name ?? game.speciesId ?? "Unknown";
  const bg = reg.classes.get(game.classId)?.name ?? game.classId ?? "Wanderer";
  return `${species}-${bg}-L${game.playerLevel ?? 1}`.replace(/[^\w\-]+/g, "_");
}

/** Build the memorial image for the current dead run. */
export function renderMemorial(game: Game, reg: Registry, atlas: Atlas): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Could not create memorial canvas context");

  ctx.fillStyle = "#0b0a0e";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255, 210, 90, 0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.strokeStyle = "rgba(255, 210, 90, 0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  const species = reg.species.get(game.speciesId);
  const bg = reg.classes.get(game.classId);
  const title = `${species?.name ?? game.speciesId} ${bg?.name ?? game.classId}`;
  const p = game.player;

  text(ctx, "TURBZHACK", PAD, 28, { size: 12, color: "rgba(255,210,90,0.7)", weight: "700" });
  text(ctx, "IN MEMORIAM", PAD, 46, { size: 22, color: "#ffd25a", weight: "700" });
  text(ctx, title, PAD, 76, { size: 20, color: "#f2ebe0", weight: "600" });
  text(ctx, `Level ${game.playerLevel}  ·  Turn ${game.turn}  ·  Seed ${game.seedWord}`, PAD, 102, {
    size: 13, color: "#9a9080",
  });

  line(ctx, 126);

  const px = PAD;
  const py = 142;
  const box = TILE * PORTRAIT_SCALE + 16;
  ctx.fillStyle = "#16141c";
  ctx.fillRect(px, py, box, box);
  ctx.strokeStyle = "rgba(255,210,90,0.35)";
  ctx.strokeRect(px + 0.5, py + 0.5, box - 1, box - 1);

  try {
    const layers = game.playerLayers?.() ?? [p.sprite];
    for (const key of layers) {
      drawSprite(ctx, atlas, key, px + 8, py + 8, PORTRAIT_SCALE);
    }
  } catch {
    // Portrait is optional; the rest of the card still downloads.
  }

  const rx = px + box + 20;
  text(ctx, "Fell to", rx, py + 8, { size: 12, color: "#9a9080" });
  const reason = game.over?.reason ?? "an unknown fate";
  wrapText(ctx, reason, rx, py + 28, W - rx - PAD, 16, "#e8c0b0");

  text(ctx, "Where", rx, py + 90, { size: 12, color: "#9a9080" });
  let where = "Unknown";
  try { where = game.whereAmI; } catch { /* ignore */ }
  text(ctx, where, rx, py + 108, { size: 14, color: "#e8e0d0" });

  const poolsY = py + box + 16;
  line(ctx, poolsY);

  let y = poolsY + 14;
  text(ctx, "FINAL VITALS", PAD, y, { size: 12, color: "#ffd25a", weight: "700" });
  y += 22;
  const pools = p.pools;
  const vitals = [
    `HP  ${pools?.hp ?? 0} / ${pools?.hpMax ?? 0}`,
    `Stamina  ${pools?.stamina ?? 0} / ${pools?.staminaMax ?? 0}`,
    `Mana  ${pools?.mana ?? 0} / ${pools?.manaMax ?? 0}`,
    `Armour  ${p.armour ?? 0}`,
    `Speed  ${p.speed ?? 100}`,
  ];
  for (const v of vitals) {
    text(ctx, v, PAD, y, { size: 14, color: "#e8e0d0" });
    y += 20;
  }

  y += 8;
  line(ctx, y);
  y += 14;

  text(ctx, "ATTRIBUTES", PAD, y, { size: 12, color: "#ffd25a", weight: "700" });
  y += 22;
  const colW = (W - PAD * 2) / 3;
  ATTRIBUTES.forEach((id, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const ax = PAD + col * colW;
    const ay = y + row * 22;
    const label = ATTRIBUTE_INFO[id as AttributeId]?.short ?? id;
    const val = p.attributes?.[id as AttributeId] ?? 0;
    text(ctx, `${label}  ${val}`, ax, ay, { size: 14, color: "#e8e0d0" });
  });
  y += Math.ceil(ATTRIBUTES.length / 3) * 22 + 12;
  line(ctx, y);
  y += 14;

  text(ctx, "GEAR", PAD, y, { size: 12, color: "#ffd25a", weight: "700" });
  y += 22;
  let gear: string[] = [];
  try {
    const slots = game.speciesEquipmentSlots ?? [];
    gear = slots
      .map((slot) => {
        const id = game.worn[slot];
        if (!id) return null;
        return `${slot}: ${game.displayName(id)}`;
      })
      .filter(Boolean) as string[];
  } catch {
    gear = [];
  }
  if (!gear.length) {
    text(ctx, "Empty-handed.", PAD, y, { size: 13, color: "#9a9080" });
    y += 20;
  } else {
    for (const g of gear.slice(0, 8)) {
      text(ctx, g, PAD, y, { size: 13, color: "#e8e0d0" });
      y += 18;
    }
  }

  y += 8;
  line(ctx, y);
  y += 14;

  text(ctx, "SPELLS KNOWN", PAD, y, { size: 12, color: "#ffd25a", weight: "700" });
  y += 22;
  if (!p.spells?.length) {
    text(ctx, "None.", PAD, y, { size: 13, color: "#9a9080" });
  } else {
    let names: string[] = [];
    try {
      names = p.spells.map((id) => game.spellName(id));
    } catch {
      names = [...p.spells];
    }
    wrapText(ctx, names.slice(0, 12).join(" · "), PAD, y, W - PAD * 2, 15, "#e8e0d0");
  }

  text(ctx, `TURBZHACK · ${new Date().toLocaleDateString()}`, W / 2, H - 36, {
    size: 11, color: "#6a6258", align: "center",
  });

  return c;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  color: string,
): number {
  const words = String(s).split(/\s+/);
  let line = "";
  let cy = y;
  ctx.font = `14px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      cy += lineH;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy;
}

/**
 * Save the memorial PNG into the user's Downloads folder (browser / Tauri
 * webview download path).
 *
 * Uses Blob + object URL and an <a download> attached to the document — more
 * reliable than canvas.toDataURL() alone, which many webviews ignore.
 */
export function downloadMemorial(game: Game, reg: Registry, atlas: Atlas): Promise<void> {
  const canvas = renderMemorial(game, reg, atlas);
  const filename = `TURBZHACK-${safeName(game, reg)}.png`;

  return new Promise((resolve, reject) => {
    const finish = (blob: Blob | null) => {
      if (!blob) {
        reject(new Error("Could not encode memorial PNG"));
        return;
      }
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        window.setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(url);
        }, 2000);
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => finish(blob), "image/png");
    } else {
      try {
        const data = canvas.toDataURL("image/png");
        const bin = atob(data.split(",")[1]!);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        finish(new Blob([bytes], { type: "image/png" }));
      } catch (err) {
        reject(err);
      }
    }
  });
}
