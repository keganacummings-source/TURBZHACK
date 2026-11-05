import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const css = readFileSync(join(root, "src", "ui", "style.css"), "utf8");
const app = readFileSync(join(root, "src", "ui", "app.ts"), "utf8");
const village = readFileSync(join(root, "src", "ui", "village.ts"), "utf8");
const index = readFileSync(join(root, "index.html"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("the play shell lets the HUD and log scroll instead of clipping each other", () => {
  assert.match(rule("#app"), /min-height:\s*0/);
  assert.match(rule("#side"), /min-height:\s*0/);
  assert.match(rule("#hud"), /max-height:\s*72%/);
  assert.match(rule("#hud"), /overflow-y:\s*auto/);
  assert.match(rule("#log"), /min-height:\s*0/);
  assert.match(rule("#log"), /overflow:\s*auto/);
});

test("overlays and data tables constrain long content to their available width", () => {
  assert.match(rule("#overlay"), /padding:\s*clamp\(8px,\s*2vh,\s*24px\)/);
  assert.match(rule(".overlay-panel"), /min-width:\s*0/);
  assert.match(rule(".overlay-panel"), /min-height:\s*0/);
  assert.match(rule(".overlay-panel"), /overflow:\s*auto/);
  assert.match(rule(".overlay-panel"), /max-height:\s*calc\(100dvh\s*-\s*clamp\(16px,\s*4vh,\s*48px\)\)/);
  assert.match(rule("#overlay.overlay-map .overlay-panel > #overlay-body > h2:first-child"), /padding-right:\s*112px/);
  assert.match(rule(".pack-table"), /table-layout:\s*fixed/);
  assert.match(rule(".table-scroll"), /overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.overlay-panel\s*\{\s*width:\s*100%/);
});

test("inventory, crafting and market screens use responsive content layouts", () => {
  assert.match(app, /class="inventory-list"/);
  assert.match(app, /class="inventory-card/);
  assert.match(app, /class="recipe-list"/);
  assert.match(app, /class="recipe-card/);
  assert.match(village, /class="table-scroll"/);
  assert.match(rule(".inventory-list, .recipe-list"), /display:\s*grid/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.inventory-heading,\s*\.recipe-card\s*\{\s*flex-direction:\s*column/);
});

test("wheel zoom covers both canvas views, exposes reset, and does not play step sounds", () => {
  assert.match(app, /canvas\.addEventListener\("wheel"/);
  assert.match(app, /screen !== "play" && screen !== "map"/);
  assert.match(app, /stepPlayZoomOffset\(fitScale, playZoomOffset, e\.deltaY\)/);
  assert.match(app, /stepMapZoom\(mapZoom, e\.deltaY\)/);
  assert.match(app, /data-play-zoom-reset/);
  assert.match(app, /data-map-zoom-reset/);
  assert.doesNotMatch(app, /sounds\.play\("step"\)/);
  assert.match(app, /timeOfDay\(game\.turn\)/);
  assert.match(app, /drawNightOverlay\(\)/);
  assert.match(app, /\$\("quick-start"\)\.onclick/);
  assert.match(index, /id="quick-start"/);
});
