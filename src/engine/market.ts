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

// ---------------------------------------------------------------------------
// Black market
// ---------------------------------------------------------------------------

/** Turns between full stock replacements. */
export const BLACK_MARKET_PERIOD = 500;

/** How many distinct listings a refresh stocks. */
export const BLACK_MARKET_SLOTS = 12;

export type BlackListing = {
  /** Base item id. */
  item: string;
  /** How many copies you can still buy. */
  qty: number;
  /**
   * Price multiplier on top of the normal buy price (illicit premium).
   * Typically 1.2–1.8 so the black market is useful but not free power.
   */
  premium: number;
};

export type BlackMarket = {
  listings: BlackListing[];
  /** Turn the current listings were rolled. */
  refreshedAt: number;
  /** Player level used for the last refresh (for the UI). */
  level: number;
};

export function newBlackMarket(turn = 0): BlackMarket {
  return { listings: [], refreshedAt: turn - BLACK_MARKET_PERIOD, level: 1 };
}

/**
 * Rough "gear tier" from an item's base value so the stall can track the
 * character's level. Consumables and materials sit on a flatter curve so food
 * and potions still appear early and late.
 */
export function itemTier(def: ItemDef): number {
  const v = itemValue(def);
  const slot = def.slot ?? "";
  if (slot === "food" || slot === "material" || slot === "potion" || slot === "scroll") {
    if (v < 15) return 1;
    if (v < 40) return 3;
    if (v < 80) return 6;
    return 10;
  }
  if (v < 18) return 1;
  if (v < 35) return 2;
  if (v < 55) return 4;
  if (v < 90) return 6;
  if (v < 140) return 8;
  if (v < 220) return 11;
  return 14;
}

/**
 * Whether this item is allowed on a black-market stall for a given level.
 * Keeps unique/quest junk out and bands gear around the character's level.
 */
export function blackMarketEligible(def: ItemDef, level: number): boolean {
  if (def.unique) return false;
  if ((def.weight_find ?? 10) <= 0 && def.slot !== "potion" && def.slot !== "food") {
    // Still allow crafted-only gear with no ground weight if it has a slot.
    if (!def.slot) return false;
  }
  const tier = itemTier(def);
  // Wide band early, tighter later: level 1 sees tiers 1–4, level 10 sees 6–14.
  const lo = Math.max(1, level - 2);
  const hi = level + 4 + Math.floor(level / 3);
  return tier >= lo && tier <= hi;
}

/**
 * Rebuild the black market's listings for the player's current level.
 *
 * Seeded from turn + level so a refresh is stable if you reopen the screen the
 * same turn, but genuinely new when the period elapses.
 */
export function refreshBlackMarket(
  bm: BlackMarket,
  level: number,
  items: Map<string, ItemDef>,
  turn: number,
  rng: { next(): number; int(n: number): number; pick<T>(list: readonly T[]): T | undefined; shuffled<T>(list: readonly T[]): T[] },
): void {
  const pool = [...items.values()].filter((d) => blackMarketEligible(d, level));
  const picks = rng.shuffled(pool).slice(0, BLACK_MARKET_SLOTS);
  bm.listings = picks.map((def) => {
    const id = String(def.id);
    const tier = itemTier(def);
    // Higher-tier relative to level costs more; junk on the stall is cheaper.
    const rel = tier - level;
    const premium = Math.max(1.15, Math.min(1.9, 1.35 + rel * 0.06 + rng.next() * 0.15));
    const qty = def.slot === "weapon" || def.slot === "body" || def.slot === "head"
      ? 1 + rng.int(2)
      : 2 + rng.int(4);
    return { item: id, qty, premium };
  });
  bm.refreshedAt = turn;
  bm.level = level;
}

/**
 * Ensure listings exist and are current. Refreshes when the period has elapsed
 * or when the character has outgrown the old stock by several levels.
 */
export function ensureBlackMarket(
  bm: BlackMarket,
  level: number,
  items: Map<string, ItemDef>,
  turn: number,
  rng: { next(): number; int(n: number): number; pick<T>(list: readonly T[]): T | undefined; shuffled<T>(list: readonly T[]): T[] },
): { refreshed: boolean } {
  const aged = turn - bm.refreshedAt >= BLACK_MARKET_PERIOD;
  const outgrown = level >= bm.level + 3 && bm.listings.length > 0;
  const empty = bm.listings.length === 0;
  if (aged || outgrown || empty) {
    refreshBlackMarket(bm, level, items, turn, rng);
    return { refreshed: true };
  }
  return { refreshed: false };
}

export type BlackQuote = {
  item: string;
  name: string;
  buy: number;
  sell: number;
  qty: number;
  premium: number;
  tier: number;
};

/** Priced rows for the black-market panel. */
export function blackStall(
  bm: BlackMarket,
  items: Map<string, ItemDef>,
  haggle: number,
): BlackQuote[] {
  const out: BlackQuote[] = [];
  for (const listing of bm.listings) {
    if (listing.qty <= 0) continue;
    const def = items.get(listing.item);
    if (!def) continue;
    // Stock treated as "short" so prices sit on the high side even before premium.
    const { buy: baseBuy, sell: baseSell } = priceOf(def, 0.5, haggle, 0.08);
    const buy = Math.max(1, Math.round(baseBuy * listing.premium));
    // Fence rate: better than a village glut, worse than a desperate want.
    const sell = Math.max(1, Math.round(baseSell * 1.15));
    out.push({
      item: listing.item,
      name: def.name ?? listing.item,
      buy,
      sell,
      qty: listing.qty,
      premium: listing.premium,
      tier: itemTier(def),
    });
  }
  return out.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}

/** Consume one listing unit after a successful buy. */
export function blackBuy(bm: BlackMarket, item: string): boolean {
  const row = bm.listings.find((l) => l.item === item && l.qty > 0);
  if (!row) return false;
  row.qty -= 1;
  return true;
}

/** Turns until the next forced refresh (0 = due now). */
export function blackMarketTurnsLeft(bm: BlackMarket, turn: number): number {
  return Math.max(0, BLACK_MARKET_PERIOD - (turn - bm.refreshedAt));
}
