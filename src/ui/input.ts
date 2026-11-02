/**
 * The keyboard, as data.
 *
 * Every key the game responds to is one entry in `ACTIONS`, and what keys an
 * action answers to is a list of tokens that the player can change. The controls
 * screen is generated from the same table that resolves the keys, so the two can
 * never disagree about what a key does — which was the point of making bindings
 * data in the first place.
 *
 * The numpad is the primary way to move. It is how NetHack is actually played:
 * eight directions laid out the way they point, with 5 in the middle to wait.
 * `hjklyubn` and the arrow keys remain bound because people expect them, but
 * they are alternates on these rows, not the main entry.
 */

// --- key tokens -------------------------------------------------------------

/**
 * One key, written down.
 *
 * A browser gives two names for every press and neither is enough alone.
 * `event.key` is what the key MEANS on this layout — useful for letters, so
 * someone on Dvorak gets `h` where they actually type h — but it cannot tell the
 * numpad's "1" from the number row's "1", and this game binds those to different
 * things. `event.code` is the physical key, which settles that but would pin
 * letters to QWERTY positions.
 *
 * So: physical for the numpad and the named keys, meaning for everything you
 * could type. The two sets cannot collide, because a token from the second
 * branch is always a single character and a token from the first never is.
 */
export type KeyToken = string;

const NAMED = new Set([
  "Escape", "Tab", "Enter", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);

export function keyToken(e: KeyboardEvent): KeyToken {
  if (e.code.startsWith("Numpad")) return e.code;
  if (NAMED.has(e.code)) return e.code;
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key.toLowerCase();
  // A modifier on its own, or something exotic. Never bindable.
  return e.code || e.key;
}

/** How a token is written on the controls screen. */
export function keyLabel(token: KeyToken): string {
  if (token.startsWith("Numpad")) {
    const rest = token.slice(6);
    const pretty: Record<string, string> = {
      Add: "+", Subtract: "−", Multiply: "×", Divide: "÷", Decimal: ".", Enter: "Enter",
    };
    return `Num ${pretty[rest] ?? rest}`;
  }
  const pretty: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Escape: "Esc", Space: "Space", PageUp: "PgUp", PageDown: "PgDn",
  };
  return pretty[token] ?? (token.length === 1 ? token.toUpperCase() : token);
}

/** A press that should never be captured as a binding. */
export function isBindable(e: KeyboardEvent): boolean {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "ContextMenu"].includes(e.key)) return false;
  return keyToken(e).length > 0;
}

// --- what the game can be told to do ----------------------------------------

export type Command =
  | { kind: "move"; dx: number; dy: number }
  | { kind: "rest" }
  | { kind: "ability"; id: string }
  | { kind: "spell"; slot: number }
  | { kind: "pack" }
  | { kind: "pickup" }
  | { kind: "map" }
  | { kind: "help" }
  | { kind: "wiki" }
  | { kind: "craft" }
  | { kind: "menu" }
  | { kind: "designer" }
  | { kind: "close" };

export type ActionId = string;

export type Action = {
  id: ActionId;
  /** Shown on the controls screen. */
  what: string;
  group: "Moving" | "Fighting" | "Screens";
  command: Command;
  /** Keys out of the box. The first is the one the game teaches. */
  keys: KeyToken[];
};

const move = (id: string, what: string, dx: number, dy: number, keys: KeyToken[]): Action =>
  ({ id, what, group: "Moving", command: { kind: "move", dx, dy }, keys });

/**
 * The default bindings.
 *
 * The numpad comes first in every movement row because it is the primary
 * control; `keyLabel` of the first token is what the game shows when it tells
 * you how to move.
 */
export const ACTIONS: Action[] = [
  move("north-west", "North-west", -1, -1, ["Numpad7", "y"]),
  move("north", "North", 0, -1, ["Numpad8", "k", "ArrowUp"]),
  move("north-east", "North-east", 1, -1, ["Numpad9", "u"]),
  move("west", "West", -1, 0, ["Numpad4", "h", "ArrowLeft"]),
  move("east", "East", 1, 0, ["Numpad6", "l", "ArrowRight"]),
  move("south-west", "South-west", -1, 1, ["Numpad1", "b"]),
  move("south", "South", 0, 1, ["Numpad2", "j", "ArrowDown"]),
  move("south-east", "South-east", 1, 1, ["Numpad3", "n"]),
  { id: "wait", what: "Wait a turn", group: "Moving", command: { kind: "rest" }, keys: ["Numpad5", ".", "Space"] },

  { id: "punch", what: "Punch (free)", group: "Fighting", command: { kind: "ability", id: "punch" }, keys: ["z"] },
  { id: "kick", what: "Kick (25 stamina)", group: "Fighting", command: { kind: "ability", id: "kick" }, keys: ["x"] },
  { id: "spell-1", what: "Cast your first spell", group: "Fighting", command: { kind: "spell", slot: 0 }, keys: ["1"] },
  { id: "spell-2", what: "Cast your second spell", group: "Fighting", command: { kind: "spell", slot: 1 }, keys: ["2"] },
  { id: "spell-3", what: "Cast your third spell", group: "Fighting", command: { kind: "spell", slot: 2 }, keys: ["3"] },
  { id: "pickup", what: "Pick up what you are standing on", group: "Fighting", command: { kind: "pickup" }, keys: ["g", ","] },

  { id: "pack", what: "Pack and gear", group: "Screens", command: { kind: "pack" }, keys: ["i"] },
  { id: "map", what: "Overview map", group: "Screens", command: { kind: "map" }, keys: ["m"] },
  { id: "craft", what: "Crafting", group: "Screens", command: { kind: "craft" }, keys: ["c"] },
  { id: "wiki", what: "Wiki", group: "Screens", command: { kind: "wiki" }, keys: ["w"] },
  { id: "help", what: "Controls", group: "Screens", command: { kind: "help" }, keys: ["?", "/"] },
  { id: "designer", what: "Texture designer", group: "Screens", command: { kind: "designer" }, keys: ["t"] },
  { id: "menu", what: "Game menu", group: "Screens", command: { kind: "menu" }, keys: ["Escape"] },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** action id -> the keys it currently answers to. */
export type Bindings = Map<ActionId, KeyToken[]>;

export function defaultBindings(): Bindings {
  return new Map(ACTIONS.map((a) => [a.id, [...a.keys]]));
}

// --- storage ----------------------------------------------------------------

const STORE_KEY = "turbzhack.bindings.v1";

/**
 * Remember rebinds in this browser.
 *
 * Wrapped because `localStorage` is not always there to be written to — a
 * private window, blocked site data, or an embedded preview all make the
 * accessor throw rather than return nothing. Losing a rebind is a small thing;
 * refusing to start the game over it would not be.
 */
export function saveBindings(b: Bindings): void {
  try {
    const flat: Record<string, string[]> = {};
    // Only what differs from the defaults, so a later change to a default key
    // reaches players who never rebound that action.
    for (const a of ACTIONS) {
      const mine = b.get(a.id) ?? [];
      if (mine.join("\u0000") !== a.keys.join("\u0000")) flat[a.id] = mine;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(flat));
  } catch {
    /* not available here; the session keeps its bindings in memory */
  }
}

export function loadBindings(): Bindings {
  const b = defaultBindings();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return b;
    const flat = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, keys] of Object.entries(flat)) {
      if (!ACTION_BY_ID.has(id)) continue;             // an action that no longer exists
      if (!Array.isArray(keys)) continue;
      b.set(id, keys.filter((k): k is string => typeof k === "string"));
    }
  } catch {
    /* unreadable or not JSON: fall back to the defaults rather than refusing to start */
  }
  return b;
}

export function clearBindings(): void {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clear */ }
}

// --- resolving --------------------------------------------------------------

/** Which action a press means, or null. */
export function actionFor(e: KeyboardEvent, bindings: Bindings): Action | null {
  const token = keyToken(e);
  for (const a of ACTIONS) {
    if ((bindings.get(a.id) ?? []).includes(token)) return a;
  }
  return null;
}

export function commandFor(e: KeyboardEvent, bindings: Bindings): Command | null {
  return actionFor(e, bindings)?.command ?? null;
}

/**
 * Give a key to an action, taking it off whatever had it.
 *
 * One key does one thing. Letting two actions share a key would mean the
 * resolver silently picking whichever came first in the table, and the controls
 * screen showing a binding that does not fire — so the old owner loses it, and
 * the caller is told who that was in order to say so.
 */
export function rebind(bindings: Bindings, id: ActionId, token: KeyToken): { tookFrom: Action | null } {
  let tookFrom: Action | null = null;
  for (const a of ACTIONS) {
    if (a.id === id) continue;
    const keys = bindings.get(a.id) ?? [];
    if (!keys.includes(token)) continue;
    tookFrom = a;
    bindings.set(a.id, keys.filter((k) => k !== token));
  }
  const mine = bindings.get(id) ?? [];
  if (!mine.includes(token)) bindings.set(id, [...mine, token]);
  return { tookFrom };
}

/** Take one key off an action. The last key may go: an unbound action is allowed. */
export function unbind(bindings: Bindings, id: ActionId, token: KeyToken): void {
  bindings.set(id, (bindings.get(id) ?? []).filter((k) => k !== token));
}

/** The controls screen, grouped, built from the same table the resolver uses. */
export function controlsText(bindings: Bindings = defaultBindings()):
  { group: string; rows: { id: ActionId; keys: KeyToken[]; what: string }[] }[] {
  const groups: Action["group"][] = ["Moving", "Fighting", "Screens"];
  return groups.map((group) => ({
    group,
    rows: ACTIONS.filter((a) => a.group === group).map((a) => ({
      id: a.id, keys: bindings.get(a.id) ?? [], what: a.what,
    })),
  }));
}

/** What to tell a new player about moving, using whatever keys they have bound. */
export function movementHint(bindings: Bindings): string {
  const first = (id: string) => (bindings.get(id) ?? [])[0];
  const pad = ACTIONS.filter((a) => a.group === "Moving" && a.id !== "wait")
    .every((a) => (bindings.get(a.id) ?? []).some((k) => k.startsWith("Numpad")));
  if (pad) return "Move with the numpad — 1 through 9, with 5 to wait. Right-click anything for what you can do to it.";
  const keys = ["north", "west", "south", "east"].map((d) => keyLabel(first(d) ?? "?")).join("");
  return `Move with ${keys}. Right-click anything for what you can do to it.`;
}
