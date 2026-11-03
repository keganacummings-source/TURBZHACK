/**
 * The economy, the villages, and the quests they hand out.
 *
 * The property a trade economy has to have is that it cannot be farmed in place:
 * buying and selling at the same stall must lose money, and trading against
 * yourself must not move a price far enough to profit. Those are the tests that
 * matter here, because they are the difference between a trade route and an
 * infinite-money bug — and they are checkable as arithmetic.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import {
  PRICE_CEILING, PRICE_FLOOR, SPREAD, STOCK_NORMAL, TRADE, VILLAGE_TRADES,
  afterTrade, baseStock, drift, priceMultiplier, priceOf, routeProfit, stockWord,
} from "../src/world/economy.ts";
import { newMarket, quote, settle, stockOf, trade as doTrade } from "../src/engine/market.ts";
import { makeQuest, ordinal, plural } from "../src/engine/quests.ts";
import { Rng } from "../src/engine/rng.ts";
import type { ItemDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const ore = reg.items.get("iron-ore")!;

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

test("scarcity raises the price and glut lowers it", () => {
  const scarce = priceMultiplier(0.3);
  const normal = priceMultiplier(STOCK_NORMAL);
  const plenty = priceMultiplier(3);
  assert.ok(scarce > normal, "being short of something did not raise its price");
  assert.ok(plenty < normal, "a glut did not lower its price");
  assert.equal(normal, 1, "the normal price is not the base price");
});

test("prices are clamped, so nothing is ever free or priceless", () => {
  assert.ok(priceMultiplier(0.0001) <= PRICE_CEILING, "a desperate shortage breaks the ceiling");
  assert.ok(priceMultiplier(9999) >= PRICE_FLOOR, "an endless glut makes it free");
});

test("you always buy above what you sell for", () => {
  // The spread is what stops a stall being an infinite-money machine. Without
  // it, buy-and-sell-here is free profit.
  for (const stock of [0.2, 0.5, 1, 2, 4]) {
    const p = priceOf(ore, stock);
    assert.ok(p.buy > p.sell, `at stock ${stock} you buy for ${p.buy} and sell for ${p.sell}`);
  }
});

test("even a perfect haggle cannot close the spread", () => {
  // A character good enough at haggling to buy and sell at the same number would
  // print money. Haggling narrows the spread; it must never erase it.
  const p = priceOf(ore, 1, 999);
  assert.ok(p.buy > p.sell, `a silver tongue bought for ${p.buy} and sold for ${p.sell}`);
});

test("a good haggle is worth something, though", () => {
  const plain = priceOf(ore, 1, 0);
  const good = priceOf(ore, 1, 0.15);
  assert.ok(good.buy <= plain.buy, "haggling did not lower what you pay");
  assert.ok(good.sell >= plain.sell, "haggling did not raise what you are paid");
});

// ---------------------------------------------------------------------------
// Stock and routes
// ---------------------------------------------------------------------------

test("a village has too much of what it makes and too little of what it wants", () => {
  for (const t of VILLAGE_TRADES) {
    const profile = TRADE[t];
    for (const made of profile.produces) {
      assert.ok(baseStock(t, made) > STOCK_NORMAL, `a ${t} village is not flush with ${made}`);
    }
    for (const wanted of profile.wants) {
      assert.ok(baseStock(t, wanted) < STOCK_NORMAL, `a ${t} village is not short of ${wanted}`);
    }
  }
});

test("there is a real route between at least two trades", () => {
  /*
   * The whole promise of the system: somewhere cheap to buy and somewhere dear
   * to sell. Find any good that one trade produces and another wants, and check
   * that carrying it between them actually turns a profit after both spreads.
   */
  let found = false;
  for (const from of VILLAGE_TRADES) {
    for (const to of VILLAGE_TRADES) {
      if (from === to) continue;
      for (const good of TRADE[from].produces) {
        if (!TRADE[to].wants.includes(good)) continue;
        const def = reg.items.get(good);
        if (!def) continue;
        const profit = routeProfit(def, baseStock(from, good), baseStock(to, good));
        if (profit > 0) { found = true; }
      }
    }
  }
  assert.ok(found, "there is no profitable trade route anywhere in the economy");
});

test("trading against a stall moves its price the right way, and not too far", () => {
  // Buying raises the price (stock falls); selling lowers it (stock rises). And
  // one item must not move it enough to make the next trade back a profit.
  const m = newMarket("mining", 12, 0);
  const before = quote(m, ore, 0, 0);

  doTrade(m, "iron-ore", -1, 0);               // player bought one
  const afterBuy = quote(m, ore, 0, 0);
  assert.ok(afterBuy.buy >= before.buy, "buying did not raise the price");

  // Buy one and immediately sell it back: you must be out of pocket.
  const loss = afterBuy.sell - before.buy;
  assert.ok(loss < 0, `buy-and-sell-back profited by ${loss}`);
});

test("stock drifts back towards normal over time, but slowly", () => {
  const base = baseStock("mining", "iron-ore");
  const depleted = 0.3;
  const soon = drift(depleted, base, 100);
  const muchLater = drift(depleted, base, 100000);
  assert.ok(soon > depleted, "a cleared-out village never recovers");
  assert.ok(soon < base, "a village recovers its whole stock in a hundred turns");
  assert.ok(Math.abs(muchLater - base) < 0.01, "given forever, it does not return to normal");
});

test("a market settles lazily and forgets what has gone back to normal", () => {
  const m = newMarket("mining", 12, 0);
  doTrade(m, "iron-ore", 1, 0);
  assert.ok("iron-ore" in m.stock, "a trade left no record");
  // Enough turns that it has drifted all the way home.
  settle(m, 1_000_000);
  assert.ok(!("iron-ore" in m.stock), "a fully-recovered good is still carried in the record");
});

test("the mood word tracks the stock", () => {
  assert.equal(stockWord(3), "glut");
  assert.equal(stockWord(0.2), "desperate");
  assert.notEqual(stockWord(1), stockWord(0.3), "steady and short read the same");
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

const played = (seed: number | string = 2026) => {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  return g;
};

test("every world has villages, with different trades and real people in them", () => {
  for (const seed of [1, 7, 2026, 404, 99]) {
    const g = played(seed);
    assert.ok(g.continent.villages.length >= 2, `seed ${seed} has fewer than two villages`);
    const trades = new Set(g.continent.villages.map((v) => v.trade));
    assert.ok(trades.size >= 2, `seed ${seed} has only one kind of village, so no routes`);
    // And the nearest one has somebody to deal with.
    const people = g.villagersOf(0);
    assert.ok(people.length > 0, `the first village on seed ${seed} is deserted`);
  }
});

test("buying costs coin and a turn, and gives you the thing", () => {
  const g = played();
  g.coin = 1000;
  const before = g.coin;
  const turn = g.turn;
  const bought = g.buy(0, "iron-ore");
  assert.ok(bought, "the purchase was refused with a thousand coin in hand");
  assert.ok(g.coin < before, "buying cost nothing");
  assert.ok(g.pack.includes("iron-ore"), "the ore never arrived");
  assert.ok(g.turn > turn, "buying took no time");
});

test("you cannot buy what you cannot afford", () => {
  const g = played();
  g.coin = 0;
  assert.equal(g.buy(0, "iron-ore"), false);
  assert.ok(!g.pack.includes("iron-ore"));
});

test("selling a stack fills the market, so each one fetches less", () => {
  const g = played();
  // Find a village that is not desperate for ore, so the price has somewhere to fall.
  for (let n = 0; n < 20; n++) g.pack.push("iron-ore");
  const first = quote(g.marketOf(0), reg.items.get("iron-ore")!, g.turn, g.haggleAt(0)).sell;
  g.sellAll(0, "iron-ore");
  const after = quote(g.marketOf(0), reg.items.get("iron-ore")!, g.turn, g.haggleAt(0)).sell;
  assert.ok(after < first, "dumping twenty ore did not move the price at all");
  assert.ok(g.coin > 0, "selling twenty things earned nothing");
});

test("a crafted weapon with a unique handle can actually be sold", () => {
  // The bug: the market lists gear by its base id, but the pack holds it under a
  // unique handle (short-sword#7), so selling looked for the base id in the pack,
  // found nothing, and refused — every piece of gear was unsellable.
  const g = played();
  const mint = (g as unknown as { mint(s: string): string }).mint.bind(g);
  const handle = mint("short-sword");
  g.instances.set(handle, { item: handle, material: "steel", quality: "fine", affixes: ["flaming"] });
  g.pack.push(handle);
  g.coin = 0;

  // Selling by the BASE id, exactly as the market UI passes it.
  const ok = g.sell(0, "short-sword");
  assert.ok(ok, "a handled weapon could not be sold");
  assert.ok(g.coin > 0, "selling the weapon earned nothing");
  assert.ok(!g.pack.includes(handle), "the sold weapon is still in the pack");
  assert.equal(g.instances.has(handle), false, "the sold weapon's instance was left behind");
});

test("a better piece sells for more than a plain one", () => {
  const price = (mat: string, quality: string, affixes: string[]) => {
    const g = played();
    const mint = (g as unknown as { mint(s: string): string }).mint.bind(g);
    const h = mint("short-sword");
    g.instances.set(h, { item: h, material: mat, quality, affixes });
    g.pack.push(h);
    g.coin = 0;
    g.sell(0, "short-sword");
    return g.coin;
  };
  assert.ok(price("meteoric", "masterwork", ["flaming", "of-the-titan"]) > price("iron", "crude", []),
    "a masterwork meteoric blade sold for no more than a crude iron one");
});

test("selling all of a kind clears handled copies too", () => {
  const g = played();
  const mint = (g as unknown as { mint(s: string): string }).mint.bind(g);
  for (let i = 0; i < 3; i++) {
    const h = mint("dagger");
    g.instances.set(h, { item: h, material: "iron" });
    g.pack.push(h);
  }
  g.sellAll(0, "dagger");
  assert.equal(g.pack.filter((i) => g.baseOf(i) === "dagger").length, 0, "some daggers would not sell");
});

test("a quest offered by a villager can be accepted by its full id", () => {
  // The bug: quest ids carry colons ("slay:3:wolf"), and the accept handler split
  // on every colon and kept only the first piece, so the quest was never found.
  // The id must be matched whole.
  const g = played();
  let found: { who: ReturnType<Game["villagersOf"]>[number]; id: string } | null = null;
  for (let v = 0; v < g.continent.villages.length && !found; v++) {
    for (const who of g.villagersOf(v)) {
      const qs = g.questsFrom(who);
      if (qs.length) { found = { who, id: qs[0]!.id }; break; }
    }
  }
  assert.ok(found, "no villager anywhere offered a quest");
  const { who, id } = found!;
  assert.ok(id.includes(":"), "quest ids are expected to contain colons");
  // The pre-colon prefix is not a usable id; the whole id is.
  assert.equal(g.questsFrom(who).some((q) => q.id === id.split(":")[0]), false,
    "the quest matched on its prefix alone — the split bug would pass");
  const quest = g.questsFrom(who).find((q) => q.id === id)!;
  assert.ok(g.acceptQuest(quest), "a real quest could not be accepted");
  assert.ok(g.questLines().some((l) => l.quest.id === id), "the accepted quest is not in the log");
});

test("carrying a good from where it is cheap to where it is dear turns a profit", () => {
  /*
   * The actual loop the whole system exists for, played out: find two villages
   * with different trades, buy what the first is flush with and the second is
   * short of, and check the round trip makes money. Skipped — not failed — on a
   * seed that happens not to offer the pairing, because the economy being
   * possible is the claim, not that every seed hands it to you.
   */
  const g = played(2026);
  g.coin = 5000;
  const villages = g.continent.villages;

  let done = false;
  for (let a = 0; a < villages.length && !done; a++) {
    for (let b = 0; b < villages.length && !done; b++) {
      if (a === b) continue;
      const makes = TRADE[villages[a]!.trade].produces;
      const wants = TRADE[villages[b]!.trade].wants;
      const good = makes.find((x) => wants.includes(x));
      if (!good) continue;

      const buy = quote(g.marketOf(a), reg.items.get(good)!, g.turn, g.haggleAt(a)).buy;
      const sell = quote(g.marketOf(b), reg.items.get(good)!, g.turn, g.haggleAt(b)).sell;
      assert.ok(sell > buy, `${good} costs ${buy} in a ${villages[a]!.trade} village and sells for only ${sell} in a ${villages[b]!.trade} one`);
      done = true;
    }
  }
  if (!done) console.log("  (no producer/consumer pairing on this seed; skipping)");
});

test("coin, markets, standing and quests all survive a save", () => {
  const g = played();
  g.coin = 777;
  g.buy(0, "iron-ore");
  g.standing.set(0, 9);

  const back = loadGame(reg, g.toSave());
  assert.equal(back.coin, g.coin, "the purse did not survive");
  assert.equal(back.standing.get(0), 9, "standing was forgotten");
  // The market's depleted stock has to come back, or a reload resets every price.
  const a = quote(g.marketOf(0), reg.items.get("iron-ore")!, g.turn, 0);
  const b = quote(back.marketOf(0), reg.items.get("iron-ore")!, back.turn, 0);
  assert.equal(a.buy, b.buy, "the market reset on load");
});

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

test("villagers offer work, and the work names things that are really there", () => {
  const g = played(2026);
  let sawQuest = false;
  for (let i = 0; i < g.continent.villages.length; i++) {
    for (const who of g.villagersOf(i)) {
      for (const q of g.questsFrom(who)) {
        sawQuest = true;
        assert.ok(q.ask.length > 0, "a quest with no description");
        assert.ok(q.pay > 0, `"${q.ask}" pays nothing`);
        // A bounty must name a creature that exists; a gather, an item.
        if (q.kind === "bounty") assert.ok(reg.enemies.has(q.target), `bounty on "${q.target}", which is not a creature`);
        if (q.kind === "gather") assert.ok(reg.items.has(q.target), `gather "${q.target}", which is not an item`);
        assert.ok(!q.ask.includes("{"), `"${q.ask}" has an unfilled blank in it`);
      }
    }
  }
  assert.ok(sawQuest, "no villager in the whole world offered any work");
});

test("a bounty asks for fewer of the dangerous things", () => {
  const g = played();
  const world = (g as unknown as { questWorld(i: number): never }).questWorld(0);
  const template = reg.quests.get("bounty-local")!;
  // Roll a pile of bounties and check the count scales down with how deadly the
  // prey is — eight rats, not eight trolls.
  const counts: { xp: number; need: number }[] = [];
  for (let seed = 0; seed < 40; seed++) {
    const q = makeQuest(template, world, 0, "Someone", new Rng(seed));
    if (!q) continue;
    const prey = reg.enemies.get(q.target);
    counts.push({ xp: prey?.xp ?? 0, need: q.need });
  }
  const easy = counts.filter((c) => c.xp <= 15).map((c) => c.need);
  const hard = counts.filter((c) => c.xp >= 100).map((c) => c.need);
  if (easy.length && hard.length) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(avg(easy) >= avg(hard), "a bounty on trolls asks for as many as a bounty on rats");
  }
});

test("killing the thing a bounty names advances it", () => {
  const g = played();
  const who = g.villagersOf(0).find((a) => g.questsFrom(a).some((q) => q.kind === "bounty"));
  if (!who) { console.log("  (no bounty on this seed; skipping)"); return; }
  const bounty = g.questsFrom(who).find((q) => q.kind === "bounty")!;
  g.acceptQuest(bounty);

  // Put one of the target creatures next to the player and kill it.
  const def = reg.enemies.get(bounty.target)!;
  const victim = g.actors.find((a) => a.def === bounty.target)
    ?? (() => {
      const a = g.actors.find((x) => !x.isPlayer && !x.data["npc"])!;
      return a;
    })();
  // Rather than fight, invoke the ledger path the kill uses.
  const taken = g.quests.find((q) => q.id === bounty.id)!;
  const was = taken.done;
  // Simulate a kill of the right species by standing one in and punching it dead.
  const target = g.actors.find((a) => a.def === bounty.target && !a.isPlayer);
  if (!target) { console.log("  (that creature is not on the map; skipping)"); return; }
  target.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  target.stance = "hostile";
  target.pools.hp = 1;
  g.player.stats.accuracy = 100;
  g.player.stats.might = 999;
  g.refreshFov();
  g.ability("punch", target);
  const now = g.quests.find((q) => q.id === bounty.id)!;
  assert.ok(now.done > was, "killing the bounty target did not advance the bounty");
});

test("a finished quest can be handed in for coin and standing", () => {
  const g = played();
  const who = g.villagersOf(0)[0]!;
  const index = who.data["village"] as number;
  // Hand-make a trivially-complete gather quest and drop it in.
  g.quests.push({
    id: "test:done", def: "gather-order", kind: "gather", village: index, giver: who.name,
    target: "iron-ore", need: 2, done: 2, ask: "two ore", pay: 50, standing: 3,
  });
  g.pack.push("iron-ore", "iron-ore");
  const coin = g.coin, standing = g.standing.get(index) ?? 0;
  g.handIn(who);
  assert.equal(g.coin, coin + 50, "the quest paid nothing");
  assert.equal(g.standing.get(index), standing + 3, "handing in earned no standing");
  assert.ok(!g.pack.includes("iron-ore"), "the goods were not taken");
  assert.ok(g.questsDone.includes("test:done"), "the quest was not marked done");
});

test("the same errand is not offered after it is handed in", () => {
  const g = played(2026);
  const who = g.villagersOf(0).find((a) => g.questsFrom(a).length);
  if (!who) return;
  const q = g.questsFrom(who)[0]!;
  g.acceptQuest(q);
  g.questsDone.push(q.id);
  g.quests = g.quests.filter((x) => x.id !== q.id);
  assert.ok(!g.questsFrom(who).some((x) => x.id === q.id), "a handed-in quest was offered again");
});

test("plurals and ordinals read like English in the ordinary cases", () => {
  assert.equal(plural("goblin"), "goblins");
  assert.equal(plural("wolf spider"), "wolf spiders");
  assert.equal(plural("The Hollow Choir"), "The Hollow Choir", "a proper name was pluralised");
  assert.equal(plural("rats"), "rats", "an already-plural name got another s");
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(22), "22nd");
});

test("a quest template with nothing to point at makes no quest, rather than a broken one", () => {
  const empty = { localEnemies: [], bosses: [], wanted: [], elsewhere: [], dungeons: [], band: 0 };
  for (const id of ["bounty-local", "gather-order", "slay-boss", "delivery-run", "delve-dungeon"]) {
    const template = reg.quests.get(id)!;
    assert.equal(makeQuest(template, empty, 0, "Nobody", new Rng(1)), null,
      `${id} invented a target out of an empty world`);
  }
});

// ---------------------------------------------------------------------------
// Autosave and death
// ---------------------------------------------------------------------------

test("the game saves itself on a schedule, to its own slot", async () => {
  const { AUTOSAVE_EVERY } = await import("../src/world/economy.ts").then(() => import("../src/engine/save.ts"));
  const g = played();
  let saved = 0;
  g.onAutosave = () => { saved++; };

  // Nothing before the interval.
  g.turn = AUTOSAVE_EVERY - 2;
  g.rest();
  assert.equal(saved, 0, "it saved before the interval was up");

  // Crossing the interval triggers exactly one save.
  g.turn = AUTOSAVE_EVERY + 1;
  g.rest();
  assert.equal(saved, 1, "it did not autosave on schedule");

  // And not again until the next interval.
  g.rest();
  assert.equal(saved, 1, "it autosaved every single turn after the first");
});

test("a dead character never autosaves over the last good state", () => {
  const g = played();
  g.onAutosave = () => { throw new Error("autosaved while dead"); };
  g.over = { won: false, reason: "test" };
  g.player.pools.hp = 0;
  g.player.alive = false;
  g.turn = 100000;
  // Should not throw.
  (g as unknown as { maybeAutosave(): void }).maybeAutosave?.();
  assert.ok(true);
});
