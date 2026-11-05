/**
 * The built-in texture designer.
 *
 * A 16x16 pixel editor for tiles, items, creatures and classes, opened with `t`
 * from anywhere in the game. It exists so that adding a monster is one job
 * rather than two — write the file, draw the sprite, both without leaving the
 * game.
 *
 * What it deliberately does NOT do is write to the content folder. A web page
 * cannot, and more importantly should not: it downloads a PNG named for the
 * sprite key, and you drop that into assets/tiles16/. That keeps your art in
 * your repository under your version control, which is where it belongs.
 *
 * Work in progress is kept in localStorage, so closing the tab does not lose a
 * sprite you have not exported yet.
 */
import { fallbackColour, TILE, type Atlas } from "../render/atlas.ts";

const STORE_KEY = "turbzhack.designer.v1";

/** The TURBZ palette, so new art sits beside the downscaled tiles. */
const PALETTE = [
  "transparent",
  "#16121a", "#2a2730", "#4a4552", "#6d6678", "#9b93a8", "#d3cbdd", "#ffffff",
  "#5c3a22", "#8a5a34", "#b98650", "#d6b294", "#e0c489",
  "#2f4a22", "#3f7a3a", "#6fa84f", "#9cc46a", "#c2b26a",
  "#1d3f6e", "#2f74a8", "#49a7dd", "#8fd6ff", "#dff0f4",
  "#5a1f18", "#8c3a2a", "#c9453a", "#ff8a3a", "#ffd166",
  "#3b1f5e", "#6a4cff", "#a35fa0", "#d79ad6",
];

type Doc = { key: string; px: string[] };

/** A blank 16x16 sprite. */
const blank = (): string[] => new Array(TILE * TILE).fill("transparent");

function load(): Doc {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Doc;
      if (Array.isArray(d.px) && d.px.length === TILE * TILE) return d;
    }
  } catch {
    // Private windows and blocked storage both throw. A fresh sprite is a fine
    // answer, so this never surfaces as an error.
  }
  return { key: "my-tile", px: blank() };
}

function save(doc: Doc): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch { /* not important enough to report */ }
}

let open = false;

/** Open the designer. `onClose` lets the game redraw underneath. */
export function openDesigner(atlas: Atlas, onClose: () => void): void {
  if (open) return;
  open = true;
  document.body.classList.add("designer-open");

  const doc = load();
  let colour = PALETTE[1]!;
  let painting = false;

  const root = document.createElement("div");
  root.className = "designer";
  root.innerHTML = `
    <div class="designer-panel">
      <header>
        <h2>Texture designer</h2>
        <label>Sprite key <input id="d-key" value="${escapeAttr(doc.key)}" spellcheck="false"></label>
        <button id="d-close" title="Escape">Close</button>
      </header>
      <div class="designer-body">
        <canvas id="d-grid" width="512" height="512"></canvas>
        <aside>
          <div id="d-palette" class="palette"></div>
          <div class="designer-tools">
            <button id="d-clear">Clear</button>
            <button id="d-load">Load existing</button>
            <button id="d-export">Download PNG</button>
          </div>
          <div class="preview">
            <span>Actual size</span>
            <canvas id="d-prev" width="16" height="16"></canvas>
            <canvas id="d-prev3" width="48" height="48"></canvas>
          </div>
          <p class="dim">
            Draw, name it after the <code>sprite</code> in your content file, then
            download and drop the PNG into <code>assets/tiles16/</code>.
          </p>
          <p class="dim" id="d-note"></p>
        </aside>
      </div>
    </div>`;
  document.body.appendChild(root);

  const grid = root.querySelector<HTMLCanvasElement>("#d-grid")!;
  const gx = grid.getContext("2d")!;
  const prev = root.querySelector<HTMLCanvasElement>("#d-prev")!;
  const prev3 = root.querySelector<HTMLCanvasElement>("#d-prev3")!;
  const keyInput = root.querySelector<HTMLInputElement>("#d-key")!;
  const note = root.querySelector<HTMLElement>("#d-note")!;
  const cell = grid.width / TILE;

  function paintGrid(): void {
    gx.imageSmoothingEnabled = false;
    // A checkerboard under the art, so transparent is visibly transparent
    // rather than looking like a black pixel.
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        gx.fillStyle = (x + y) % 2 ? "#232029" : "#1b1822";
        gx.fillRect(x * cell, y * cell, cell, cell);
        const c = doc.px[y * TILE + x]!;
        if (c !== "transparent") {
          gx.fillStyle = c;
          gx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
    gx.strokeStyle = "rgba(255,255,255,.07)";
    gx.lineWidth = 1;
    for (let i = 0; i <= TILE; i++) {
      gx.beginPath(); gx.moveTo(i * cell, 0); gx.lineTo(i * cell, grid.height); gx.stroke();
      gx.beginPath(); gx.moveTo(0, i * cell); gx.lineTo(grid.width, i * cell); gx.stroke();
    }
    paintPreview();
  }

  function paintPreview(): void {
    for (const [cv, scale] of [[prev, 1], [prev3, 3]] as const) {
      const c = cv.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const col = doc.px[y * TILE + x]!;
          if (col === "transparent") continue;
          c.fillStyle = col;
          c.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }

  function at(e: PointerEvent): { x: number; y: number } | null {
    const r = grid.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * TILE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * TILE);
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return null;
    return { x, y };
  }

  function put(e: PointerEvent): void {
    const p = at(e);
    if (!p) return;
    // Right-click erases, which is what every pixel editor does.
    doc.px[p.y * TILE + p.x] = e.buttons === 2 ? "transparent" : colour;
    save(doc);
    paintGrid();
  }

  grid.addEventListener("pointerdown", (e) => { painting = true; grid.setPointerCapture(e.pointerId); put(e); });
  grid.addEventListener("pointermove", (e) => { if (painting) put(e); });
  grid.addEventListener("pointerup", () => { painting = false; });
  grid.addEventListener("contextmenu", (e) => e.preventDefault());

  // --- palette ------------------------------------------------------------
  const pal = root.querySelector<HTMLElement>("#d-palette")!;
  pal.innerHTML = PALETTE.map((c, i) =>
    `<button class="swatch ${i === 1 ? "on" : ""}" data-c="${c}" style="${
      c === "transparent" ? "background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/8px 8px" : `background:${c}`
    }" title="${c}"></button>`).join("");
  pal.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".swatch");
    if (!b) return;
    colour = b.dataset.c!;
    for (const s of pal.querySelectorAll(".swatch")) s.classList.remove("on");
    b.classList.add("on");
  });

  // --- tools --------------------------------------------------------------
  keyInput.addEventListener("input", () => { doc.key = keyInput.value.trim() || "my-tile"; save(doc); });

  root.querySelector("#d-clear")!.addEventListener("click", () => {
    doc.px = blank();
    save(doc);
    paintGrid();
  });

  /**
   * Load the sprite that is already in the atlas, so an existing tile can be
   * tweaked rather than redrawn. Reads the pixels back off a canvas.
   */
  root.querySelector("#d-load")!.addEventListener("click", () => {
    const img = atlas.images.get(doc.key);
    if (!img) {
      note.textContent = `No sprite called "${doc.key}" is loaded. Draw it from scratch, or check the name.`;
      return;
    }
    const tmp = document.createElement("canvas");
    tmp.width = TILE; tmp.height = TILE;
    const t = tmp.getContext("2d")!;
    t.imageSmoothingEnabled = false;
    t.drawImage(img, 0, 0, TILE, TILE);
    const data = t.getImageData(0, 0, TILE, TILE).data;
    for (let i = 0; i < TILE * TILE; i++) {
      const a = data[i * 4 + 3]!;
      doc.px[i] = a < 16
        ? "transparent"
        : `#${[data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
    save(doc);
    paintGrid();
    note.textContent = `Loaded "${doc.key}".`;
  });

  root.querySelector("#d-export")!.addEventListener("click", () => {
    const out = document.createElement("canvas");
    out.width = TILE; out.height = TILE;
    const o = out.getContext("2d")!;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const c = doc.px[y * TILE + x]!;
        if (c === "transparent") continue;
        o.fillStyle = c;
        o.fillRect(x, y, 1, 1);
      }
    }
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.key}.png`;
      a.click();
      URL.revokeObjectURL(url);
      note.textContent = `Saved ${doc.key}.png — put it in assets/tiles16/ and reload.`;
    }, "image/png");
  });

  function close(): void {
    open = false;
    document.body.classList.remove("designer-open");
    root.remove();
    window.removeEventListener("keydown", onKey, true);
    onClose();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }
  root.querySelector("#d-close")!.addEventListener("click", close);
  window.addEventListener("keydown", onKey, true);

  // Seed the fallback colour as a hint when starting a brand new sprite.
  note.textContent = atlas.images.has(doc.key)
    ? `"${doc.key}" already exists — Load existing to edit it.`
    : `"${doc.key}" has no art yet; the game is showing ${fallbackColour(doc.key)} for it.`;
  paintGrid();
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
