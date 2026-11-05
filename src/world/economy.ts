/**
 * Prices, and why they differ from one village to the next.
 *
 * The whole point of a trade economy is that the same sack of iron ore is worth
 * different amounts in different places, and that the difference is legible
 * enough to plan around. So a village is not a shop with a price list — it is a
 * set of things it MAKES and a set of things it WANTS, and the price of
 * everything falls out of that.
 *
 * The model, deliberately small enough to hold in your head:
 *
 *   - Every good has a base value, from the item's own file.
 *   - A village that produces a good has too much of it, and sells it cheap.
 *   - A village that consumes a good has too little, and pays well for it.
 *   - Buying from a village depletes its stock, which raises its price; selling
 *     to one floods it, which lowers what it will pay. Both drift back towards
 *     normal over time.
 *   - What a village needs depends on what it does. A mining camp has ore and
 *     needs food; a farming village is the reverse. That is the route, and the
 *     player finds it by looking rather than by being told.
 *
 * None of this touches the rest of the game: prices are a pure function of a
 * village's stock, its trade profile and the item's base value, so the arithmetic
 * can be tested as arithmetic.
 */
import type { ItemDef } from "../content/schema.ts";
import { itemValue } from "../engine/weapons.ts";

/**
 * What a settlement does for a living.
 *
 * Each trade produces some goods and wants others. The overlaps are what make
 * routes: a Mining Camp's ore is a Smithing Town's raw material, and a Smithing
 * Town's tools are what a Mining Camp is short of.
 */
export const VILLAGE_TRADES = [
  "farming", "mining", "logging", "smithing", "herbalism", "fishing", "market",
] as const;

export type VillageTrade = (typeof VILLAGE_TRADES)[number];

export type TradeProfile = {
  name: string;
  /** What it has too much of, and sells cheap. */
  produces: string[];
  /** What it is short of, and pays well for. */
  wants: string[];
  /** Which biomes it is found in. */
  biomes: string[];
  about: string;
};

export const TRADE: Record<VillageTrade, TradeProfile> = {
  farming: {
    name: "Farming village",
    produces: ["dried-meat", "cap-mushroom", "bitterroot", "hide", "leather"],
    wants: ["iron-ingot", "stone-block", "pickaxe", "hatchet", "iron-ore"],
    biomes: ["plains", "savanna", "hills"],
    about: "Food, hides, and a permanent shortage of good iron.",
  },
  mining: {
    name: "Mining camp",
    produces: ["iron-ore", "silver-ore", "stone-block", "gemstone"],
    wants: ["dried-meat", "cap-mushroom", "wood", "hardwood", "potion-of-mending"],
    biomes: ["highland", "badlands", "hills"],
    about: "Ore by the barrow-load and nothing whatsoever to eat.",
  },
  logging: {
    name: "Logging camp",
    produces: ["wood", "hardwood", "glowcap"],
    wants: ["iron-ingot", "hatchet", "dried-meat", "ash-salt"],
    biomes: ["forest", "taiga"],
    about: "Timber, and an appetite for axes.",
  },
  smithing: {
    name: "Smithing town",
    produces: ["iron-ingot", "silver-ingot", "pickaxe", "hatchet", "short-sword", "helm", "shield"],
    wants: ["iron-ore", "silver-ore", "wood", "hardwood", "gemstone"],
    biomes: ["hills", "plains", "highland"],
    about: "Everything arrives as ore and leaves as something useful.",
  },
  herbalism: {
    name: "Herbalist's hamlet",
    produces: ["bitterroot", "frostleaf", "emberfruit", "glowcap", "potion-of-mending"],
    wants: ["silver-ingot", "gemstone", "cap-mushroom", "leather"],
    biomes: ["swamp", "forest", "taiga"],
    about: "Half of it is growing on the roofs.",
  },
  fishing: {
    name: "Fishing village",
    produces: ["dried-meat", "ash-salt", "hide"],
    wants: ["wood", "hardwood", "iron-ingot", "bitterroot"],
    biomes: ["beach", "swamp"],
    about: "Salt, and salt's worth of everything else.",
  },
  market: {
    name: "Market town",
    produces: [],
    wants: [],
    biomes: ["plains", "hills", "savanna", "forest"],
    about: "Buys anything, sells anything, and takes its cut of both.",
  },
};

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * How much of a good a village has, as a multiple of normal.
 *
 * 1 is "the usual amount". A producer sits above it and a consumer below, and
 * trading moves it. Expressed as a ratio rather than a count because what matters
 * to a price is the relationship between supply and demand, not the absolute
 * number of sacks — and because a count would need the village to be simulated
 * between visits, which this deliberately does not do.
 */
export const STOCK_NORMAL = 1;
export const STOCK_FLOOR = 0.15;
export const STOCK_CEILING = 4;

/** Where a village's stock of a good starts, from its trade. */
export function baseStock(trade: VillageTrade, item: string): number {
  const profile = TRADE[trade];
  if (profile.produces.includes(item)) return 2.6;
  if (profile.wants.includes(item)) return 0.35;
  return STOCK_NORMAL;
}

/**
 * The price of a good, given how much of it there is.
 *
 * An inverse curve rather than a straight line: going from plenty to scarce
 * should matter far more than going from plenty to slightly more plenty, which
 * is both how shortages actually work and what makes a route worth running. The
 * exponent is below 1 so the curve is steep near the floor and flattens out.
 *
 * The clamps are what stop the whole thing being exploitable. Without a ceiling,
 * buying a village out of something lets you sell it back at an unbounded price;
 * without a floor, dumping enough of anything makes it free to buy back.
 */
export const PRICE_FLOOR = 0.4;
export const PRICE_CEILING = 2.8;

export function priceMultiplier(stock: number): number {
  const clamped = Math.max(STOCK_FLOOR, Math.min(STOCK_CEILING, stock));
  const raw = Math.pow(STOCK_NORMAL / clamped, 0.7);
  return Math.max(PRICE_FLOOR, Math.min(PRICE_CEILING, raw));
}

/**
 * The spread: what the village charges versus what it pays.
 *
 * A trader has to live, so they sell above the going rate and buy below it. The
 * spread is what makes trade a matter of finding a big enough price difference
 * to clear it — without one, every village is an infinite money machine, because
 * you could buy and sell in the same breath.
 */
export const SPREAD = 0.28;

export type Prices = {
  /** What you pay to take one. */
  buy: number;
  /** What you are given for one. */
  sell: number;
};

/**
 * What one of something costs here.
 *
 * `haggle` is the player's Cunning and Presence, as a fraction, and it narrows
 * the spread from both ends rather than shifting the whole price — so a
 * persuasive character pays less AND is paid more, but never reaches the point of
 * buying and selling at the same number, which would be free money.
 */
export function priceOf(
  def: ItemDef, stock: number, haggle = 0, marketCut = 0,
): Prices {
  const base = itemValue(def);
  const going = base * priceMultiplier(stock);
  // Never let haggling close the spread entirely, or buy-and-sell-here becomes
  // profitable and the whole economy is a bug.
  const spread = Math.max(0.06, SPREAD + marketCut - Math.min(SPREAD * 0.7, haggle));
  return {
    buy: Math.max(1, Math.round(going * (1 + spread))),
    sell: Math.max(1, Math.round(going * (1 - spread))),
  };
}

/**
 * Move a village's stock when something is bought or sold.
 *
 * `amount` is how many changed hands, positive when the village gained them.
 * The step is divided by a notional depth of trade, so one sack barely moves a
 * market town and noticeably moves a hamlet — and so the player cannot crash a
 * price by trading a single item back and forth.
 */
export function afterTrade(stock: number, amount: number, depth = 12): number {
  return Math.max(STOCK_FLOOR, Math.min(STOCK_CEILING, stock + amount / depth));
}

/**
 * Drift back towards what the village normally has.
 *
 * Without this a route is a one-off: buy a village out of ore once and it is
 * poor for ever. With it, a route is something you come back to — which is the
 * difference between a trade system and a single puzzle. The rate is per turn and
 * deliberately slow, so clearing out a village still matters for a long while.
 */
export const DRIFT_PER_TURN = 0.002;

export function drift(stock: number, towards: number, turns: number): number {
  if (turns <= 0) return stock;
  const gap = towards - stock;
  const step = Math.min(Math.abs(gap), DRIFT_PER_TURN * turns);
  return stock + Math.sign(gap) * step;
}

/**
 * Is this worth carrying from here to there?
 *
 * Used by the wiki's trade page and by a village's own board, so a player can
 * see a route rather than having to keep a ledger. Returns the profit per unit
 * after both ends of the spread, which is the only number that matters.
 */
export function routeProfit(
  def: ItemDef, fromStock: number, toStock: number, haggle = 0,
): number {
  const here = priceOf(def, fromStock, haggle);
  const there = priceOf(def, toStock, haggle);
  return there.sell - here.buy;
}

/** A plain-words description of how a village feels about a good. */
export function stockWord(stock: number): string {
  if (stock >= 2.2) return "glut";
  if (stock >= 1.4) return "plenty";
  if (stock > 0.7) return "steady";
  if (stock > 0.3) return "short";
  return "desperate";
}
