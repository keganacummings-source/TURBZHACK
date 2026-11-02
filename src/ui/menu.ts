/**
 * The Escape menu, the controls screen, and the save slots.
 *
 * These are markup only. Every button carries a `data-` attribute and the app
 * routes clicks centrally, which keeps the handler wiring in one place instead
 * of re-attaching listeners every time a screen redraws — the bug that produces
 * is a button that fires three times because the screen has been rendered three
 * times.
 */
import {
  ACTIONS, controlsText, keyLabel, type Bindings,
} from "./input.ts";
import { listSlots, SLOTS_AVAILABLE } from "../engine/save.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

/** The top-level menu. What is offered depends on whether a run is going. */
export function menuHtml(inRun: boolean): string {
  return `
    <h2>TURBZHACK</h2>
    <div class="menu">
      ${inRun ? `<button class="menu-item" data-menu="resume">Resume</button>` : ""}
      <button class="menu-item" data-menu="controls">Controls</button>
      ${inRun ? `<button class="menu-item" data-menu="save">Save</button>` : ""}
      <button class="menu-item" data-menu="load">Load</button>
      <button class="menu-item" data-menu="wiki">Wiki</button>
      <button class="menu-item" data-menu="designer">Texture designer</button>
      ${inRun ? `<button class="menu-item menu-warn" data-menu="abandon">Abandon the run</button>` : ""}
    </div>
    <p class="dim">Esc closes this.</p>`;
}

/**
 * The controls screen.
 *
 * Every key the game answers to, with every binding, and a button per binding to
 * take it off. `listening` is the action currently waiting for a keypress; while
 * it is set the app sends the next press here instead of to the game.
 */
export function controlsHtml(bindings: Bindings, listening: string | null): string {
  const groups = controlsText(bindings);
  return `
    <h2>Controls</h2>
    <p class="dim">Click <em>add a key</em> and then press one. A key only ever does one thing, so taking it from another action removes it there.</p>
    ${groups.map((g) => `
      <h3>${esc(g.group)}</h3>
      <table class="binds">
        ${g.rows.map((row) => `
          <tr class="${listening === row.id ? "listening" : ""}">
            <td class="bind-what">${esc(row.what)}</td>
            <td class="bind-keys">
              ${row.keys.length
                ? row.keys.map((k) => `<button class="keycap" data-unbind="${esc(row.id)}" data-key="${esc(k)}" title="Click to remove">${esc(keyLabel(k))}</button>`).join("")
                : `<span class="dim">unbound</span>`}
            </td>
            <td class="bind-add">
              ${listening === row.id
                ? `<span class="listening-note">press a key…</span> <button data-listen-cancel="1">cancel</button>`
                : `<button data-listen="${esc(row.id)}">add a key</button>`}
            </td>
          </tr>`).join("")}
      </table>`).join("")}
    <p><button data-menu="defaults">Put everything back to default</button>
       <button data-menu="back">Back</button></p>`;
}

/** Three save slots, with what is in them. */
export function savesHtml(mode: "save" | "load", inRun: boolean): string {
  const slots = listSlots();
  const when = (at: number) => {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} ago`;
  };

  return `
    <h2>${mode === "save" ? "Save" : "Load"}</h2>
    <table class="slots">
      ${SLOTS_AVAILABLE.map((n) => {
        const info = slots[n - 1];
        return `<tr>
          <td class="dim">Slot ${n}</td>
          <td>${info ? esc(info.label) : '<span class="dim">empty</span>'}</td>
          <td class="dim">${info ? when(info.at) : ""}</td>
          <td>
            ${mode === "save" && inRun ? `<button data-save="${n}">${info ? "Overwrite" : "Save here"}</button>` : ""}
            ${mode === "load" && info ? `<button data-load="${n}">Load</button>` : ""}
            ${info ? `<button data-erase="${n}">Erase</button>` : ""}
          </td>
        </tr>`;
      }).join("")}
    </table>
    <p class="dim">Saves live in this browser. Clearing site data clears them.</p>
    <p><button data-menu="back">Back</button></p>`;
}

/** Every action, for the test that the controls screen covers the key table. */
export const ALL_ACTION_IDS = ACTIONS.map((a) => a.id);
