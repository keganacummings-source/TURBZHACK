/**
 * Saving a run, and loading it back.
 *
 * The world itself is never written down. It is a pure function of the seed —
 * the same seed builds the same continent and the same dungeon floor, every
 * time — so a save stores the seed and then only what the player has CHANGED:
 * where they are, what they are carrying, what is still alive, what is lying on
 * the ground, and which squares they have seen. Everything else is rebuilt.
 *
 * That keeps a save small (tens of kilobytes rather than megabytes of tile
 * indices) and, more usefully, keeps it honest: there is no way for a save to
 * disagree with the generator about what the world looks like, because it never
 * had an opinion.
 *
 * The cost is that the generator must stay deterministic. `scripts/save.test.mts`
 * is what holds that: it saves, reloads, and checks the world came back
 * identical, which is also what would catch a change to world generation
 * silently invalidating everybody's saves.
 */

/** Bumped whenever the shape below changes in a way old files cannot satisfy. */
export const SAVE_VERSION = 1;

/**
 * Explored squares, run-length encoded.
 *
 * The `known` map is one byte per tile and nearly all of it is zero — 38,400
 * tiles for the overworld, of which a long run is unvisited. Pairs of
 * (value, count) bring a fresh continent down from 38KB to a few dozen bytes,
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
  pack: string[];
  worn: Record<string, string | undefined>;
  /** `levelKey:tileIndex` -> item ids. */
  loot: [string, string[]][];
  cooldowns: [string, number][];
  deadXp: [string, number][];
  /** World bosses already killed, so their lairs stay empty. */
  bossesKilled?: string[];
  /** Everything levelling changed outside combat. */
  perks?: Record<string, number>;
  talentsTaken?: string[];
  party?: string[];
  skills?: Record<string, number>;
  crafts?: Record<string, number>;
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
    if (parsed?.version !== SAVE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: number): void {
  try { localStorage.removeItem(SLOT_PREFIX + slot); } catch { /* nothing to delete */ }
}

export const SLOTS_AVAILABLE = [1, 2, 3] as const;

export function listSlots(): (SlotInfo | null)[] {
  return SLOTS_AVAILABLE.map((slot) => {
    const file = readSlot(slot);
    return file ? { slot, label: file.label, at: file.at } : null;
  });
}
