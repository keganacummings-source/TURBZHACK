/**
 * The browser shell: canvas, keyboard, HUD, screens.
 *
 * Everything with a rule in it lives in the engine; this file only turns key
 * presses into `Game` calls and draws what comes back. It is also the only file
 * in `src/` that touches the DOM, which is what keeps the whole game testable
 * from Node.
 */
import { Game } from "../game.ts";
import { loadContent, spriteKeys } from "../content/load-web.ts";
import { newAtlas, loadSprites, TILE, type Atlas } from "../render/atlas.ts";
import { draw, drawOverview, viewFor } from "../render/draw.ts";
import { commandFor, controlsText } from "./input.ts";
import { BIOME_BY_ID } from "../world/continent.ts";
import { openDesigner } from "./designer.ts";
import type { Registry } from "../content/registry.ts";

type Screen = "class-select" | "play" | "map" | "help" | "problems" | "dead";

const $ = (id: string) => document.getElementById(id)!;

export async function boot(): Promise<void> {
  const reg = await loadContent();
  const atlas = newAtlas();
  await loadSprites(atlas, spriteKeys(reg));

  const canvas = $("screen") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  let game: Game | null = null;
  let screen: Screen = "class-select";
  let scale = 3;

  // A content error is shown before anything else: a mod that does not load is
  // the single most likely thing to go wrong, and silence would be cruel.
  if (reg.errorCount > 0) screen = "problems";

  function resize(): void {
    const box = $("stage").getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(box.width));
    canvas.height = Math.max(240, Math.floor(box.height));
    // Whole-number zoom only. A fractional scale blurs 16x16 art.
    scale = Math.max(2, Math.min(5, Math.floor(canvas.width / (TILE * 46))));
    render();
  }

  function setScreen(next: Screen): void {
    screen = next;
    for (const id of ["class-select", "overlay"]) $(id).classList.add("hidden");
    if (next === "class-select") $("class-select").classList.remove("hidden");
    if (next === "map" || next === "help" || next === "problems" || next === "dead") {
      $("overlay").classList.remove("hidden");
    }
    render();
  }

  function render(): void {
    if (screen === "class-select" || !game) { renderClassSelect(reg); return; }
    if (screen === "map") { drawOverview(ctx, game, (id) => BIOME_BY_ID.get(id)?.colour ?? "#555"); renderOverlay(mapHtml()); return; }
    if (screen === "help") { renderOverlay(helpHtml()); }
    if (screen === "problems") { renderOverlay(problemsHtml(reg)); return; }
    if (screen === "dead") { renderOverlay(deadHtml()); }

    draw(ctx, game, atlas, viewFor(game, canvas, scale));
    renderHud();
    renderLog();
  }

  // --- HUD ----------------------------------------------------------------

  function bar(label: string, now: number, max: number, cls: string): string {
    const pct = Math.max(0, Math.min(100, (now / Math.max(1, max)) * 100));
    return `<div class="bar"><span class="bar-label">${label}</span>
      <span class="bar-track"><span class="bar-fill ${cls}" style="width:${pct}%"></span></span>
      <span class="bar-num">${Math.round(now)}/${Math.round(max)}</span></div>`;
  }

  function renderHud(): void {
    if (!game) return;
    const p = game.player;
    const statuses = p.statuses.filter((s) => s.turns > 0)
      .map((s) => `<span class="pip pip-${s.id}">${reg.statuses.get(s.id)?.name ?? s.id} ${s.turns}</span>`)
      .join("");
    const spells = p.spells.map((id, i) => {
      const s = reg.spells.get(id);
      const can = s && p.pools.mana >= s.mana;
      return `<span class="slot ${can ? "" : "slot-off"}">${i + 1} ${s?.name ?? id} <em>${s?.mana ?? "?"}m</em></span>`;
    }).join("");

    $("hud").innerHTML = `
      <div class="hud-row hud-where">${game.whereAmI}</div>
      ${bar("HP", p.pools.hp, p.pools.hpMax, "hp")}
      ${bar("SP", p.pools.stamina, p.pools.staminaMax, "sp")}
      ${bar("MP", p.pools.mana, p.pools.manaMax, "mp")}
      <div class="hud-row">${statuses || '<span class="dim">no effects</span>'}</div>
      <div class="hud-row slots">
        <span class="slot">z Punch <em>free</em></span>
        <span class="slot ${p.pools.stamina >= 25 ? "" : "slot-off"}">x Kick <em>25s</em></span>
        ${spells}
      </div>
      <div class="hud-row dim">turn ${game.turn} · seed ${game.seedWord} · ? for keys · t for the designer</div>`;
  }

  function renderLog(): void {
    if (!game) return;
    const lines = game.messages.slice(-80);
    $("log").innerHTML = lines
      .map((m) => `<div class="line tone-${m.tone ?? "plain"}">${escapeHtml(m.text)}</div>`)
      .join("");
    $("log").scrollTop = $("log").scrollHeight;
  }

  // --- screens ------------------------------------------------------------

  function renderClassSelect(reg: Registry): void {
    const cards = [...reg.classes.values()].map((c) => `
      <button class="card" data-class="${c.id}">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="dim">${escapeHtml(c.blurb ?? c.about ?? "")}</p>
        <ul>
          <li>HP ${100 + (c.pools?.hp ?? 0)} · SP ${100 + (c.pools?.stamina ?? 0)} · MP ${50 + (c.pools?.mana ?? 0)}</li>
          <li>${(c.spells ?? []).length ? `Spells: ${(c.spells ?? []).map((s) => reg.spells.get(s)?.name ?? s).join(", ")}` : "No spells"}</li>
          <li>Armour ${c.armour ?? 0}</li>
        </ul>
      </button>`).join("");
    $("class-cards").innerHTML = cards;
    for (const el of document.querySelectorAll<HTMLElement>("[data-class]")) {
      el.onclick = () => {
        const seedInput = ($("seed") as HTMLInputElement).value.trim();
        game = new Game(reg, seedInput || Date.now());
        game.start(el.dataset.class!);
        setScreen("play");
        resize();
      };
    }
  }

  function renderOverlay(html: string): void {
    $("overlay-body").innerHTML = html;
  }

  const helpHtml = () => `
    <h2>Keys</h2>
    ${controlsText().map((g) => `
      <h3>${g.group}</h3>
      <table>${g.rows.map(([k, w]) => `<tr><td class="key">${escapeHtml(k)}</td><td>${escapeHtml(w)}</td></tr>`).join("")}</table>
    `).join("")}
    <p class="dim">Walk into a creature to attack it. Walk onto a dungeon mouth or a staircase to use it.</p>
    <p class="dim">Esc closes this.</p>`;

  const mapHtml = () => `<h2>${escapeHtml(game?.whereAmI ?? "")}</h2>
    <p class="dim">Only what you have seen. Red marks a dungeon you have found. Esc closes.</p>`;

  const deadHtml = () => `<h2>You died</h2>
    <p>${escapeHtml(game?.over?.reason ?? "")}</p>
    <p class="dim">Turn ${game?.turn} · seed ${game?.seedWord}</p>
    <p><button id="again">Start again</button></p>`;

  const problemsHtml = (reg: Registry) => `
    <h2>Content problems</h2>
    <p class="dim">${reg.errorCount} file(s) could not be loaded. The rest of the game still works.</p>
    <pre>${escapeHtml(reg.report().join("\n"))}</pre>
    <p><button id="anyway">Play anyway</button></p>`;

  // --- input --------------------------------------------------------------

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    if (document.body.classList.contains("designer-open")) return;

    const cmd = commandFor(e);
    if (!cmd) return;
    e.preventDefault();

    if (cmd.kind === "close") { if (screen !== "play") setScreen(game ? "play" : "class-select"); return; }
    if (cmd.kind === "help") { setScreen(screen === "help" ? "play" : "help"); return; }
    if (cmd.kind === "map") { setScreen(screen === "map" ? "play" : "map"); return; }
    if (cmd.kind === "designer") { openDesigner(atlas, () => render()); return; }

    if (!game || screen !== "play" || game.over) return;

    switch (cmd.kind) {
      case "move": game.move(cmd.dir.dx, cmd.dir.dy); break;
      case "rest": game.rest(); break;
      case "ability": game.ability(cmd.id); break;
      case "spell": {
        const id = game.player.spells[cmd.slot];
        if (!id) { game.log("Nothing in that spell slot.", "warn"); break; }
        game.cast(id);
        break;
      }
    }
    if (game.over) setScreen("dead");
    render();
  });

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "again") { setScreen("class-select"); }
    if (t.id === "anyway") { setScreen("class-select"); }
    if (t.id === "close-overlay") { setScreen(game ? "play" : "class-select"); }
  });

  window.addEventListener("resize", resize);
  setScreen(screen);
  resize();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
