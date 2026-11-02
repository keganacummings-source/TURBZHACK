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
import { SLOTS, SLOT_NAME, describe, type Slot } from "../engine/equipment.ts";
import type { Registry } from "../content/registry.ts";

type Screen = "class-select" | "play" | "map" | "help" | "problems" | "dead" | "levelup" | "pack";

const $ = (id: string) => document.getElementById(id)!;

export async function boot(): Promise<void> {
  await markWebfont();
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
    // There is no closing a level-up: the choice has to be made.
    $("close-overlay").classList.toggle("hidden", next === "levelup");
    // Every screen that is drawn INTO the overlay has to be listed here, or the
    // markup is built and then left hidden — which looks exactly like the game
    // having frozen, because for the level-up it also stops taking input.
    if (next === "map" || next === "help" || next === "problems" || next === "dead" || next === "levelup" || next === "pack") {
      $("overlay").classList.remove("hidden");
    }
    render();
  }

  function render(): void {
    if (screen === "class-select" || !game) { renderClassSelect(reg); return; }
    if (screen === "map") { drawOverview(ctx, game, (id) => BIOME_BY_ID.get(id)?.colour ?? "#555"); renderOverlay(mapHtml()); return; }
    if (screen === "help") { renderOverlay(helpHtml()); }
    if (screen === "problems") { renderOverlay(problemsHtml(reg)); return; }
    if (screen === "levelup") { renderOverlay(levelUpHtml()); }
    if (screen === "pack") { renderOverlay(packHtml()); }
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

    const prog = game.progress;
    $("hud").innerHTML = `
      <div class="hud-row hud-where">${game.whereAmI}</div>
      <div class="hud-row hud-level">Level ${prog.level}
        <span class="dim">· might ${p.stats.might} · focus ${p.stats.focus} · hit ${p.stats.accuracy}% · dodge ${p.stats.evasion}% · armour ${p.armour}</span>
      </div>
      ${bar("XP", prog.into, prog.need, "xp")}
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
      .map((m) => `<div class="line tone-${m.tone ?? "plain"}">${escapeHtml(m.text)}${
        (m.count ?? 1) > 1 ? `<span class="rep">&times;${m.count}</span>` : ""}</div>`)
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
          <li>${(c.spells ?? []).length ? `Starts with: ${(c.spells ?? []).map((s) => reg.spells.get(s)?.name ?? s).join(", ")}` : "No spells"}</li>
          <li>Hit ${(c.stats?.accuracy ?? 85)}% · dodge ${(c.stats?.evasion ?? 0)}% · armour ${c.armour ?? 0}</li>
          <li class="dim">Everything else is learned, five choices at a time.</li>
        </ul>
      </button>`).join("");
    $("class-cards").innerHTML = cards;
    for (const el of document.querySelectorAll<HTMLElement>("[data-class]")) {
      el.onclick = () => {
        const seedInput = ($("seed") as HTMLInputElement).value.trim();
        game = new Game(reg, seedInput || Date.now());
        game.start(el.dataset.class!);
        /*
         * The run, on the window, on purpose.
         *
         * This is a game whose whole point is that you extend it, so being able
         * to open the console and read — or poke — the live state is a feature
         * rather than a leak. `window.turbz.render()` redraws after you change
         * something by hand.
         */
        (window as unknown as { turbz: unknown }).turbz = { game, reg, atlas, render };
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

  /**
   * The five.
   *
   * Shown as cards with a number key each, because at a level-up the player
   * wants to compare them at a glance, not read a list.
   */
  const levelUpHtml = () => {
    const choices = game?.pendingChoices ?? [];
    return `<h2>Level ${game?.progress.level}</h2>
      <p class="dim">Take one. Press its number, or click it.</p>
      <div class="choices">
        ${choices.map((c, i) => `
          <button class="choice choice-${c.kind}" data-choice="${i}">
            <span class="choice-key">${i + 1}</span>
            <h3>${escapeHtml(c.name)}</h3>
            <p class="choice-detail">${escapeHtml(c.detail)}</p>
            <p class="dim">${escapeHtml(c.about)}</p>
            <span class="choice-kind">${c.kind === "spell" ? "spell" : "upgrade"}</span>
          </button>`).join("")}
      </div>`;
  };

  /**
   * The pack and what is worn.
   *
   * One screen for both, because the only thing you ever want to do with an
   * item in the pack is put it on, and the only thing you want to do with what
   * is worn is take it off.
   */
  const packHtml = () => {
    if (!game) return "";
    const items = reg.items;
    const wornRows = SLOTS.map((slot) => {
      const id = game!.worn[slot];
      const item = id ? items.get(id) : undefined;
      return `<tr>
        <td class="dim">${SLOT_NAME[slot]}</td>
        <td>${item ? escapeHtml(item.name) : '<span class="dim">—</span>'}</td>
        <td class="choice-detail">${item ? escapeHtml(describe(item)) : ""}</td>
        <td>${item ? `<button data-off="${slot}">take off</button>` : ""}</td>
      </tr>`;
    }).join("");

    const packRows = game.pack.length
      ? game.pack.map((id, i) => {
          const item = items.get(id);
          if (!item) return "";
          const wearable = !!item.slot && !["potion", "scroll", "misc"].includes(item.slot);
          return `<tr>
            <td class="dim">${i + 1}</td>
            <td>${escapeHtml(item.name)}</td>
            <td class="choice-detail">${escapeHtml(describe(item))}</td>
            <td>
              ${wearable ? `<button data-wear="${id}">wear</button>` : ""}
              ${item.casts ? `<button data-use="${id}">use</button>` : ""}
              <button data-drop="${id}">drop</button>
            </td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="4" class="dim">Your pack is empty. Walk over something and press g.</td></tr>`;

    return `<h2>Gear</h2>
      <table class="pack-table">${wornRows}</table>
      <h2>Pack</h2>
      <table class="pack-table">${packRows}</table>
      <p class="dim">i or Esc closes. g picks up what you are standing on.</p>`;
  };

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

    /*
     * A pending level-up swallows everything.
     *
     * It has to come before `commandFor`, or the number keys would be read as
     * spell slots and the choice would never be made — and before the screen
     * checks, so no other overlay can be opened on top of it and strand you.
     */
    if (game?.pendingChoices) {
      /*
       * Make sure it is actually on screen.
       *
       * The command handler shows it after the key that earned it, but a level
       * can arrive from anywhere — a creature burning to death on its own turn,
       * or a script. If the choice is pending and the screen is not up, the
       * game looks frozen for no visible reason, so surface it here too.
       */
      if (screen !== "levelup") setScreen("levelup");
      const n = Number(e.key);
      if (n >= 1 && n <= game.pendingChoices.length) {
        e.preventDefault();
        game.chooseUpgrade(n - 1);
        setScreen("play");
      }
      return;
    }

    const cmd = commandFor(e);
    if (!cmd) return;
    e.preventDefault();

    if (cmd.kind === "close") { if (screen !== "play") setScreen(game ? "play" : "class-select"); return; }
    if (cmd.kind === "help") { setScreen(screen === "help" ? "play" : "help"); return; }
    if (cmd.kind === "map") { setScreen(screen === "map" ? "play" : "map"); return; }
    if (cmd.kind === "pack") { setScreen(screen === "pack" ? "play" : "pack"); return; }
    if (cmd.kind === "designer") { openDesigner(atlas, () => render()); return; }

    if (!game || screen !== "play" || game.over) return;

    switch (cmd.kind) {
      case "move": game.move(cmd.dir.dx, cmd.dir.dy); break;
      case "rest": game.rest(); break;
      case "pickup": game.pickUp(); break;
      case "ability": game.ability(cmd.id); break;
      case "spell": {
        const id = game.player.spells[cmd.slot];
        if (!id) { game.log("Nothing in that spell slot.", "warn"); break; }
        game.cast(id);
        break;
      }
    }
    if (game.over) setScreen("dead");
    else if (game.pendingChoices) setScreen("levelup");
    render();
  });

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (game) {
      const wear = t.closest<HTMLElement>("[data-wear]");
      const off = t.closest<HTMLElement>("[data-off]");
      const use = t.closest<HTMLElement>("[data-use]");
      const drop = t.closest<HTMLElement>("[data-drop]");
      if (wear) { game.wear(wear.dataset.wear!); render(); return; }
      if (off) { game.remove(off.dataset.off as Slot); render(); return; }
      if (drop) { game.drop(drop.dataset.drop!); render(); return; }
      if (use) { game.use(use.dataset.use!); setScreen("play"); return; }
    }
    const card = t.closest<HTMLElement>("[data-choice]");
    if (card && game?.pendingChoices) {
      game.chooseUpgrade(Number(card.dataset.choice));
      setScreen("play");
      return;
    }
    if (t.id === "again") { setScreen("class-select"); }
    if (t.id === "anyway") { setScreen("class-select"); }
    // Not closable while a choice is pending: dismissing it would freeze the
    // game with an unspent level and no way back to it.
    if (t.id === "close-overlay" && !game?.pendingChoices) { setScreen(game ? "play" : "class-select"); }
  });

  window.addEventListener("resize", resize);
  setScreen(screen);
  resize();
}

/**
 * Tell the stylesheet whether the webfonts actually arrived.
 *
 * VT323 is tall and narrow and needs about a third more size than a normal
 * monospace to read the same. Sizing for it when it has NOT loaded — offline,
 * or inside the .exe — makes every line enormous and wraps the log every three
 * words. The stylesheet carries both sets of sizes and this picks one.
 *
 * Never throws and never waits long: a missing font must not stop the game
 * starting, so a failure here just means the fallback sizes stay.
 */
async function markWebfont(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    // Give the CDN a moment, but not more than a moment.
    if (fonts) await Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 1200))]);

    /*
     * Measured, not asked.
     *
     * `document.fonts.check('12px "VT323"')` returns true even when the font
     * never arrived — it answers "could this be rendered", and a fallback
     * counts. With the CDN blocked it said yes and the whole UI rendered at
     * VT323's sizes in a monospace, which wraps the log every three words.
     *
     * Rendering the same string twice and comparing widths cannot be fooled:
     * if VT323 really loaded it is narrower than the generic monospace, and if
     * it did not, the two measurements are identical.
     */
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sample = "MMMMMMMMMMWWWWWWWWWWiiiiiiiiii0123456789";
    ctx.font = '40px monospace';
    const plain = ctx.measureText(sample).width;
    ctx.font = '40px "VT323", monospace';
    const vt = ctx.measureText(sample).width;

    if (Math.abs(vt - plain) > 1) document.documentElement.classList.add("webfont");
  } catch {
    // No webfont, fallback sizes, game still starts.
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
