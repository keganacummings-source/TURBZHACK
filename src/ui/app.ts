/**
 * The browser shell: canvas, keyboard, HUD, screens.
 *
 * Everything with a rule in it lives in the engine; this file only turns key
 * presses into `Game` calls and draws what comes back. It is also the only file
 * in `src/` that touches the DOM, which is what keeps the whole game testable
 * from Node.
 */
import { Game } from "../game.ts";
import { createQuickStart } from "../game/quickstart.ts";
import { loadContent, spriteKeys } from "../content/load-web.ts";
import { newAtlas, loadSprites, TILE, type Atlas } from "../render/atlas.ts";
import { draw, drawWorldMap, viewFor } from "../render/draw.ts";
import { mapData, mapSidebarHtml, DEFAULT_MAP_FILTERS, type MapFilters } from "./worldmap.ts";
import {
  actionFor, clearBindings, commandFor, isBindable, keyToken, loadBindings,
  movementHint, rebind, saveBindings, unbind, type Bindings,
} from "./input.ts";
import { menuHtml, controlsHtml, savesHtml } from "./menu.ts";
import { indexWiki, wikiHtml, type WikiSection } from "./wiki.ts";
import { menuAt, type ContextMenu } from "./context.ts";
import { marketHtml, questsHtml, talkHtml } from "./village.ts";
import { ATTRIBUTES, ATTRIBUTE_BASE, ATTRIBUTE_INFO, derive, explainPoint, mod, type AttributeId, type Attributes } from "../engine/attributes.ts";
import { WEAPON_CLASS } from "../engine/weapons.ts";
import { bondWord as companionBond, hunger as companionHunger, stateOf as companionState } from "../engine/companions.ts";
import { newMotion, noteMoves, noteShot, moving } from "../render/motion.ts";
import { SoundEffects } from "../render/sfx.ts";
import { downloadMemorial } from "../render/memorial.ts";
import { AUTOSAVE_EVERY, AUTOSAVE_SLOT, deleteSlot, mostRecentSave, readSlot, writeSlot } from "../engine/save.ts";
import { loadGame } from "../game.ts";
import { BIOME_BY_ID } from "../world/continent.ts";
import { DUNGEON_FLOORS } from "../world/dungeon.ts";
import { xpForLevel } from "../engine/progress.ts";
import { timeOfDay } from "../engine/time.ts";
import { PLAY_MAX_ZOOM, PLAY_MIN_ZOOM, stepMapZoom, stepPlayZoomOffset } from "../render/zoom.ts";
import { openDesigner } from "./designer.ts";
import { SLOTS, describe, slotLabel, slotsFor, type Slot } from "../engine/equipment.ts";
import { FORMS } from "../engine/forms.ts";
import type { Registry } from "../content/registry.ts";

type Screen =
  | "class-select" | "play" | "map" | "help" | "problems" | "dead" | "levelup"
  | "pack" | "menu" | "controls" | "save" | "load" | "wiki" | "craft" | "sheet" | "spellbook" | "forms"
  | "market" | "talk" | "quests";

/** Screens drawn into the overlay panel rather than onto the canvas. */
const OVERLAY_SCREENS: Screen[] = [
  "map", "help", "problems", "dead", "levelup", "pack",
  "menu", "controls", "save", "load", "wiki", "craft", "sheet", "spellbook", "forms",
  "market", "talk", "quests",
];

/** Live search text for the spellbook filter. */
let spellbookQuery = "";

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
  let fitScale = 3;
  let playZoomOffset = 0;
  let mapZoom = 1;

  /** Keys, as the player has them. */
  let bindings: Bindings = loadBindings();
  /** The action waiting to be given a key on the controls screen. */
  let listening: string | null = null;

  /** Slides between tiles. Presentation only; the rules never consult it. */
  let motion = newMotion();
  let motionGame: Game | null = null;
  const sounds = new SoundEffects();
  let frameQueued = false;

  /** The right-click menu, and where it was opened. */
  let context: { menu: ContextMenu; x: number; y: number; sx: number; sy: number } | null = null;

  /** Wiki state, kept across openings so it reopens where you left it. */
  let wikiSection: WikiSection = "enemies";
  let wikiQuery = "";
  let wikiOpen: string | null = null;

  /** Where to go back to when a sub-screen is closed. */
  let menuReturn: Screen = "play";

  /** The item (handle or base id) whose full stats are open on the pack screen. */
  let packDetail: string | null = null;
  /** Filter chip on the pack screen: all / gear / use / mats / other. */
  let packFilter: "all" | "gear" | "use" | "mats" | "other" = "all";
  /** Free-text filter for the pack list. */
  let packQuery = "";
  /** Sort mode for the pack list. */
  let packSort: "name" | "type" | "value" = "name";
  /** Prevent double auto-download of the death memorial. */
  let memorialSavedForDeath = false;
  /** Skip rewriting HUD/log/context when the markup has not changed (stops button flicker). */
  let lastHudHtml = "";
  let lastLogHtml = "";
  let lastContextKey = "";

  /** What the world map is currently showing. */
  let mapFilters: MapFilters = { ...DEFAULT_MAP_FILTERS };

  /**
   * Save the run to the autosave slot.
   *
   * Handed to every game via `onAutosave`, because the engine must not touch
   * browser storage itself. A failed write is logged rather than thrown — an
   * autosave that cannot be written should not take the run down with it.
   */
  function autosave(g: Game): void {
    const res = writeSlot(AUTOSAVE_SLOT, g.toSave());
    g.log(res.ok ? "The game saves itself." : res.message, res.ok ? "plain" : "warn");
  }

  /** Travel ticks while this is running. */
  let travelTimer: number | null = null;

  /** Which village's market is open, and which villager is being talked to. */
  let openMarket: number | null = null;
  let openTalk: string | null = null;

  // A content error is shown before anything else: a mod that does not load is
  // the single most likely thing to go wrong, and silence would be cruel.
  if (reg.errorCount > 0) screen = "problems";

  function resize(): void {
    const box = $("stage").getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(box.width));
    canvas.height = Math.max(240, Math.floor(box.height));
    // Whole-number zoom only. A fractional scale blurs 16x16 art.
    fitScale = Math.max(2, Math.min(5, Math.floor(canvas.width / (TILE * 46))));
    scale = Math.max(PLAY_MIN_ZOOM, Math.min(PLAY_MAX_ZOOM, fitScale + playZoomOffset));
    render();
  }

  function setScreen(next: Screen): void {
    if (next !== screen) {
      lastHudHtml = "";
      lastLogHtml = "";
      // Keep context key if the menu is still open on the same screen.
      if (next !== "play") lastContextKey = "";
    }
    screen = next;
    for (const id of ["class-select", "overlay"]) $(id).classList.add("hidden");
    if (next === "class-select") $("class-select").classList.remove("hidden");
    // There is no closing a level-up: the choice has to be made.
    $("close-overlay").classList.toggle("hidden", next === "levelup");
    // The map docks its panel to one side instead of covering the whole screen,
    // so the map behind it stays visible.
    $("overlay").classList.toggle("overlay-map", next === "map");
    // Every screen that is drawn INTO the overlay has to be listed here, or the
    // markup is built and then left hidden — which looks exactly like the game
    // having frozen, because for the level-up it also stops taking input.
    if (OVERLAY_SCREENS.includes(next)) $("overlay").classList.remove("hidden");
    render();
  }

  function render(): void {
    if (screen === "problems") { renderOverlay(problemsHtml(reg)); return; }
    // The menu screens work with or without a run, so they come before the
    // "no game yet" branch — otherwise Load would be unreachable from the title.
    if (screen === "menu") { renderOverlay(menuHtml(!!game && !game.over)); return; }
    if (screen === "controls") { renderOverlay(controlsHtml(bindings, listening)); return; }
    if (screen === "save") { renderOverlay(savesHtml("save", !!game && !game.over)); return; }
    if (screen === "load") { renderOverlay(savesHtml("load", !!game)); return; }
    if (screen === "wiki") {
      renderOverlay(wikiHtml(reg, indexWiki(reg, game ?? undefined), wikiSection, wikiQuery, wikiOpen, game ?? undefined));
      restoreWikiFocus();
      return;
    }

    if (screen === "class-select" || !game) { renderClassSelect(reg); return; }
    if (motionGame !== game) {
      motion = newMotion();
      motionGame = game;
    }
    if (screen === "map") {
      const biomeColour = (id: string) => BIOME_BY_ID.get(id)?.colour ?? "#555";
      drawWorldMap(ctx, game, biomeColour, { ...mapData(game, reg, mapFilters), zoom: mapZoom });
      drawNightOverlay();
      renderOverlay(mapSidebarHtml(game, reg, mapFilters, mapZoom));
      wireMapControls();
      return;
    }
    if (screen === "help") { renderOverlay(controlsHtml(bindings, listening)); }
    if (screen === "levelup") { renderOverlay(levelUpHtml()); }
    if (screen === "pack") {
      renderOverlay(packHtml());
      const box = document.getElementById("pack-search") as HTMLInputElement | null;
      box?.addEventListener("input", () => {
        packQuery = box.value;
        render();
        const again = document.getElementById("pack-search") as HTMLInputElement | null;
        if (again) {
          again.focus();
          const len = again.value.length;
          again.setSelectionRange(len, len);
        }
      });
    }
    if (screen === "craft") { renderOverlay(craftHtml()); }
    if (screen === "sheet") { renderOverlay(sheetHtml()); }
    if (screen === "spellbook") { renderOverlay(spellbookHtml()); wireSpellbook(); }
    if (screen === "forms") { renderOverlay(formsHtml()); }
    if (screen === "quests") { renderOverlay(questsHtml(game)); }
    if (screen === "market") { renderOverlay(openMarket !== null ? marketHtml(game, openMarket) : ""); }
    if (screen === "talk") {
      const who = openTalk ? game.actors.find((a) => a.id === openTalk) : undefined;
      renderOverlay(who ? talkHtml(game, who) : "");
    }
    if (screen === "dead") {
      renderOverlay(deadHtml());
      if (game && !memorialSavedForDeath) {
        memorialSavedForDeath = true;
        void downloadMemorial(game, reg, atlas).then(() => {
          const st = document.getElementById("memorial-status");
          if (st) st.textContent = "Memorial PNG saved to your Downloads folder.";
        }).catch((err) => {
          console.warn("Memorial PNG failed", err);
          const st = document.getElementById("memorial-status");
          if (st) st.textContent = "Could not auto-save the memorial — use the button below.";
        });
      }
    }

    // Canvas paint is every frame during slides; DOM (HUD / log / menus) only
    // when the text actually changes — rewriting buttons every frame is what
    // made hover flicker and clicks miss during combat.
    paintCanvas();
    if (screen === "play" || screen === "dead") {
      renderHud();
      renderLog();
    }
    renderContext();
    if (screen === "play" && !game.over && moving(motion)) queueFrame();
    else if (screen === "play" && !game.over && shimmerInView()) scheduleShimmer();
  }

  /** Draw the map only — never touches the DOM. */
  function paintCanvas(): void {
    if (!game) return;
    const now = performance.now();
    for (const event of noteMoves(motion, game.actors, now)) {
      if (event.kind === "step") continue;
      if (event.kind === "hurt") {
        sounds.play("hurt");
      } else if (game.level.inBounds(event.x, event.y) && game.level.visible[game.level.idx(event.x, event.y)]) {
        sounds.play("hit");
      }
    }
    noteShot(motion, game.lastShot, now);
    draw(ctx, game, atlas, viewFor(game, canvas, scale, motion, now), motion, now);
    drawNightOverlay();
  }

  function drawNightOverlay(): void {
    if (!game || timeOfDay(game.turn).phase !== "night") return;
    ctx.fillStyle = "rgba(10, 14, 38, .32)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Ask for another frame, at most one at a time.
   *
   * Without the guard every slide would schedule a frame per call and the
   * callbacks would pile up geometrically — the classic way an animation loop
   * ends up running sixty copies of itself.
   */
  function queueFrame(): void {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      // Animation frames only repaint the canvas. A full render() would rebuild
      // the HUD and context menu ~60 times a second and eat mouse events.
      if (!game || game.over || screen !== "play") return;
      paintCanvas();
      if (moving(motion)) queueFrame();
      else if (shimmerInView()) scheduleShimmer();
    });
  }

  /** Is any enchanted item lying within the current view? */
  function shimmerInView(): boolean {
    if (!game || screen !== "play") return false;
    const view = viewFor(game, canvas, scale, motion, performance.now());
    for (let ry = 0; ry < view.rows + 1; ry++) {
      for (let rx = 0; rx < view.cols + 1; rx++) {
        const tx = view.camX + rx, ty = view.camY + ry;
        if (!game.level.inBounds(tx, ty) || !game.level.visible[game.level.idx(tx, ty)]) continue;
        const here = game.lootAt(tx, ty);
        if (here.length && game.itemLook(here[0]!).shimmer > 0) return true;
      }
    }
    return false;
  }

  /** A gentle repaint for the shimmer, at most one in flight. */
  let shimmerQueued = false;
  function scheduleShimmer(): void {
    if (shimmerQueued) return;
    shimmerQueued = true;
    setTimeout(() => {
      shimmerQueued = false;
      if (screen === "play" && game && !game.over) {
        paintCanvas();
        if (shimmerInView()) scheduleShimmer();
      }
    }, 90);
  }

  /**
   * Put the cursor back in the wiki search box after a redraw.
   *
   * The screen is rebuilt from a string on every keystroke, which throws away
   * the live input element and with it the focus and the caret. Re-focusing and
   * re-placing the caret at the end is what makes typing in it feel like typing.
   */
  /** Attach the map's creature picker, rebuilt with the panel on every render. */
  function wireMapControls(): void {
    const sel = document.getElementById("map-creature") as HTMLSelectElement | null;
    if (sel) sel.onchange = () => { mapFilters = { ...mapFilters, creature: sel.value || null }; render(); };
  }

  function restoreWikiFocus(): void {
    const box = document.getElementById("wiki-search") as HTMLInputElement | null;
    if (!box) return;
    if (document.activeElement === box) return;
    if (!wikiQuery) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
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
    const g = game;
    const p = g.player;
    const statuses = p.statuses.filter((s) => s.turns > 0)
      .map((s) => `<span class="pip pip-${s.id}">${reg.statuses.get(s.id)?.name ?? s.id} ${s.turns}</span>`)
      .join("");
    const spells = g.equippedSpells.map((id, i) => {
      if (!id) return `<span class="slot slot-off">${i + 1} —</span>`;
      const s = reg.spells.get(id);
      const can = s && p.pools.mana >= s.mana;
      const name = g.spellName(id);
      return `<span class="slot ${can ? "" : "slot-off"}">${i + 1} ${escapeHtml(name)} <em>${s?.mana ?? "?"}m</em></span>`;
    }).join("");

    const prog = game.progress;
    const companions = game.actors.filter((a) => a.alive && a.data["companion"]);
    /*
     * The party panel: each companion with a health bar and how it feels about
     * you. A pet that follows you into a fight needs to be legible at a glance —
     * is it hurt, is it hungry, is it about to leave — without opening a screen.
     */
    const party = companions.length
      ? `<div class="party">
          <div class="party-head">Companions</div>
          ${companions.map((c) => {
            const st = companionState(c, game!.turn);
            const frac = c.pools.hp / Math.max(1, c.pools.hpMax);
            const band = frac > 0.5 ? "hp-ok" : frac > 0.25 ? "hp-low" : "hp-crit";
            const word = companionBond(st.bond);
            const bondCls = "bond-" + word.replace(/[^a-z]+/g, "-");
            const hungry = companionHunger(c, game!.turn) > 0.5
              ? ` <span class="pet-flag">hungry</span>` : "";
            return `<div class="pet">
              <span class="pet-name">${escapeHtml(c.name.split(" ")[0] ?? c.name)}<em>L${st.level}</em></span>
              <span class="pet-bar"><span class="pet-fill ${band}" style="width:${Math.round(frac * 100)}%"></span></span>
              <span class="pet-bond ${bondCls}">${escapeHtml(word)}</span>${hungry}
            </div>`;
          }).join("")}
        </div>`
      : "";
    const here = game.place.kind === "overworld" ? game.villageHere : null;
    const lines = game.questLines();
    const openQuests = lines.filter((l) => !l.done).length;
    const doneQuests = lines.filter((l) => l.done).length;
    const coinLine = `<span class="coin">${game.coin} coin</span>`
      + (here ? ` · <span class="dim">${escapeHtml(here.village.name)} — press s to trade</span>` : "")
      + (openQuests || doneQuests
          ? ` · <span class="dim">${openQuests} job${openQuests === 1 ? "" : "s"}${
              doneQuests ? `, ${doneQuests} ready` : ""} (press q)</span>`
          : "");
    const trades = { ...game.skills, ...game.crafts };
    const learned = Object.entries(trades).filter(([, v]) => v > 0);
    const skills = learned.length
      ? learned.map(([k, v]) => `${k} ${v}`).join(" · ")
      : "no trades yet — right-click a tree or an ore vein";

    const weaponNow = game.weaponAbility;
    const time = timeOfDay(game.turn);
    const restReady = game.canLongRest;
    const restStatus = restReady
      ? "Rest ready"
      : `Rest in ${game.longRestTurnsRemaining} turn${game.longRestTurnsRemaining === 1 ? "" : "s"}`;
    const activeForm = game.activeForm
      ? `${FORMS.find((form) => form.id === game!.activeForm!.id)?.name ?? game.activeForm.id} (${Math.max(0, game.activeForm.expiresAt - game.turn)})`
      : "Transform";
    const hudHtml = `
      <div class="hud-row hud-where">${game.whereAmI}</div>
      <div class="hud-row hud-level">Level ${prog.level}
        <span class="dim">· might ${p.stats.might} · focus ${p.stats.focus} · hit ${p.stats.accuracy}% · dodge ${p.stats.evasion}% · armour ${p.armour}</span>
      </div>
      ${bar("XP", prog.into, prog.need, "xp")}
      ${bar("HP", p.pools.hp, p.pools.hpMax, "hp")}
      ${bar("SP", p.pools.stamina, p.pools.staminaMax, "sp")}
      ${bar("MP", p.pools.mana, p.pools.manaMax, "mp")}
      <div class="hud-row hud-time">${time.phase === "day" ? "Day" : "Night"} ${time.turnInPhase}/100
        <button type="button" data-long-rest ${restReady ? "" : "disabled"} title="Restore HP, stamina and mana; available once every 100 turns">
          Rest (r)
        </button>
        <span class="dim">${restStatus}</span>
        <button type="button" data-open-forms title="Choose a temporary combat form">Form (v): ${escapeHtml(activeForm)}</button>
      </div>
      <div class="hud-row">${statuses || '<span class="dim">no effects</span>'}</div>
      <div class="hud-row slots">
        <span class="slot ${(weaponNow.stamina ?? 0) <= p.pools.stamina ? "" : "slot-off"}">z ${escapeHtml(weaponNow.stamina ? (weaponNow.name ?? "Swing") : "Punch")} <em>${weaponNow.stamina ? `${weaponNow.stamina}s` : "free"}</em></span>
        <span class="slot ${p.pools.stamina >= 25 ? "" : "slot-off"}">x Kick <em>25s</em></span>
        ${spells}
      </div>
      ${party}
      <div class="hud-row dim">${skills}</div>
      <div class="hud-row">${coinLine}</div>
      <div class="hud-row dim">turn ${game.turn} · seed ${game.seedWord} · Zoom ${scale}× (${PLAY_MIN_ZOOM}–${PLAY_MAX_ZOOM}×)
        <button type="button" data-play-zoom-reset ${playZoomOffset ? "" : "disabled"}>Reset zoom</button>
        · Esc for the menu · right-click anything
        <button type="button" data-sound-toggle aria-pressed="${sounds.enabled}">
          Sound: ${sounds.enabled ? "on" : "off"}
        </button>
      </div>`;
    if (hudHtml === lastHudHtml) return;
    lastHudHtml = hudHtml;
    $("hud").innerHTML = hudHtml;
  }

  // --- the right-click menu -----------------------------------------------

  /**
   * Draw the context menu, or take it off screen.
   *
   * It is a floating panel rather than a canvas drawing so the entries are real
   * buttons: they can be read by a screen reader, clicked with a finger, and
   * styled with the rest of the UI instead of being hand-drawn text.
   */
  function renderContext(): void {
    const host = $("context");
    if (!context) {
      if (lastContextKey !== "") {
        lastContextKey = "";
        host.classList.add("hidden");
        host.innerHTML = "";
      }
      return;
    }
    const { menu, sx, sy } = context;
    // Key includes position + title + action labels so we only rebuild when the
    // menu actually changes — not on every combat animation frame.
    const key = `${sx},${sy}|${menu.title}|${menu.actions.map((a) => a.label).join(";")}`;
    if (key === lastContextKey) return;
    lastContextKey = key;

    host.innerHTML = `
      <div class="ctx-head">
        ${menu.sprite ? `<img src="assets/tiles16/${escapeAttr(menu.sprite)}.png" alt="" width="32" height="32">` : ""}
        <div>
          <h3>${escapeHtml(menu.title)}</h3>
          ${menu.about ? `<p class="dim">${escapeHtml(menu.about)}</p>` : ""}
        </div>
        <button class="ctx-close" data-ctx-close="1" title="Close">×</button>
      </div>
      ${menu.facts.length ? `<table class="ctx-facts">${menu.facts.map(([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>` : ""}
      <div class="ctx-actions">
        ${menu.actions.map((a, i) => `
          <button class="ctx-action" data-ctx="${i}">
            <span>${escapeHtml(a.label)}</span>
            ${a.detail ? `<em>${escapeHtml(a.detail)}</em>` : ""}
          </button>`).join("")}
      </div>`;
    host.classList.remove("hidden");

    // Keep it on screen: a menu opened near the right or bottom edge would
    // otherwise run off, and the entries at the end would be unreachable.
    host.style.left = "0px";
    host.style.top = "0px";
    const box = host.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - box.width - 4, sx + 8));
    const top = Math.max(4, Math.min(window.innerHeight - box.height - 4, sy + 8));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function closeContext(): void {
    if (!context) return;
    context = null;
    renderContext();
  }

  /** Which tile a mouse event landed on. */
  function tileAt(e: MouseEvent): { x: number; y: number } | null {
    if (!game) return null;
    const box = canvas.getBoundingClientRect();
    const view = viewFor(game, canvas, scale, motion, performance.now());
    const size = TILE * view.scale;
    const x = view.camX + Math.floor((e.clientX - box.left + view.offX) / size);
    const y = view.camY + Math.floor((e.clientY - box.top + view.offY) / size);
    return game.level.inBounds(x, y) ? { x, y } : null;
  }

  /** Carry out one entry from the context menu. */
  function runContext(index: number): void {
    if (!game || !context) return;
    const action = context.menu.actions[index];
    if (!action) return;
    const g = game;
    closeContext();
    stopTravel();

    switch (action.kind) {
      case "look": break;
      case "wiki": {
        wikiOpen = action.topic;
        wikiQuery = "";
        wikiSection = action.topic.split("/")[0] as WikiSection;
        menuReturn = "play";
        setScreen("wiki");
        return;
      }
      case "walk": {
        if (g.travelTo(action.x, action.y)) startTravel();
        break;
      }
      case "attack": {
        const target = g.actors.find((a) => a.id === action.target);
        g.ability(action.id, target);
        break;
      }
      case "cast": {
        const target = g.actors.find((a) => a.id === action.target);
        const turn = g.turn;
        g.cast(action.id, target);
        if (g.turn > turn) sounds.play("cast");
        break;
      }
      case "talk": {
        const target = g.actors.find((a) => a.id === action.target);
        if (!target) break;
        // A villager opens a conversation screen; a wandering creature just says
        // its line into the log, because there is nothing to negotiate with it.
        if (target.data["npc"]) { openTalk = target.id; setScreen("talk"); return; }
        g.talk(target);
        break;
      }
      case "market": {
        openMarket = action.village;
        setScreen("market");
        return;
      }
      case "handin": {
        const target = g.actors.find((a) => a.id === action.target);
        if (target) g.handIn(target);
        break;
      }
      case "tame": {
        const target = g.actors.find((a) => a.id === action.target);
        if (target) g.tame(target);
        break;
      }
      case "feed": {
        const target = g.actors.find((a) => a.id === action.target);
        // Feed it the least valuable food first — nobody feeds a pet their
        // emberfruit when there is dried meat in the pack.
        const food = g.pack
          .filter((id) => { const sl = reg.items.get(id)?.slot; return sl === "food" || sl === "material"; })
          .sort((x, y) => (reg.items.get(x)?.value ?? 0) - (reg.items.get(y)?.value ?? 0))[0];
        if (target && food) g.feedCompanion(target, food);
        break;
      }
      case "harvest": g.harvest(action.x, action.y); break;
      case "pickup": g.pickUp(); break;
      case "enter": g.rest(); break;     // stepping on it already triggered it
      case "wait": g.rest(); break;
    }
    afterCommand();
  }

  // --- walking somewhere ----------------------------------------------------

  /**
   * Walk a route, one turn at a time, on a timer.
   *
   * A timer rather than a loop, because each step is a real turn: the world
   * moves, something can come into view, and the whole journey has to be
   * abandonable. The interval is a little longer than a slide so the steps read
   * as walking rather than teleporting.
   */
  function startTravel(): void {
    stopTravel(false);
    // First step right away so the click feels like a command, not a delay.
    if (!game || !game.stepTravel()) {
      afterCommand();
      return;
    }
    afterCommand(false);
    travelTimer = window.setInterval(() => {
      if (!game || !game.stepTravel()) { stopTravel(false); }
      afterCommand(false);
    }, 130);
  }

  /** @param clearPath when false, keeps the path (used when starting a new route). */
  function stopTravel(clearPath = true): void {
    if (travelTimer !== null) { clearInterval(travelTimer); travelTimer = null; }
    if (clearPath) game?.travelPath.splice(0);
  }

  /** The bookkeeping every command shares: screens that demand attention, then a redraw. */
  function afterCommand(redraw = true): void {
    if (!game) return;
    if (game.over) { stopTravel(); setScreen("dead"); return; }
    if (game.pendingChoices) { stopTravel(); setScreen("levelup"); return; }
    if (redraw) render(); else queueFrame();
  }

  // --- crafting -------------------------------------------------------------

  const craftHtml = () => {
    if (!game) return "";
    const stations = game.stationsInReach;
    const rows = game.recipesHere();
    const groups = ["smithing", "woodwork", "alchemy", "cooking"];
    const mats = [...new Set(game.pack)]
      .filter((id) => reg.items.get(id)?.slot === "material" || reg.items.get(id)?.slot === "food")
      .map((id) => `${reg.items.get(id)?.name ?? id} ×${game!.countOf(id)}`);

    return `<h2>Crafting</h2>
      <div class="craft-summary">
        <p class="dim">${stations.size
          ? `At: ${[...stations].join(", ")}.`
          : "You are not at a station. Find a camp — a fire, a forge and a bench."}</p>
        <p class="dim">Trades: ${Object.entries(game.crafts).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
        <p class="dim">${mats.length ? `Materials: ${escapeHtml(mats.join(", "))}` : "You are carrying no materials."}</p>
      </div>
      ${groups.map((g) => {
        const mine = rows.filter((r) => r.craft === g);
        if (!mine.length) return "";
        return `<section class="craft-group">
          <h3>${g}</h3>
          <div class="recipe-list">${mine.map((r) => `<article class="recipe-card ${r.can ? "recipe-ready" : ""}">
            <div class="recipe-copy">
              <strong class="recipe-name">${escapeHtml(r.name)}</strong>${
                r.forge && r.material ? ` <span class="dim">(${escapeHtml(r.material)})</span>` : ""}
              <p class="recipe-why ${r.can ? "dim" : "choice-detail"}">${escapeHtml(r.why)}</p>
            </div>
            <div class="recipe-actions">
              ${r.can ? `<button data-craft="${escapeAttr(r.id)}">make</button>` : ""}
              <button data-wiki-jump="recipes/${escapeAttr(r.id)}">recipe info</button>
            </div>
          </article>`).join("")}</div>
        </section>`;
      }).join("")}
      ${reforgeBlock()}
      <p class="dim">Esc closes.</p>`;
  };

  /**
   * Reforging: a gamble on something you already own.
   *
   * Only offered at a forge or a bench, and only for the equipment you are
   * carrying, since there is no point reforging a potion. The cost and the risk
   * are both stated, because a reforge that could come out worse is only a fair
   * bet if the player knows that going in.
   */
  const reforgeBlock = () => {
    if (!game) return "";
    if (!game.stationsInReach.has("forge") && !game.stationsInReach.has("bench")) return "";
    const gear = [...new Set(game.pack)].filter((id) => {
      const slot = game!.itemDef(id)?.slot;
      return slot && !["potion", "scroll", "misc", "material", "food"].includes(slot);
    });
    if (!gear.length) return "";
    const haveIngot = game.countOf("iron-ingot") > 0;
    return `<h3>Reforge</h3>
      <p class="dim">Costs an iron ingot and may come out worse. For something already worth the gamble.</p>
      <div class="recipe-list">${gear.map((id) => {
        const inst = game!.instanceOf(id);
        return `<article class="recipe-card">
          <div class="recipe-copy">
            <strong class="recipe-name">${escapeHtml(game!.displayName(id))}</strong>
            <p class="recipe-why dim">${inst?.quality ? escapeHtml(inst.quality) : "Plain quality"}</p>
          </div>
          <div class="recipe-actions">${haveIngot
            ? `<button data-reforge="${escapeAttr(id)}">reforge</button>`
            : `<span class="dim">Need an iron ingot</span>`}</div>
        </article>`;
      }).join("")}</div>`;
  };

  /**
   * The character sheet.
   *
   * Where the attributes live, what each one is currently worth, and what one
   * more point would do — computed from the same `derive` the game uses, so the
   * sheet cannot drift from the rules the way a hand-written description would.
   */
  const sheetHtml = () => {
    if (!game) return "";
    const p = game.player;
    const d = p.derived;
    const regenPerTurn = Math.max(0, d.regen + game.perks.regen);
    const regenDelay = Math.max(0, d.regenDelay + game.perks.regenDelay);
    const held = game.heldClass;
    const weapon = game.weaponAbility;
    const level = game.progress.level;

    const rows = ATTRIBUTES.map((id) => {
      const info = ATTRIBUTE_INFO[id];
      const can = game!.attributePoints > 0;
      return `<tr>
        <td class="attr-label"><span>${info.short} · ${escapeHtml(info.name)}</span></td>
        <td class="attr-value">${p.attributes[id]} <span class="attr-mod">(${mod(p.attributes[id]) >= 0 ? "+" : ""}${mod(p.attributes[id])})</span></td>
        <td class="attr-action">${can ? `<button data-raise="${id}">+1</button>` : ""}</td>
      </tr><tr class="attr-detail-row">
        <td colspan="3"><span class="choice-detail">${p.attributes[id] !== p.baseAttributes[id]
          ? `Base ${p.baseAttributes[id]} + gear ${p.attributes[id] - p.baseAttributes[id]}`
          : "No gear modifier"} · ${escapeHtml(explainPoint(p.baseAttributes, id))}</span></td>
      </tr>`;
    }).join("");

    const practice = Object.entries(game.weaponSkills)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cls, v]) => `${WEAPON_CLASS[cls as keyof typeof WEAPON_CLASS]?.name ?? cls} ${v}`);
    const equipment = game.speciesEquipmentSlots.map((slot) => {
      const itemId = game!.worn[slot];
      return `<tr><td>${escapeHtml(slotLabel(slot, game!.speciesId))}</td><td>${
        itemId
          ? `<strong>${escapeHtml(game!.displayName(itemId))}${game!.isSlotMelded(slot) ? " · melded" : ""}</strong><div class="dim">${escapeHtml(game!.describeItem(itemId))}</div>`
          : `<span class="dim">empty</span>`
      }</td></tr>`;
    }).join("");
    const resistances = Object.entries(p.resist).sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, multiplier]) => {
        const label = multiplier === 0 ? "immune"
          : multiplier < 1 ? `${Math.round((1 - multiplier) * 100)}% less damage`
          : multiplier > 1 ? `${Math.round((multiplier - 1) * 100)}% more damage taken`
          : "normal damage";
        return `<tr><td>${escapeHtml(kind)}</td><td>${label}</td></tr>`;
      }).join("");
    const spells = p.spells.map((id) => {
      const spell = reg.spells.get(id);
      return `<li><strong>${escapeHtml(spell?.name ?? id)}</strong>${
        spell?.about ? ` — ${escapeHtml(spell.about)}` : ""
      } <span class="dim">(${spell?.mana ?? 0} mana, ${spell?.damage ?? 0} ${escapeHtml(spell?.kind ?? "damage")})</span></li>`;
    }).join("");
    const abilities = game.playerAbilities.map((id) => {
      const ability = reg.abilities.get(id);
      return `<li><strong>${escapeHtml(ability?.name ?? id)}</strong>${
        ability?.about ? ` — ${escapeHtml(ability.about)}` : ""
      } <span class="dim">(${ability?.damage ?? 0} ${escapeHtml(ability?.kind ?? "physical")}, ${ability?.stamina ?? 0} stamina)</span></li>`;
    }).join("");
    const activeStatuses = p.statuses.filter((status) => status.turns > 0).map((status) =>
      `${reg.statuses.get(status.id)?.name ?? status.id} (${status.turns} turns)`);
    const perks = Object.entries(game.perks).filter(([, value]) => value !== 0)
      .map(([key, value]) => `${key}: ${value > 0 ? "+" : ""}${value}`);
    const talents = game.talentsTaken.map((id) => reg.upgrades.get(id)?.name ?? id);
    const party = game.party.map((id) => game!.actors.find((actor) => actor.id === id))
      .filter((actor): actor is NonNullable<typeof actor> => !!actor)
      .map((actor) => `${actor.name} — level ${companionState(actor, game!.turn).level}, ${actor.pools.hp}/${actor.pools.hpMax} HP`);
    const quests = game.questLines().map(({ quest, where, progress, done }) =>
      `${quest.ask}: ${progress}${where ? ` (${where})` : ""}${done ? " — complete" : ""}`);
    const threshold = xpForLevel(level + 1);
    const xpProgress = level >= 99
      ? `${game.xp} XP — maximum level`
      : `${game.xp} XP total · ${Math.max(0, threshold - game.xp)} XP to level ${level + 1}`;

    return `<h2>${escapeHtml(reg.species.get(game.speciesId)?.name ?? "")} ${escapeHtml(reg.classes.get(game.classId)?.name ?? "")}</h2>
      <p class="dim">${escapeHtml(game.player.name)} · ${escapeHtml(reg.species.get(game.speciesId)?.name ?? game.speciesId)} · ${escapeHtml(reg.classes.get(game.classId)?.name ?? game.classId)}</p>
      <p class="dim">Level ${level} · ${escapeHtml(xpProgress)}${
        game.attributePoints > 0
          ? ` · <strong>${game.attributePoints} point${game.attributePoints === 1 ? "" : "s"} to spend</strong>`
          : ""}</p>

      <h3>Attributes <span class="dim">(game modifier = score − ${ATTRIBUTE_BASE})</span></h3>
      <table class="pack-table attrs"><tbody>${rows}</tbody></table>

      <h3>Vitals & recovery</h3>
      <table class="sheet">
        <tr><td>Health</td><td>${p.pools.hp}/${p.pools.hpMax} · ${regenPerTurn} a turn after ${regenDelay} quiet turns</td></tr>
        <tr><td>Stamina</td><td>${p.pools.stamina}/${p.pools.staminaMax}</td></tr>
        <tr><td>Mana</td><td>${p.pools.mana}/${p.pools.manaMax}</td></tr>
        <tr><td>Form</td><td>${game.activeForm
          ? `${escapeHtml(FORMS.find((form) => form.id === game!.activeForm!.id)?.name ?? game.activeForm.id)} · ${Math.max(0, game.activeForm.expiresAt - game.turn)} turns left`
          : "Natural"}</td></tr>
      </table>

      <h3>Combat & derived stats</h3>
      <table class="sheet">
        <tr><td>Accuracy</td><td>${p.stats.accuracy}% base hit chance before target evasion</td></tr>
        <tr><td>Evasion</td><td>${p.stats.evasion}% reduction to incoming hit chance</td></tr>
        <tr><td>Might / Focus</td><td>${p.stats.might} ability damage · ${p.stats.focus} spell damage</td></tr>
        <tr><td>Armour</td><td>${p.armour} flat reduction · tolerance ${d.armourTolerance}</td></tr>
        <tr><td>Speed</td><td>${p.speed} energy per turn${p.speed === 100 ? " (standard)" : p.speed > 100 ? " (faster)" : " (slower)"}</td></tr>
        <tr><td>Carry</td><td>${d.carry} weight before encumbrance</td></tr>
        <tr><td>Gathering</td><td>${Math.round(d.gatherLuck * 100)}% rare-yield bonus · ${game.skills.foraging} Foraging · ${game.skills.mining} Mining · ${game.skills.woodcutting} Woodcutting</td></tr>
        <tr><td>Crafting</td><td>${d.craftQuality.toFixed(1)} quality · ${Math.round(d.learning * 100)}% learning rate · ${Object.entries(game.crafts).map(([skill, rank]) => `${skill} ${rank}`).join(", ")}</td></tr>
        <tr><td>Social</td><td>${Math.round(d.tameBonus * 100)}% taming bonus · ${Math.round(d.haggle * 100)}% haggle bonus · ${game.tameSkill} Taming</td></tr>
      </table>

      <h3>Defenses & resistances</h3>
      ${resistances.length ? `<table class="sheet">${resistances}</table>` : `<p class="dim">No damage resistances.</p>`}

      <h3>Equipment & enchantments</h3>
      <table class="sheet">${equipment}</table>
      <p class="dim">In hand: ${escapeHtml(weapon.name ?? "Fists")} — ${escapeHtml(WEAPON_CLASS[held as keyof typeof WEAPON_CLASS]?.name ?? held)} · ${weapon.damage} ${escapeHtml(weapon.kind ?? "physical")} · reach ${weapon.range ?? 1} · ${(weapon.cost ?? 1).toFixed(2)} turns · ${weapon.stamina ?? 0} stamina</p>

      <h3>Spells & abilities</h3>
      ${spells ? `<ul class="wiki-list">${spells}</ul>` : `<p class="dim">No known spells.</p>`}
      ${abilities ? `<ul class="wiki-list">${abilities}</ul>` : ""}

      <h3>Statuses</h3>
      ${activeStatuses.length ? `<p>${escapeHtml(activeStatuses.join(", "))}</p>` : `<p class="dim">No active statuses.</p>`}

      <h3>Growth, perks & practice</h3>
      <table class="sheet">
        <tr><td>Attribute points</td><td>${game.attributePoints}</td></tr>
        <tr><td>Talents</td><td>${escapeHtml(talents.join(", ") || "none")}</td></tr>
        <tr><td>Permanent perks</td><td>${escapeHtml(perks.join(" · ") || "none")}</td></tr>
        <tr><td>Weapon practice</td><td>${escapeHtml(practice.join(" · ") || "none")}</td></tr>
      </table>
      <h3>Companions, coin & quests</h3>
      <table class="sheet">
        <tr><td>Party</td><td>${escapeHtml(party.join(" · ") || "none")} (${game.party.length}/${game.partyLimit})</td></tr>
        <tr><td>Coin</td><td>${game.coin}</td></tr>
        <tr><td>Location</td><td>${escapeHtml(game.whereAmI)}${game.place.kind === "dungeon" ? ` · floor ${game.place.depth}/${DUNGEON_FLOORS}` : ""}</td></tr>
        <tr><td>Active quests</td><td>${escapeHtml(quests.join(" · ") || "none")}</td></tr>
      </table>
      <p class="dim">Derived from this run's live character, equipment, progression and quest state. Game attribute modifiers use score − ${ATTRIBUTE_BASE}; they are not the standard D&D half-score modifier.</p>
      <p class="dim">Esc closes. Press <strong>e</strong> for the spellbook.</p>`;
  };

  /**
   * Spellbook: library of known spells, hotbar equip slots, search by name/tags,
   * rename, and cast from here without equipping.
   */
  const spellbookHtml = () => {
    if (!game) return "";
    const slots = game.spellSlots;
    const bar = Array.from({ length: slots }, (_, i) => {
      const id = game!.equippedSpells[i];
      if (!id) {
        return `<div class="spell-slot empty"><span class="slot-num">${i + 1}</span><span class="dim">empty</span></div>`;
      }
      const def = reg.spells.get(id);
      return `<div class="spell-slot filled">
        <span class="slot-num">${i + 1}</span>
        <strong>${escapeHtml(game!.spellName(id))}</strong>
        <span class="dim">${def?.mana ?? "?"}m · ${def?.damage ?? 0} ${escapeHtml(def?.kind ?? "")}</span>
        <button type="button" data-unequip="${escapeHtml(id)}">unequip</button>
      </div>`;
    }).join("");

    const entries = game.spellbookEntries(spellbookQuery);
    const rows = entries.map((e) => {
      const tagPills = e.tags
        .filter((t) => !t.startsWith("t") || t.length <= 3)
        .slice(0, 8)
        .map((t) => `<button type="button" class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
        .join(" ");
      const equipBtns = Array.from({ length: slots }, (_, i) =>
        `<button type="button" data-equip="${escapeHtml(e.id)}" data-slot="${i}" ${e.equippedSlot === i ? "disabled" : ""} title="Equip to slot ${i + 1}">${i + 1}</button>`
      ).join("");
      return `<article class="spell-row ${e.equippedSlot !== null ? "is-equipped" : ""}">
        <div class="spell-copy">
          <strong>${escapeHtml(e.name)}</strong>
          ${e.equippedSlot !== null ? `<span class="dim"> · slot ${e.equippedSlot + 1}</span>` : ""}
          <p class="dim">${escapeHtml(e.about || "—")}</p>
          <p class="dim">${e.mana} mana · ${e.damage} ${escapeHtml(e.kind)}${tagPills ? ` · ${tagPills}` : ""}</p>
        </div>
        <div class="spell-actions">
          <label class="rename">Rename <input type="text" data-rename="${escapeHtml(e.id)}" value="${escapeHtml(e.name)}" maxlength="48" /></label>
          <span class="equip-group">Equip ${equipBtns}</span>
          ${e.equippedSlot !== null ? `<button type="button" data-unequip="${escapeHtml(e.id)}">unequip</button>` : ""}
          <button type="button" data-cast="${escapeHtml(e.id)}">cast</button>
        </div>
      </article>`;
    }).join("");

    return `<h2>Spellbook</h2>
      <p class="dim">${game.player.spells.length} known · ${slots} hotbar slots (${slots === 5 ? "magic class" : "standard"}). Keys 1–${slots} cast equipped spells.</p>
      <h3>Equipped</h3>
      <div class="spell-bar">${bar || `<p class="dim">No slots.</p>`}</div>
      <h3>Library</h3>
      <p><input type="search" id="spellbook-search" placeholder="Search name, tag, element…" value="${escapeHtml(spellbookQuery)}" style="width:min(28rem,100%)" /></p>
      ${rows || `<p class="dim">${spellbookQuery ? "No spells match." : "You know no spells yet."}</p>`}
      <p class="dim">e or Esc closes. Cast from here spends a turn the same as a hotkey.</p>`;
  };

  function wireSpellbook(): void {
    if (!game) return;
    const root = $("overlay");
    const search = root.querySelector("#spellbook-search") as HTMLInputElement | null;
    search?.addEventListener("input", () => {
      spellbookQuery = search.value;
      render();
      const again = $("overlay").querySelector("#spellbook-search") as HTMLInputElement | null;
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
    root.querySelectorAll("[data-tag]").forEach((el) => {
      el.addEventListener("click", () => {
        spellbookQuery = (el as HTMLElement).dataset.tag ?? "";
        render();
      });
    });
    root.querySelectorAll("[data-equip]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.equip!;
        const slot = Number((el as HTMLElement).dataset.slot);
        game!.equipSpell(id, slot);
        render();
      });
    });
    root.querySelectorAll("[data-unequip]").forEach((el) => {
      el.addEventListener("click", () => {
        game!.unequipSpell((el as HTMLElement).dataset.unequip!);
        render();
      });
    });
    root.querySelectorAll("[data-cast]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.cast!;
        const turn = game!.turn;
        setScreen("play");
        game!.cast(id);
        if (game!.turn > turn) sounds.play("cast");
        afterCommand();
      });
    });
    root.querySelectorAll("input[data-rename]").forEach((el) => {
      el.addEventListener("change", () => {
        const input = el as HTMLInputElement;
        game!.renameSpell(input.dataset.rename!, input.value);
        render();
      });
    });
  }

  const formsHtml = () => {
    if (!game) return "";
    const active = game.activeForm;
    const activeName = active ? FORMS.find((form) => form.id === active.id)?.name ?? active.id : null;
    const cards = FORMS.map((form) => {
      const selected = form.id === active?.id;
      const blocked = form.blockedSlots
        .filter((slot) => game!.speciesEquipmentSlots.includes(slot))
        .map((slot) => slotLabel(slot, game!.speciesId));
      return `<article class="recipe-card">
        <div class="recipe-copy">
          <strong class="recipe-name">${escapeHtml(form.name)}${selected ? " · active" : ""}</strong>
          <p class="recipe-why dim">${escapeHtml(form.about)}</p>
          <p class="dim">${form.mana} mana · ${form.duration} turns${blocked.length ? ` · melds ${escapeHtml(blocked.join(", "))}` : ""}</p>
        </div>
        <div class="recipe-actions"><button data-form="${form.id}" ${selected || game!.player.pools.mana < form.mana ? "disabled" : ""}>${selected ? "active" : "transform"}</button></div>
      </article>`;
    }).join("");
    return `<h2>Transformations</h2>
      <p class="dim">${activeName
        ? `${escapeHtml(activeName)} · ${Math.max(0, active!.expiresAt - game.turn)} turns remaining. Melded gear returns when the form ends.`
        : "Transformations cost mana and one turn. Melded equipment stays worn and returns when you change back or the form expires."}</p>
      ${cards}
      ${activeName ? `<p><button data-form="natural">Return to natural form</button></p>` : ""}
      <p class="dim">v or Esc closes.</p>`;
  };

  function renderLog(): void {
    if (!game) return;
    const lines = game.messages.slice(-80);
    const html = lines
      .map((m) => `<div class="line tone-${m.tone ?? "plain"}">${escapeHtml(m.text)}${
        (m.count ?? 1) > 1 ? `<span class="rep">&times;${m.count}</span>` : ""}</div>`)
      .join("");
    if (html === lastLogHtml) return;
    const logEl = $("log");
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    lastLogHtml = html;
    logEl.innerHTML = html;
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }

  // --- screens ------------------------------------------------------------

  /** Chosen on the way in. */
  let pickedSpecies = "human";
  let pickedBg = "fighter";

  /**
   * Character creation: species on the left, background in the middle, and
   * what the two of them add up to on the right.
   *
   * Both lists are compact rows rather than cards, because with 22 species and
   * 20 backgrounds anything taller turns the screen into a scroll. The
   * interesting part is the COMBINATION — a Troll Conjurer and a Deep Elf
   * Conjurer are different games — so the right-hand panel always shows the
   * pair you currently have selected, and nothing commits until you press
   * Begin.
   */
  function renderClassSelect(reg: Registry): void {
    const dots = (n: number) => "\u25cf".repeat(Math.max(1, Math.min(5, n)));
    const sprite = (id: string, src: string) =>
      `<img src="assets/tiles16/${src}.png" alt="" width="24" height="24" title="${escapeHtml(id)}">`;

    const byName = <T extends { name?: string; id?: string }>(a: T, b: T) =>
      (a.name ?? a.id ?? "").localeCompare(b.name ?? b.id ?? "");

    const speciesRows = [...reg.species.values()].sort(byName).map((sp) => `
      <button class="row ${sp.id === pickedSpecies ? "on" : ""}" data-species="${sp.id}">
        ${sprite(sp.id!, sp.sprite ?? `pc-${sp.id}`)}
        <span class="row-name">${escapeHtml(sp.name ?? sp.id!)}</span>
        <span class="row-sub" title="difficulty">${dots(sp.difficulty ?? 1)}</span>
      </button>`).join("");

    const bgRows = [...reg.classes.values()].sort(byName).map((c) => `
      <button class="row ${c.id === pickedBg ? "on" : ""}" data-class="${c.id}">
        <span class="row-name">${escapeHtml(c.name ?? c.id!)}</span>
        <span class="row-sub">${(c.spells ?? []).length ? "magic" : "arms"}</span>
      </button>`).join("");

    const sp = reg.species.get(pickedSpecies);
    const bg = reg.classes.get(pickedBg);

    /*
     * The attributes you actually start with: ten, plus the species' and the
     * background's differences, which add. This is the same sum Game.makeCharacter
     * does, so the sheet is a promise the run keeps rather than a flat 10/10/10.
     */
    const attrValue = (id: AttributeId) =>
      ATTRIBUTE_BASE
      + ((sp?.attributes as Record<string, number> | undefined)?.[id] ?? 0)
      + ((bg?.attributes as Record<string, number> | undefined)?.[id] ?? 0);
    const attrs = Object.fromEntries(ATTRIBUTES.map((id) => [id, attrValue(id)])) as Attributes;
    const d = derive(attrs);

    // Pools the way the game builds them: a base, plus the species' and
    // background's own pool blocks (mods still work), plus what the attributes
    // are worth. Endurance, Strength and Wits move these, so two builds no longer
    // read as an identical 100/100/50 when they play nothing alike.
    const pool = (base: number, k: "hp" | "stamina" | "mana", bonus: number) =>
      Math.max(k === "hp" ? 1 : 0, base + (sp?.pools?.[k] ?? 0) + (bg?.pools?.[k] ?? 0) + bonus);
    const named = (ids: string[], from: Map<string, { name?: string }>) =>
      ids.map((i) => escapeHtml(from.get(i)?.name ?? i)).join(", ") || "\u2014";

    // One cell per attribute, marking what the choice raised or lowered.
    const attrRow = ATTRIBUTES.map((id) => {
      const v = attrValue(id);
      const delta = v - ATTRIBUTE_BASE;
      const tone = delta > 0 ? "attr-up" : delta < 0 ? "attr-down" : "";
      return `<span class="attr ${tone}" title="${escapeHtml(ATTRIBUTE_INFO[id].about)}">
        <span class="attr-short">${ATTRIBUTE_INFO[id].short}</span>
        <span class="attr-val">${v}</span>
      </span>`;
    }).join("");

    $("class-cards").innerHTML = `
      <div class="creation">
        <div class="creation-col">
          <h2>Species</h2>
          <div class="rows">${speciesRows}</div>
        </div>
        <div class="creation-col">
          <h2>Background</h2>
          <div class="rows">${bgRows}</div>
        </div>
        <div class="creation-col creation-sheet">
          <h2>${escapeHtml(sp?.name ?? "")} ${escapeHtml(bg?.name ?? "")}</h2>
          <div class="sheet-art">${sprite(pickedSpecies, sp?.sprite ?? `pc-${pickedSpecies}`)}</div>
          <p>${escapeHtml(sp?.blurb ?? sp?.about ?? "")}</p>
          <p class="dim">${escapeHtml(bg?.blurb ?? bg?.about ?? "")}</p>
          <div class="attr-row">${attrRow}</div>
          <table class="sheet">
            <tr><td>Health</td><td>${pool(100, "hp", d.hpBonus)}</td></tr>
            <tr><td>Stamina</td><td>${pool(100, "stamina", d.staminaBonus)}</td></tr>
            <tr><td>Mana</td><td>${pool(50, "mana", d.manaBonus)}</td></tr>
            <tr><td>Spells</td><td>${named([...(sp?.spells ?? []), ...(bg?.spells ?? [])], reg.spells)}</td></tr>
            <tr><td>Kit</td><td>${named(bg?.items ?? [], reg.items)}</td></tr>
          </table>
          <button class="begin" id="begin">Begin</button>
        </div>
      </div>`;

    for (const el of document.querySelectorAll<HTMLElement>("[data-species]")) {
      el.onclick = () => { pickedSpecies = el.dataset.species!; renderClassSelect(reg); };
    }
    for (const el of document.querySelectorAll<HTMLElement>("[data-class]")) {
      el.onclick = () => { pickedBg = el.dataset.class!; renderClassSelect(reg); };
    }
    const seedValue = () => ($("seed") as HTMLInputElement).value.trim() || Date.now();
    const startRun = (next: Game) => {
      game = next;
      game.movementHint = movementHint(bindings);
      game.onAutosave = autosave;
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
    $("quick-start").onclick = () => startRun(createQuickStart(reg, seedValue()));
    $("begin").onclick = () => {
      const next = new Game(reg, seedValue());
      next.start(pickedBg, pickedSpecies);
      startRun(next);
    };
  }

  function renderOverlay(html: string): void {
    $("overlay-body").innerHTML = html;
  }


  /**
   * The three.
   *
   * Shown as cards with a number key each, because at a level-up the player
   * wants to compare them at a glance, not read a list.
   */
  const levelUpHtml = () => {
    if (!game) return "";
    const choices = game.pendingChoices ?? [];
    const milestone = game.pendingMilestone;
    const kindOf = (c: (typeof choices)[number]) => {
      if (c.kind === "spell") return "spell";
      if (milestone) return "talent";
      return reg.upgrades.get(c.id)?.group ?? "upgrade";
    };

    return `<h2>${milestone ? `Milestone — level ${game.progress.level}` : `Level ${game.progress.level}`}</h2>
      <p class="dim">${milestone
        ? "These are the big ones, and each can only be taken once."
        : "Take one. Press its number, or click it."}</p>
      <div class="choices">
        ${choices.map((c, i) => `
          <button class="choice choice-${c.kind} ${milestone ? "choice-talent" : ""}" data-choice="${i}">
            <span class="choice-key">${i + 1}</span>
            <h3>${escapeHtml(c.name)}</h3>
            <p class="choice-detail">${escapeHtml(c.detail)}</p>
            <p class="dim">${escapeHtml(c.about)}</p>
            <span class="choice-kind">${escapeHtml(kindOf(c))}</span>
          </button>`).join("")}
      </div>
      <p>${game.rerollsLeft > 0
        ? `<button data-reroll="1">Think again (${game.rerollsLeft} left)</button>
           <span class="dim">Or press r. One per level.</span>`
        : `<span class="dim">No rerolls left this level.</span>`}</p>`;
  };

  /**
   * Pack and equipment screen.
   *
   * Two columns: worn gear on the left, pack list on the right with search,
   * category chips, and a sticky detail/action panel for the selected item.
   */
  const packHtml = () => {
    if (!game) return "";
    const detailExists = packDetail !== null
      && (SLOTS.some((s) => game!.worn[s] === packDetail) || game!.pack.includes(packDetail));
    if (!detailExists) packDetail = null;

    const d = derive(game.player.attributes);
    const carryUsed = game.pack.length;
    const carryMax = d.carry;
    const carryCls = carryUsed > carryMax ? "pack-over" : carryUsed > carryMax * 0.85 ? "pack-tight" : "";

    // --- equipment column -------------------------------------------------
    const wornRows = game.speciesEquipmentSlots.map((slot) => {
      const id = game!.worn[slot];
      const item = id ? game!.itemDef(id) : undefined;
      const selected = id && id === packDetail;
      const melded = game!.isSlotMelded(slot);
      return `<button type="button" class="eq-slot ${id ? "filled" : "empty"} ${selected ? "selected" : ""} ${melded ? "melded" : ""}"
          data-detail="${id ? escapeHtml(id) : ""}" ${id ? "" : "disabled"}>
        <span class="eq-slot-name">${escapeHtml(slotLabel(slot, game!.speciesId))}${melded ? " · melded" : ""}</span>
        <span class="eq-slot-item">${item ? escapeHtml(game!.displayName(id!)) : "—"}</span>
        ${id ? `<span class="eq-slot-off" data-off="${slot}" title="Take off">×</span>` : ""}
      </button>`;
    }).join("");

    // --- pack list: stack, filter, sort -----------------------------------
    const counts = new Map<string, number>();
    for (const id of game.pack) counts.set(id, (counts.get(id) ?? 0) + 1);

    type Row = { id: string; n: number; name: string; slot: string; value: number; cat: string };
    const rows: Row[] = [];
    for (const [id, n] of counts) {
      const item = game.itemDef(id);
      if (!item) continue;
      const slot = item.slot ?? "misc";
      const wearable = slotsFor(item).some((s) => game!.equipmentSlots.includes(s));
      let cat = "other";
      if (wearable || ["weapon", "head", "body", "cloak", "hands", "feet", "offhand", "ring", "amulet"].includes(slot)) {
        cat = "gear";
      } else if (item.casts || slot === "food" || slot === "potion" || slot === "scroll") {
        cat = "use";
      } else if (slot === "material" || slot === "ore" || slot === "wood" || slot === "reagent") {
        cat = "mats";
      }
      rows.push({
        id,
        n: game.instanceOf(id) ? 1 : n,
        name: game.displayName(id),
        slot,
        value: game.itemDetail(id).worth ?? item.value ?? 0,
        cat,
      });
    }

    const q = packQuery.trim().toLowerCase();
    let visible = rows.filter((r) => {
      if (packFilter !== "all" && r.cat !== packFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.slot.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    });
    visible = visible.slice().sort((a, b) => {
      if (packSort === "value") return b.value - a.value || a.name.localeCompare(b.name);
      if (packSort === "type") return a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

    const packRows = visible.length
      ? visible.map((r) => {
          const item = game!.itemDef(r.id)!;
          const wearable = slotsFor(item).some((s) => game!.equipmentSlots.includes(s));
          const selected = r.id === packDetail;
          return `<button type="button" class="pack-row ${selected ? "selected" : ""}" data-detail="${escapeHtml(r.id)}">
            <span class="pack-row-count">${r.n > 1 ? `×${r.n}` : ""}</span>
            <span class="pack-row-name">${escapeHtml(r.name)}</span>
            <span class="pack-row-meta dim">${escapeHtml(r.slot)}${r.value ? ` · ${r.value}c` : ""}</span>
            <span class="pack-row-quick">
              ${wearable ? `<span class="quick" data-wear="${escapeHtml(r.id)}" title="Wear">W</span>` : ""}
              ${item.casts ? `<span class="quick" data-use="${escapeHtml(r.id)}" title="Use">U</span>` : ""}
              <span class="quick" data-drop="${escapeHtml(r.id)}" title="Drop">D</span>
            </span>
          </button>`;
        }).join("")
      : `<p class="dim inventory-empty">${game.pack.length ? "Nothing matches." : "Pack empty — walk onto something and press g."}</p>`;

    const filterChip = (id: typeof packFilter, label: string) =>
      `<button type="button" class="pack-chip ${packFilter === id ? "on" : ""}" data-pack-filter="${id}">${label}</button>`;
    const sortChip = (id: typeof packSort, label: string) =>
      `<button type="button" class="pack-chip ${packSort === id ? "on" : ""}" data-pack-sort="${id}">${label}</button>`;

    // --- detail / actions for selection -----------------------------------
    let detailPane = `<div class="pack-detail empty"><p class="dim">Select an item to inspect it.</p></div>`;
    if (packDetail) {
      const id = packDetail;
      const item = game.itemDef(id);
      const wornSlot = SLOTS.find((s) => game!.worn[s] === id);
      const wearable = item && slotsFor(item).some((s) => game!.equipmentSlots.includes(s));
      const dtl = game.itemDetail(id);
      const stats = dtl.lines.map(([k, v]) =>
        `<div class="pd-stat"><span class="dim">${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join("");
      const affixes = dtl.affixes.length
        ? dtl.affixes.map((a) =>
          `<div class="affix"><span class="affix-name">${escapeHtml(a.name)}</span>
           ${a.effect ? `<span class="affix-effect">${escapeHtml(a.effect)}</span>` : ""}
           ${a.about ? `<p class="dim">${escapeHtml(a.about)}</p>` : ""}</div>`).join("")
        : "";
      detailPane = `<div class="pack-detail">
        <h3>${escapeHtml(dtl.name)}${dtl.unique ? ' <span class="unique-tag">unique</span>' : ""}</h3>
        ${dtl.about ? `<p class="dim">${escapeHtml(dtl.about)}</p>` : ""}
        <div class="pd-stats">${stats}
          <div class="pd-stat"><span class="dim">Worth</span><span>${dtl.worth} coin</span></div>
        </div>
        ${affixes ? `<div class="pd-affixes">${affixes}</div>` : ""}
        <div class="pd-actions">
          ${wearable && !wornSlot ? `<button type="button" data-wear="${escapeHtml(id)}">Wear</button>` : ""}
          ${wornSlot ? `<button type="button" data-off="${wornSlot}">Take off</button>` : ""}
          ${item?.casts ? `<button type="button" data-use="${escapeHtml(id)}">Use</button>` : ""}
          ${!wornSlot ? `<button type="button" data-drop="${escapeHtml(id)}">Drop</button>` : ""}
        </div>
      </div>`;
    }

    return `<div class="pack-screen">
      <header class="pack-header">
        <h2>Pack</h2>
        <span class="pack-carry ${carryCls}">${carryUsed} / ${carryMax} carry</span>
      </header>
      <div class="pack-layout">
        <section class="pack-eq">
          <h3>Equipped</h3>
          <div class="eq-grid">${wornRows}</div>
        </section>
        <section class="pack-bag">
          <div class="pack-toolbar">
            <input type="search" id="pack-search" placeholder="Search…" value="${escapeHtml(packQuery)}" />
            <div class="pack-chips">
              ${filterChip("all", "All")}
              ${filterChip("gear", "Gear")}
              ${filterChip("use", "Use")}
              ${filterChip("mats", "Mats")}
              ${filterChip("other", "Other")}
            </div>
            <div class="pack-chips sort">
              ${sortChip("name", "Name")}
              ${sortChip("type", "Type")}
              ${sortChip("value", "Value")}
            </div>
          </div>
          <div class="pack-list">${packRows}</div>
          ${detailPane}
        </section>
      </div>
      <p class="dim pack-hint">Click a row to inspect · W wear · U use · D drop · i / Esc close · g pick up</p>
    </div>`;
  };

  /**
   * The full read-out for one item: its numbers in the player's hands, and every
   * enchantment on it spelled out. This is the answer to "what does this actually
   * do", which a one-line summary can never fully give for a piece with affixes.
   */
  const itemDetailHtml = (id: string) => {
    if (!game) return "";
    const d = game.itemDetail(id);
    const stat = d.lines
      .map(([k, v]) => `<tr><td class="dim">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
      .join("");
    const affixes = d.affixes.length
      ? `<h3>Enchantments</h3>` + d.affixes.map((a) => `
          <div class="affix">
            <span class="affix-name">${escapeHtml(a.name)}</span>
            ${a.effect ? `<span class="affix-effect">${escapeHtml(a.effect)}</span>` : ""}
            ${a.about ? `<p class="dim">${escapeHtml(a.about)}</p>` : ""}
          </div>`).join("")
      : "";
    return `<div class="item-detail">
      <button class="detail-close" data-detail-close="1">×</button>
      <h2>${escapeHtml(d.name)}${d.unique ? ' <span class="unique-tag">unique</span>' : ""}</h2>
      ${d.about ? `<p class="dim">${escapeHtml(d.about)}</p>` : ""}
      <table class="detail-table">${stat}
        <tr><td class="dim">Worth</td><td>${d.worth} coin</td></tr>
      </table>
      ${affixes}
    </div>`;
  };

  const deadHtml = () => {
    const last = mostRecentSave();
    // When to say when: a save from this very run is "pick up where you left
    // off"; one from another run is still offered, but named honestly so nobody
    // loads a stranger's character by accident.
    const sameRun = last && game && last.file.seed === game.seed;
    const when = last
      ? (() => {
          const mins = Math.round((Date.now() - last.file.at) / 60000);
          return mins < 1 ? "moments ago" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
        })()
      : "";
    const species = game ? reg.species.get(game.speciesId)?.name ?? game.speciesId : "";
    const bg = game ? reg.classes.get(game.classId)?.name ?? game.classId : "";
    return `<h2>You died</h2>
      <p>${escapeHtml(game?.over?.reason ?? "")}</p>
      <p class="dim">${escapeHtml(species)} ${escapeHtml(bg)} · Level ${game?.playerLevel ?? "?"} · Turn ${game?.turn} · seed ${game?.seedWord}</p>
      <p class="dim" id="memorial-status">Saving memorial PNG to your Downloads folder…</p>
      <p><button id="save-memorial" type="button" title="Download again to your Downloads folder">Save memorial PNG again</button></p>
      ${last
        ? `<p><button id="load-last">${sameRun ? "Load your last save" : "Load last save"} — ${escapeHtml(last.file.label)} (${when})</button></p>`
        : `<p class="dim">No save to go back to. The game saves itself every ${AUTOSAVE_EVERY} turns, and you can save by hand from the menu.</p>`}
      <p><button id="again">Start again</button></p>`;
  };

  const problemsHtml = (reg: Registry) => `
    <h2>Content problems</h2>
    <p class="dim">${reg.errorCount} file(s) could not be loaded. The rest of the game still works.</p>
    <pre>${escapeHtml(reg.report().join("\n"))}</pre>
    <p><button id="anyway">Play anyway</button></p>`;

  // --- input --------------------------------------------------------------

  window.addEventListener("keydown", (e) => {
    /*
     * Typing in a text box is typing, except for Escape.
     *
     * The wiki's search box swallowed every key, Escape included, so once the
     * cursor was in it there was no way out of the screen with the keyboard —
     * you had to find the Close button. Escape now leaves the box first and is
     * then handled normally, and every other key still reaches the box.
     */
    if ((e.target as HTMLElement)?.tagName === "INPUT") {
      if (e.key !== "Escape") return;
      (e.target as HTMLInputElement).blur();
    }
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
      // One reroll, on r, while the choice is up. Deliberately not a bindable
      // action: it only exists on this screen, and a key that does nothing
      // everywhere else does not belong in the controls list.
      if (e.key === "r" && game.reroll()) { e.preventDefault(); render(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= game.pendingChoices.length) {
        e.preventDefault();
        game.chooseUpgrade(n - 1);
        setScreen(game.pendingChoices ? "levelup" : "play");
      }
      return;
    }

    /*
     * Rebinding swallows the keyboard.
     *
     * While the controls screen is waiting for a key, EVERY press is that key —
     * including Escape, which someone will reasonably want to bind. Cancelling
     * is the button next to the prompt, not a key, because any key reserved for
     * cancelling is a key that can never be bound.
     */
    if (listening) {
      e.preventDefault();
      if (!isBindable(e)) return;
      const { tookFrom } = rebind(bindings, listening, keyToken(e));
      saveBindings(bindings);
      if (tookFrom) game?.log(`That key no longer does "${tookFrom.what}".`, "warn");
      listening = null;
      render();
      return;
    }

    const action = actionFor(e, bindings);
    const cmd = action?.command;
    if (!cmd) return;
    e.preventDefault();

    /*
     * One key press backs out of one thing.
     *
     * A journey, then the right-click menu, then a screen: pressing Escape with
     * a context menu open used to close it AND open the game menu in the same
     * press, because both were handled in one pass.
     */
    if (travelTimer !== null) { stopTravel(); render(); return; }
    if (context) { closeContext(); return; }

    if (cmd.kind === "menu") {
      // Escape backs out one layer at a time, and opens the menu from play.
      if (screen === "controls" || screen === "save" || screen === "load" || screen === "wiki") {
        setScreen(menuReturn === "menu" ? "menu" : menuReturn);
      } else if (screen === "menu") {
        setScreen(game && !game.over ? "play" : "class-select");
      } else if (screen !== "play" && screen !== "class-select") {
        setScreen(game ? "play" : "class-select");
      } else {
        menuReturn = screen;
        setScreen("menu");
      }
      return;
    }
    if (cmd.kind === "close") { if (screen !== "play") setScreen(game ? "play" : "class-select"); return; }
    if (cmd.kind === "help") { menuReturn = "play"; setScreen(screen === "help" ? "play" : "help"); return; }
    if (cmd.kind === "wiki") { menuReturn = screen === "wiki" ? "play" : screen; setScreen(screen === "wiki" ? "play" : "wiki"); return; }
    if (cmd.kind === "map") { setScreen(screen === "map" ? "play" : "map"); return; }
    if (cmd.kind === "pack") { setScreen(screen === "pack" ? "play" : "pack"); return; }
    if (cmd.kind === "craft") { setScreen(screen === "craft" ? "play" : "craft"); return; }
    if (cmd.kind === "sheet") { setScreen(screen === "sheet" ? "play" : "sheet"); return; }
    if (cmd.kind === "spellbook") {
      if (screen !== "spellbook") spellbookQuery = "";
      setScreen(screen === "spellbook" ? "play" : "spellbook");
      return;
    }
    if (cmd.kind === "forms") {
      if (!game) return;
      setScreen(screen === "forms" ? "play" : "forms");
      return;
    }
    if (cmd.kind === "quests") { setScreen(screen === "quests" ? "play" : "quests"); return; }
if (cmd.kind === "market") {
      // The trade key only does anything where there is somebody to trade with.
      const here = game?.villageHere;
      if (!here) { game?.log("There is nobody here to trade with.", "warn"); render(); return; }
      openMarket = here.index;
      setScreen(screen === "market" ? "play" : "market");
      return;
    }
    if (cmd.kind === "designer") { openDesigner(atlas, () => render()); return; }

    if (!game || screen !== "play" || game.over) return;

    switch (cmd.kind) {
      case "move": game.move(cmd.dx, cmd.dy); break;
      case "rest": game.rest(); break;
      case "long-rest": game.longRest(); break;
      case "pickup": game.pickUp(); break;
      case "ability": game.ability(cmd.id); break;
      case "spell": {
        const turn = game.turn;
        game.castSlot(cmd.slot);
        if (game.turn > turn) sounds.play("cast");
        break;
      }
    }
    afterCommand();
  });

  // --- the mouse ------------------------------------------------------------

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!game || screen !== "play" || game.over) return;
    const at = tileAt(e);
    if (!at) { closeContext(); return; }
    context = { menu: menuAt(game, at.x, at.y), x: at.x, y: at.y, sx: e.clientX, sy: e.clientY };
    renderContext();
  });

  canvas.addEventListener("wheel", (e) => {
    if (screen !== "play" && screen !== "map") return;
    e.preventDefault();
    if (!e.deltaY) return;
    if (screen === "map") {
      mapZoom = stepMapZoom(mapZoom, e.deltaY);
    } else {
      playZoomOffset = stepPlayZoomOffset(fitScale, playZoomOffset, e.deltaY);
      scale = fitScale + playZoomOffset;
    }
    render();
  }, { passive: false });

  /*
   * Left-click walks there, which is the other half of "playable with a mouse".
   *
   * Clicking something adjacent does what you would expect — attack it, or work
   * at it — rather than refusing to move into it, because a click on the goblin
   * next to you obviously means the goblin.
   *
   * A click while already walking retargets to the new tile (or cancels if you
   * click yourself). Esc also cancels.
   */
  canvas.addEventListener("click", (e) => {
    if (!game || screen !== "play" || game.over) return;
    if (context) { closeContext(); return; }
    const at = tileAt(e);
    if (!at) return;
    const dx = at.x - game.player.pos.x, dy = at.y - game.player.pos.y;
    // Same tile while traveling: cancel the route.
    if (!dx && !dy) {
      if (travelTimer !== null) { stopTravel(); render(); return; }
      game.rest();
      afterCommand();
      return;
    }
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      stopTravel();
      if (game.harvestable(at.x, at.y)) game.harvest(at.x, at.y);
      else game.move(dx, dy);
      afterCommand();
      return;
    }
    // Distant tile: path there (retargets if already walking).
    stopTravel();
    if (game.travelTo(at.x, at.y)) startTravel();
    else render();
  });

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;

    if (t.closest("[data-long-rest]") && game && screen === "play") {
      game.longRest();
      afterCommand();
      return;
    }
    if (t.closest("[data-open-forms]") && game && screen === "play") {
      setScreen("forms");
      return;
    }
    if (t.closest("[data-play-zoom-reset]")) {
      playZoomOffset = 0;
      scale = fitScale;
      render();
      return;
    }

    const soundToggle = t.closest<HTMLElement>("[data-sound-toggle]");
    if (soundToggle) { sounds.setEnabled(!sounds.enabled); render(); return; }

    // --- the right-click menu ---------------------------------------------
    const ctx = t.closest<HTMLElement>("[data-ctx]");
    if (ctx) { runContext(Number(ctx.dataset.ctx)); return; }
    if (t.closest("[data-ctx-close]")) { closeContext(); return; }
    // A click anywhere else dismisses it, the canvas included — which its own
    // handler deals with, so this only has to catch the rest of the page.
    if (context && !t.closest("#context") && t !== canvas) { closeContext(); }

    // --- the world map -----------------------------------------------------
    const mf = t.closest<HTMLElement>("[data-mapfilter]");
    if (mf) {
      const k = mf.dataset.mapfilter as keyof MapFilters;
      if (typeof mapFilters[k] === "boolean") {
        mapFilters = { ...mapFilters, [k]: !mapFilters[k] };
        render();
      }
      return;
    }
    if (t.closest("[data-map-zoom-reset]")) {
      mapZoom = 1;
      render();
      return;
    }

    // --- the menu ----------------------------------------------------------
    const item = t.closest<HTMLElement>("[data-menu]");
    if (item) {
      switch (item.dataset.menu) {
        case "resume": setScreen("play"); return;
        case "controls": menuReturn = "menu"; listening = null; setScreen("controls"); return;
        case "save": menuReturn = "menu"; setScreen("save"); return;
        case "load": menuReturn = "menu"; setScreen("load"); return;
        case "wiki": menuReturn = "menu"; setScreen("wiki"); return;
        case "designer": openDesigner(atlas, () => render()); return;
        case "abandon":
          stopTravel();
          game = null;
          setScreen("class-select");
          return;
        case "defaults":
          clearBindings();
          bindings = loadBindings();
          listening = null;
          render();
          return;
        case "back":
          listening = null;
          setScreen(menuReturn);
          return;
      }
    }

    // --- rebinding ---------------------------------------------------------
    const listen = t.closest<HTMLElement>("[data-listen]");
    if (listen) { listening = listen.dataset.listen!; render(); return; }
    if (t.closest("[data-listen-cancel]")) { listening = null; render(); return; }
    const drop = t.closest<HTMLElement>("[data-unbind]");
    if (drop) {
      unbind(bindings, drop.dataset.unbind!, drop.dataset.key!);
      saveBindings(bindings);
      render();
      return;
    }

    // --- saves -------------------------------------------------------------
    const doSave = t.closest<HTMLElement>("[data-save]");
    if (doSave && game) {
      const res = writeSlot(Number(doSave.dataset.save), game.toSave());
      game.log(res.message, res.ok ? "good" : "bad");
      setScreen("play");
      return;
    }
    const doLoad = t.closest<HTMLElement>("[data-load]");
    if (doLoad) {
      const file = readSlot(Number(doLoad.dataset.load));
      if (!file) { render(); return; }
      stopTravel();
      game = loadGame(reg, file);
      game.movementHint = movementHint(bindings);
      game.onAutosave = autosave;
      (window as unknown as { turbz: unknown }).turbz = { game, reg, atlas, render };
      game.log("Loaded.", "good");
      setScreen("play");
      resize();
      return;
    }
    const erase = t.closest<HTMLElement>("[data-erase]");
    if (erase) { deleteSlot(Number(erase.dataset.erase)); render(); return; }

    // --- wiki --------------------------------------------------------------
    const section = t.closest<HTMLElement>("[data-wiki-section]");
    if (section) { wikiSection = section.dataset.wikiSection as WikiSection; wikiQuery = ""; render(); return; }
    const open = t.closest<HTMLElement>("[data-wiki-open]");
    if (open) { wikiOpen = open.dataset.wikiOpen!; render(); return; }
    const jump = t.closest<HTMLElement>("[data-wiki-jump]");
    if (jump) {
      wikiOpen = jump.dataset.wikiJump!;
      wikiSection = wikiOpen.split("/")[0] as WikiSection;
      wikiQuery = "";
      menuReturn = screen;
      setScreen("wiki");
      return;
    }

    // --- the character sheet ------------------------------------------------
    const raise = t.closest<HTMLElement>("[data-raise]");
    if (raise && game) { game.raiseAttribute(raise.dataset.raise as AttributeId); render(); return; }

    // --- trading, talking and work -----------------------------------------
    const doBuyBlack = t.closest<HTMLElement>("[data-buy-black]");
    if (doBuyBlack && game) {
      game.buyBlack(doBuyBlack.dataset.buyBlack!);
      render();
      return;
    }
    const doSellBlack = t.closest<HTMLElement>("[data-sell-black]");
    if (doSellBlack && game) {
      game.sellBlack(doSellBlack.dataset.sellBlack!);
      render();
      return;
    }
    const doBuy = t.closest<HTMLElement>("[data-buy]");
    if (doBuy && game) {
      const [where, item] = doBuy.dataset.buy!.split(":");
      game.buy(Number(where), item!);
      render();
      return;
    }
    const doSell = t.closest<HTMLElement>("[data-sell]");
    if (doSell && game) {
      const [where, item] = doSell.dataset.sell!.split(":");
      game.sell(Number(where), item!);
      render();
      return;
    }
    const doSellAll = t.closest<HTMLElement>("[data-sell-all]");
    if (doSellAll && game) {
      const [where, item] = doSellAll.dataset.sellAll!.split(":");
      game.sellAll(Number(where), item!);
      render();
      return;
    }
    const openStall = t.closest<HTMLElement>("[data-market]");
    if (openStall) { openMarket = Number(openStall.dataset.market); setScreen("market"); return; }

    const accept = t.closest<HTMLElement>("[data-accept]");
    if (accept && game) {
      // The actor id has no colon, but a quest id does ("slay:3:wolf"), so split
      // on the FIRST colon only — the rest is the quest id, verbatim.
      const [whoId, questId] = splitFirst(accept.dataset.accept!);
      const who = game.actors.find((a) => a.id === whoId);
      const quest = who && game.questsFrom(who).find((q) => q.id === questId);
      if (quest) game.acceptQuest(quest);
      render();
      return;
    }
    const handin = t.closest<HTMLElement>("[data-handin]");
    if (handin && game) {
      const who = game.actors.find((a) => a.id === handin.dataset.handin);
      if (who) game.handIn(who);
      render();
      return;
    }
    const abandon = t.closest<HTMLElement>("[data-abandon]");
    if (abandon && game) { game.abandonQuest(abandon.dataset.abandon!); render(); return; }

    const trainBtn = t.closest<HTMLElement>("[data-train]");
    if (trainBtn && game) {
      // A skill id can itself contain a colon ("recipe:steel-ingot"), so keep
      // everything after the actor id intact.
      const [whoId, skill] = splitFirst(trainBtn.dataset.train!);
      const who = game.actors.find((a) => a.id === whoId);
      const npc = who && game.reg.npcs.get(String(who.data["npc"]));
      const offer = npc?.teaches?.find((x) => x.skill === skill);
      if (offer) game.train(skill!, Math.round(offer.price * (1 + game.skillLevel(skill!) * 0.08)));
      render();
      return;
    }

    // --- crafting ----------------------------------------------------------
    const make = t.closest<HTMLElement>("[data-craft]");
    if (make && game) { game.craft(make.dataset.craft!); render(); return; }
    const reforgeBtn = t.closest<HTMLElement>("[data-reforge]");
    if (reforgeBtn && game) { game.reforge(reforgeBtn.dataset.reforge!, { item: "iron-ingot", amount: 1 }); render(); return; }

    if (game) {
      // Pack filters / sort (must run before generic detail toggle).
      const filt = t.closest<HTMLElement>("[data-pack-filter]");
      if (filt) {
        packFilter = filt.dataset.packFilter as typeof packFilter;
        render();
        return;
      }
      const sortBtn = t.closest<HTMLElement>("[data-pack-sort]");
      if (sortBtn) {
        packSort = sortBtn.dataset.packSort as typeof packSort;
        render();
        return;
      }

      // Actions before detail — quick W/U/D live inside the row.
      const wear = t.closest<HTMLElement>("[data-wear]");
      const off = t.closest<HTMLElement>("[data-off]");
      const use = t.closest<HTMLElement>("[data-use]");
      const drop = t.closest<HTMLElement>("[data-drop]");
      const form = t.closest<HTMLElement>("[data-form]");
      if (form) {
        const selected = form.dataset.form === "natural" ? null : form.dataset.form!;
        if (game.transform(selected)) setScreen(game.pendingChoices ? "levelup" : "play");
        render();
        return;
      }
      if (wear) { game.wear(wear.dataset.wear!); render(); return; }
      if (off) { game.remove(off.dataset.off as Slot); render(); return; }
      if (drop) { game.drop(drop.dataset.drop!); render(); return; }
      if (use) { game.use(use.dataset.use!); setScreen("play"); return; }

      const detail = t.closest<HTMLElement>("[data-detail]");
      if (detail) {
        const id = detail.dataset.detail!;
        if (id) packDetail = packDetail === id ? null : id;
        render();
        return;
      }
      if (t.closest("[data-detail-close]")) { packDetail = null; render(); return; }
    }
    if (t.closest("[data-reroll]") && game?.reroll()) { render(); return; }
    const card = t.closest<HTMLElement>("[data-choice]");
    if (card && game?.pendingChoices) {
      game.chooseUpgrade(Number(card.dataset.choice));
      // There may be another level waiting behind this one, and leaving the
      // screen would strand it: the game stops taking input while a choice is
      // pending, so it would look frozen.
      setScreen(game.pendingChoices ? "levelup" : "play");
      return;
    }
    if (t.id === "save-memorial") {
      if (game) {
        const st = document.getElementById("memorial-status");
        if (st) st.textContent = "Saving memorial PNG to your Downloads folder…";
        void downloadMemorial(game, reg, atlas).then(() => {
          if (st) st.textContent = "Memorial PNG saved to your Downloads folder.";
        }).catch((err) => {
          console.warn("Memorial PNG failed", err);
          if (st) st.textContent = "Could not save the memorial image.";
          game!.log("Could not save the memorial image.", "warn");
        });
      }
      return;
    }
    if (t.id === "load-last") {
      const last = mostRecentSave();
      if (last) {
        game = loadGame(reg, last.file);
        game.movementHint = movementHint(bindings);
        game.onAutosave = autosave;
        (window as unknown as { turbz: unknown }).turbz = { game, reg, atlas, render };
        game.log("You take up where you left off.", "good");
        setScreen("play");
        resize();
      }
      return;
    }
    if (t.id === "again") { game = null; memorialSavedForDeath = false; setScreen("class-select"); }
    if (t.id === "anyway") { setScreen("class-select"); }
    // Not closable while a choice is pending: dismissing it would freeze the
    // game with an unspent level and no way back to it.
    if (t.id === "close-overlay" && !game?.pendingChoices) { setScreen(game ? "play" : "class-select"); }
  });

  // Typing in the wiki search box filters as you go.
  document.addEventListener("input", (e) => {
    const box = e.target as HTMLInputElement;
    if (box?.id !== "wiki-search") return;
    wikiQuery = box.value;
    render();
  });

  // Draw the title screen once at startup. Building the class cards is what
  // attaches the QuickStart and Begin handlers, so without this call the game
  // sits on a title screen where nothing responds.
  // The window is resizable, in the browser and in the Tauri window alike.
  // The canvas is measured in CSS pixels, so without this it keeps drawing at
  // the size it happened to have when the run started.
  window.addEventListener("resize", resize);
  if (screen === "problems") setScreen("problems");
  resize();


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

/**
 * Split a `prefix:rest` data attribute on its FIRST colon only.
 *
 * Several ids packed into data attributes (quest ids, recipe skills) contain
 * colons of their own, so a plain `.split(":")` loses everything past the second
 * segment. The prefix here is always an actor id, which has none.
 */
function splitFirst(s: string): [string, string] {
  const i = s.indexOf(":");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/**
 * For a value going into an attribute.
 *
 * The same escaping as `escapeHtml`, named separately so it is obvious at the
 * call site that the result is going inside quotes rather than between tags —
 * an id with a quote in it would otherwise end the attribute early.
 */
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

}
