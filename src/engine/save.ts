import type { DungeonEntrance } from "../world/continent.ts";

/**
 * Saving a run, and loading it back.
 *
 * The seeded world is rebuilt from the seed, then the small replacement
 * history for cleared dungeon entrances is replayed. A save stores the seed
 * and only what the player has CHANGED:
 * where they are, what they are carrying, what is still alive, what is lying on
 * the ground, and which squares they have seen. Everything else is rebuilt.
 *
 * That keeps a save small (tens of kilobytes rather than megabytes of tile
 * indices) and, more usefully, keeps it honest: there is no way for a save to
 * disagree with the generator about what the world looks like, because it never
 * had an opinion.
 *
 * The generator must stay deterministic. `scripts/save.test.mts` checks that
 * the world comes back identical. World-size changes carry their dimensions
 * forward, and version 1 saves rebuild the original 240×160 continent.
 */

/** Bumped whenever the shape below changes in a way old files cannot satisfy. */
export const SAVE_VERSION = 3;

/**
 * Explored squares, run-length encoded.
 *
 * The `known` map is one byte per tile and nearly all of it is zero — 153,600
 * tiles for the overworld, of which a long run is unvisited. Pairs of
 * (value, count) bring a fresh continent down from 150KB to a few dozen bytes,
 * and a thoroughly explored one to a few kilobytes, which matters because
 * localStorage is measured in single-digit megabytes.
 */
export function encodeRuns(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i]!;
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === value) run++;
    out.push(value, run);
    i += run;
  }
  return out;
}

export function decodeRuns(runs: number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const value = runs[i]!;
    const run = runs[i + 1]!;
    // A truncated or over-long file fills what it can rather than throwing: a
    // partly explored map is a far better outcome than a save that will not open.
    for (let n = 0; n < run && at < length; n++) out[at++] = value;
  }
  return out;
}

export type SaveFile = {
  version: number;
  /** The generated overworld dimensions, so a save rebuilds the same map. */
  worldSize?: { w: number; h: number };
  /** When it was written, for the slot list. */
  at: number;
  /** A line for the slot list: "Minotaur Berserker, level 4, The Reach". */
  label: string;
  seed: number;
  speciesId: string;
  classId: string;
  place: unknown;
  turn: number;
  xp: number;
  playerLevel: number;
  /** A temporary transformation and its absolute world-turn expiry. */
  activeForm?: { id: string; expiresAt: number } | null;
  /** One-shot traps already sprung, keyed by level key and tile index. */
  spentTraps?: [string, number[]][];
  pack: string[];
  worn: Record<string, string | undefined>;
  /** `levelKey:tileIndex` -> item ids. */
  loot: [string, string[]][];
  cooldowns: [string, number][];
  deadXp: [string, number][];
  /** World bosses already killed, so their lairs stay empty. */
  bossesKilled?: string[];
  /** Mutable replacements, replayed in order over the seeded entrance list. */
  dungeonReplacements?: [number, DungeonEntrance][];
  /** Everything levelling changed outside combat. */
  perks?: Record<string, number>;
  talentsTaken?: string[];
  /** Banked attribute points, and practice with each weapon class. */
  attributePoints?: number;
  weaponSkills?: Record<string, number>;
  /** Coin, markets, standing and quests. */
  coin?: number;
  tameSkill?: number;
  knownRecipes?: string[];
  nextHandle?: number;
  markets?: unknown[];
  /** Illicit stall stock and refresh clock. */
  blackMarket?: {
    listings: { item: string; qty: number; premium: number }[];
    refreshedAt: number;
    level: number;
  };
  standing?: [number, number][];
  quests?: unknown[];
  questsDone?: string[];
  deepestIn?: [number, number][];
  /** Material and quality for particular items, keyed by item id. */
  instances?: [string, { item: string; material?: string; quality?: string; maker?: string }][];
  party?: string[];
  skills?: Record<string, number>;
  crafts?: Record<string, number>;
  /**
   * Spell ids currently on the hotbar (equipped). Length is the class's slot
   * count; null entries are empty slots. Known-but-unequipped spells live only
   * on the player actor's `spells` list.
   */
  equippedSpells?: (string | null)[];
  /** Player renames for spells, keyed by spell id. */
  spellNames?: [string, string][];
  actors: unknown[];
  nextId: number;
  messages: unknown[];
  over: unknown;
  /** levelKey -> run-length encoded `known`. */
  explored: [string, number[]][];
};

const SLOT_PREFIX = "turbzhack.save.";

export type SlotInfo = { slot: number; label: string; at: number };

/**
 * Browser storage is the only place to put these.
 *
 * There is no server and no filesystem, so saves live in `localStorage` for
 * this browser on this machine. Every accessor here is wrapped: a private
 * window, blocked site data, or a storage quota that has run out all throw
 * rather than returning nothing, and none of those should take the game down
 * mid-run. A save that cannot be written says so and the run carries on.
 */
export function writeSlot(slot: number, file: SaveFile): { ok: boolean; message: string } {
  try {
    localStorage.setItem(SLOT_PREFIX + slot, JSON.stringify(file));
    return { ok: true, message: `Saved to slot ${slot}.` };
  } catch (err) {
    const why = err instanceof Error && err.name === "QuotaExceededError"
      ? "there is no room left in this browser's storage"
      : "this browser is not letting the game store anything";
    return { ok: false, message: `Could not save: ${why}.` };
  }
}

export function readSlot(slot: number): SaveFile | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slot);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed?.version !== 1 && parsed?.version !== 2 && parsed?.version !== SAVE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: number): void {
  try { localStorage.removeItem(SLOT_PREFIX + slot); } catch { /* nothing to delete */ }
}

export const SLOTS_AVAILABLE = [1, 2, 3] as const;

/**
 * The autosave lives in a slot of its own, apart from the three the player
 * uses by hand.
 *
 * A separate slot so an autosave never silently overwrites a save the player
 * made deliberately — the automatic one is a safety net under the manual ones,
 * not a competitor for them.
 */
export const AUTOSAVE_SLOT = 0;

/** How often the game saves itself, in turns. */
export const AUTOSAVE_EVERY = 1000;

/**
 * The most recent save of any kind, autosave included.
 *
 * This is what "load your last save" on death reaches for: whichever slot was
 * written most recently, so a death sends you back to the last point the game
 * was in a known-good state, whether that was your doing or the autosave's.
 */
export function mostRecentSave(): { slot: number; file: SaveFile } | null {
  let best: { slot: number; file: SaveFile } | null = null;
  for (const slot of [AUTOSAVE_SLOT, ...SLOTS_AVAILABLE]) {
    const file = readSlot(slot);
    if (!file) continue;
    if (!best || file.at > best.file.at) best = { slot, file };
  }
  return best;
}

export function listSlots(): (SlotInfo | null)[] {
  return SLOTS_AVAILABLE.map((slot) => {
    const file = readSlot(slot);
    return file ? { slot, label: file.label, at: file.at } : null;
  });
}
