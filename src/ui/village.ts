/**
 * The village screen: trading, talking, and taking work.
 *
 * Markup only, like the rest of the UI — every control carries a `data-`
 * attribute and the app routes clicks centrally.
 *
 * The thing this screen has to get right is making a PRICE DIFFERENCE visible.
 * A trade economy where the player has to keep a notebook is a trade economy
 * nobody uses, so every row says what this village thinks of the good as well as
 * what it costs: "desperate" next to a number is the whole game.
 */
import type { Game } from "../game.ts";
import type { Actor } from "../engine/actor.ts";
import type { Quote } from "../engine/market.ts";
import { TRADE } from "../world/economy.ts";
import { describe } from "../engine/equipment.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

/** How a village feels about you, in words. */
function standingWord(n: number): string {
  if (n >= 30) return "they would put you up for the night";
  if (n >= 15) return "well thought of";
  if (n >= 5) return "known here";
  if (n > -1) return "a stranger";
  if (n > -5) return "they have heard about you";
  return "not welcome";
}

/**
 * The market.
 *
 * `mine` is what you are carrying, so the sell column only shows rows you can
 * actually sell — a price list for things you do not have is a price list.
 */
export function marketHtml(game: Game, index: number): string {
  const village = game.continent.villages[index];
  if (!village) return "";
  const profile = TRADE[village.trade];
  const quotes = game.stallAt(index);
  const standing = game.standing.get(index) ?? 0;

  const row = (q: Quote) => {
    const def = game.reg.items.get(q.item);
    if (!def) return "";
    const have = game.countOf(q.item);
    return `<tr class="${q.wanted ? "wants" : q.produced ? "makes" : ""}">
      <td>${def.sprite ? `<img src="assets/tiles16/${esc(def.sprite)}.png" alt="" width="18" height="18">` : ""}</td>
      <td>${esc(q.name)}</td>
      <td class="mood mood-${esc(q.mood)}">${esc(q.mood)}</td>
      <td class="price">${q.buy}</td>
      <td>${game.coin >= q.buy ? `<button data-buy="${index}:${esc(q.item)}">buy</button>` : `<span class="dim">—</span>`}</td>
      <td class="price">${q.sell}</td>
      <td>${have
        ? `<button data-sell="${index}:${esc(q.item)}">sell</button>${
            have > 1 ? ` <button data-sell-all="${index}:${esc(q.item)}">all ${have}</button>` : ""}`
        : `<span class="dim">—</span>`}</td>
      <td class="choice-detail">${esc(describe(def))}</td>
    </tr>`;
  };

  return `
    <h2>${esc(village.name)}</h2>
    <p class="dim">${esc(profile.name)} — ${esc(profile.about)}</p>
    <p class="dim">You have <strong>${game.coin}</strong> coin · ${esc(standingWord(standing))}${
      standing ? ` (${standing > 0 ? "+" : ""}${standing})` : ""}</p>
    <table class="pack-table market">
      <tr class="dim">
        <th></th><th>Good</th><th>Here</th><th>Buy</th><th></th><th>Sell</th><th></th><th></th>
      </tr>
      ${quotes.map(row).join("")}
    </table>
    ${routesBlock(game, index)}
    <p class="dim">
      A village sells what it has too much of and pays well for what it is short of.
      Carry the difference and the difference is yours.
    </p>`;
}

/**
 * Where what you are carrying would sell for more.
 *
 * Only shows up once you have been to more than one market, because it is built
 * from the ones you have actually seen — a route to a place you have never
 * visited would be a spoiler rather than a tip.
 */
function routesBlock(game: Game, index: number): string {
  const routes = game.bestRoutes(index);
  if (!routes.length) return "";
  return `<h3>Worth carrying elsewhere</h3>
    <table class="pack-table">
      ${routes.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td class="dim">sells here for ${r.here}</td>
        <td>→ ${esc(r.toName)} for <span class="price">${r.to}</span></td>
        <td class="good-text">+${r.profit} each</td>
      </tr>`).join("")}
    </table>`;
}

/**
 * A conversation.
 *
 * One screen rather than a tree: greeting, whatever this person can do for you,
 * their work, and their gossip. A dialogue tree would be more theatre and less
 * information, and the information is what a player comes back for.
 */
export function talkHtml(game: Game, who: Actor): string {
  const npcId = String(who.data["npc"] ?? "");
  const npc = game.reg.npcs.get(npcId);
  const index = who.data["village"] as number | undefined;
  if (!npc || index === undefined) return `<p class="dim">${esc(who.name)} has nothing to say.</p>`;

  const village = game.continent.villages[index];
  const offered = game.questsFrom(who);
  const owed = game.questLines().filter((l) => l.quest.village === index && l.done);
  const seed = game.turn + who.id.length;
  const greeting = npc.greetings?.length
    ? npc.greetings[seed % npc.greetings.length] ?? "..."
    : "...";
  const gossip = npc.gossip?.length
    ? npc.gossip[(seed * 7) % npc.gossip.length] ?? null
    : null;

  const teaches = (npc.teaches ?? []).map((t) => {
    const at = game.skillLevel(t.skill);
    const price = Math.round(t.price * (1 + at * 0.08));
    return `<tr>
      <td>${esc(skillName(t.skill))}</td>
      <td class="dim">at ${at}</td>
      <td class="price">${price}</td>
      <td>${game.coin >= price
        ? `<button data-train="${who.id}:${esc(t.skill)}">train</button>`
        : `<span class="dim">not enough coin</span>`}</td>
    </tr>`;
  }).join("");

  return `
    <h2>${esc(who.name)}</h2>
    <p>${esc(greeting)}</p>
    ${village ? `<p class="dim">${esc(village.name)} · ${esc(TRADE[village.trade].name)}</p>` : ""}

    ${owed.length ? `<h3>Finished work</h3>
      <ul class="wiki-list">${owed.map((l) => `<li>${esc(l.quest.ask)}</li>`).join("")}</ul>
      <p><button data-handin="${who.id}">Hand it in</button></p>` : ""}

    ${offered.length ? `<h3>Work</h3>
      <table class="pack-table">${offered.map((q) => `<tr>
        <td>${esc(q.ask)}</td>
        <td class="price">${q.pay}</td>
        <td><button data-accept="${who.id}:${esc(q.id)}">take it</button></td>
      </tr>`).join("")}</table>` : ""}

    ${teaches ? `<h3>Training</h3>
      <p class="dim">A point of practice, and the next one costs more.</p>
      <table class="pack-table">${teaches}</table>` : ""}

    ${index !== undefined && (npc.role === "trader" || npc.role === "smith"
      || npc.role === "alchemist" || npc.role === "stablemaster")
      ? `<p><button data-market="${index}">See what they have</button></p>` : ""}

    ${gossip ? `<h3>Talk</h3><p class="dim">“${esc(gossip)}”</p>` : ""}
    <p class="dim">Esc closes.</p>`;
}

/** A skill id as a person would say it. */
export function skillName(skill: string): string {
  if (skill.startsWith("weapon-")) return `${skill.slice(7)} work`;
  if (skill.startsWith("recipe:")) return `recipe: ${skill.slice(7).replace(/-/g, " ")}`;
  return skill;
}

/** The quest log. */
export function questsHtml(game: Game): string {
  const lines = game.questLines();
  if (!lines.length) {
    return `<h2>Work</h2>
      <p class="dim">Nothing taken. Villagers have work — right-click one and talk to them.</p>
      <p class="dim">Esc closes.</p>`;
  }
  return `<h2>Work</h2>
    <table class="pack-table">
      ${lines.map((l) => `<tr class="${l.done ? "quest-done" : ""}">
        <td>${esc(l.quest.ask)}</td>
        <td class="dim">${esc(l.where)}</td>
        <td>${esc(l.progress)}</td>
        <td class="price">${l.quest.pay}</td>
        <td>${l.done
          ? `<span class="good-text">ready</span>`
          : `<button data-abandon="${esc(l.quest.id)}">give up</button>`}</td>
      </tr>`).join("")}
    </table>
    <p class="dim">Finished work is handed in to the village that set it. Esc closes.</p>`;
}
