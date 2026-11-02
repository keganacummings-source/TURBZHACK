/**
 * A village's market: what it has, what it wants, and what it will pay.
 *
 * The state is small on purpose — a stock ratio per good, and the turn it was
 * last touched. Everything else is computed. A village is not simulated between
 * visits; its stock simply drifts back towards what its trade would normally
 * carry, worked out from the gap in turns when you next look at it. That is the
 * difference between a world that pretends to be alive and one that costs
 * nothing to leave alone.
 */
import {
  DRIFT_PER_TURN, STOCK_CEILING, STOCK_FLOOR, TRADE, afterTrade, baseStock, drift,
  priceOf, stockWord, type VillageTrade,
} from "../world/economy.ts";
import type { ItemDef } from "../content/schema.ts";

export type Market = {
  /** Item id -> how much of it there is, as a multiple of normal. */
  stock: Record<string, number>;
  /** The turn the stock was last brought up to date. */
  asOf: number;
  /** How much trade it absorbs before prices move. */
  depth: number;
  /** The village's trade, which decides what it normally carries. */
  trade: VillageTrade;
};

export function newMarket(trade: VillageTrade, depth: number, turn: number): Market {
  return { stock: {}, asOf: turn, depth, trade };
}

/**
 * How much of a good this village has right now.
 *
 * Lazily created and lazily drifted: a good nobody has traded has exactly its
 * baseline, and one that has been traded is pulled back towards that baseline by
 * however many turns have passed. Doing it on read rather than on a tick means
 * nine villages cost nothing while you are in a dungeon.
 */
export function stockOf(market: Market, item: string, turn: number): number {
  const base = baseStock(market.trade, item);
  const held = market.stock[item];
  if (held === undefined) return base;
  return drift(held, base, Math.max(0, turn - market.asOf));
}

/** Bring the whole market up to date, which is only needed before writing to it. */
export function settle(market: Market, turn: number): void {
  const elapsed = Math.max(0, turn - market.asOf);
  if (!elapsed) return;
  for (const [item, held] of Object.entries(market.stock)) {
    const base = baseStock(market.trade, item);
    const now = drift(held, base, elapsed);
    // Forget anything that has drifted all the way home, so the record does not
    // grow by one entry per good ever traded for the length of a run.
    if (Math.abs(now - base) < 0.01) delete market.stock[item];
    else market.stock[item] = now;
  }
  market.asOf = turn;
}

export type Quote = {
  item: string;
  name: string;
  buy: number;
  sell: number;
  stock: number;
  /** "glut", "plenty", "steady", "short", "desperate". */
  mood: string;
  /** Whether the village is actively interested in this. */
  wanted: boolean;
  produced: boolean;
};

export function quote(
  market: Market, def: ItemDef, turn: number, haggle: number,
): Quote {
  const item = String(def.id);
  const stock = stockOf(market, item, turn);
  const profile = TRADE[market.trade];
  // A market town takes a cut on top of the ordinary spread: it buys anything,
  // which is a service, and services are not free.
  const cut = market.trade === "market" ? 0.05 : 0;
  const { buy, sell } = priceOf(def, stock, haggle, cut);
  return {
    item, name: def.name ?? item, buy, sell, stock,
    mood: stockWord(stock),
    wanted: profile.wants.includes(item),
    produced: profile.produces.includes(item),
  };
}

/**
 * Record that goods changed hands.
 *
 * `amount` is positive when the village gained them — that is, when the player
 * sold. Buying a village out of something raises its price; selling into it
 * lowers what it will pay next time. Both of those are the point.
 */
export function trade(market: Market, item: string, amount: number, turn: number): void {
  settle(market, turn);
  const now = afterTrade(stockOf(market, item, turn), amount, market.depth);
  market.stock[item] = Math.max(STOCK_FLOOR, Math.min(STOCK_CEILING, now));
}

/**
 * Everything this village deals in, for the trade screen.
 *
 * A village deals in what it produces, what it wants, whatever its NPCs carry,
 * and — for a market town — everything. Ordered so the interesting rows are at
 * the top: what it is desperate for first, since that is where the money is.
 */
export function stall(
  market: Market, items: Map<string, ItemDef>, extra: string[], turn: number, haggle: number,
): Quote[] {
  const profile = TRADE[market.trade];
  const ids = market.trade === "market"
    ? [...items.keys()].filter((id) => (items.get(id)?.weight_find ?? 10) > 0 || items.get(id)?.slot === "material")
    : [...new Set([...profile.produces, ...profile.wants, ...extra])];

  const quotes = ids
    .map((id) => items.get(id))
    .filter((def): def is ItemDef => !!def && !def.unique)
    .map((def) => quote(market, def, turn, haggle));

  return quotes.sort((a, b) => {
    if (a.wanted !== b.wanted) return a.wanted ? -1 : 1;
    if (a.produced !== b.produced) return a.produced ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The drift rate, exported so the wiki can explain it honestly. */
export const DRIFT = DRIFT_PER_TURN;
