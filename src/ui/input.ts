/**
 * The keyboard.
 *
 * NetHack's scheme, because that is the game this is meant to feel like, with
 * the arrow keys and numpad working too so nobody has to learn `hjkl` before
 * they can walk. Bindings are DATA, so the controls screen is generated from
 * the same table that handles the keys and the two can never disagree.
 */
import { DIRS, type Dir } from "../engine/types.ts";

export type Command =
  | { kind: "move"; dir: Dir }
  | { kind: "rest" }
  | { kind: "ability"; id: string }
  | { kind: "spell"; slot: number }
  | { kind: "pack" }
  | { kind: "pickup" }
  | { kind: "map" }
  | { kind: "help" }
  | { kind: "designer" }
  | { kind: "close" };

/** One row of the controls screen, and one entry in the key table. */
export type Binding = { keys: string[]; what: string; command: Command };

const dir = (keys: string[], what: string, d: Dir): Binding => ({ keys, what, command: { kind: "move", dir: d } });

export const BINDINGS: Binding[] = [
  dir(["h", "ArrowLeft", "4"], "West", DIRS.h!),
  dir(["j", "ArrowDown", "2"], "South", DIRS.j!),
  dir(["k", "ArrowUp", "8"], "North", DIRS.k!),
  dir(["l", "ArrowRight", "6"], "East", DIRS.l!),
  dir(["y", "7"], "North-west", DIRS.y!),
  dir(["u", "9"], "North-east", DIRS.u!),
  dir(["b", "1"], "South-west", DIRS.b!),
  dir(["n", "3"], "South-east", DIRS.n!),
  { keys: [".", "5", " "], what: "Wait a turn", command: { kind: "rest" } },
  { keys: ["z"], what: "Punch (free)", command: { kind: "ability", id: "punch" } },
  { keys: ["x"], what: "Kick (25 stamina)", command: { kind: "ability", id: "kick" } },
  { keys: ["1"], what: "Cast your first spell", command: { kind: "spell", slot: 0 } },
  { keys: ["2"], what: "Cast your second spell", command: { kind: "spell", slot: 1 } },
  { keys: ["3"], what: "Cast your third spell", command: { kind: "spell", slot: 2 } },
  { keys: ["i"], what: "Pack and gear", command: { kind: "pack" } },
  { keys: ["g", ","], what: "Pick up what you are standing on", command: { kind: "pickup" } },
  { keys: ["m"], what: "Overview map", command: { kind: "map" } },
  { keys: ["?"], what: "This list", command: { kind: "help" } },
  { keys: ["t"], what: "Texture designer", command: { kind: "designer" } },
  { keys: ["Escape"], what: "Close a screen", command: { kind: "close" } },
];

/**
 * Which command a key means.
 *
 * The digits are deliberately listed twice above — as numpad movement and as
 * spell slots — so this resolves the clash in one place: if the key came from
 * the numpad it is movement, otherwise it is a spell. `event.code` is what
 * tells them apart, and it is the only reliable way to.
 */
export function commandFor(e: KeyboardEvent): Command | null {
  const fromNumpad = e.code.startsWith("Numpad");

  if (fromNumpad) {
    const match = BINDINGS.find((b) => b.command.kind !== "spell" && b.keys.includes(e.key));
    if (match) return match.command;
  }
  if (/^[1-9]$/.test(e.key) && !fromNumpad) {
    const slot = Number(e.key) - 1;
    if (slot <= 2) return { kind: "spell", slot };
  }
  const match = BINDINGS.find((b) => b.command.kind !== "spell" && b.keys.includes(e.key));
  return match?.command ?? null;
}

/** The controls screen, grouped, built from the same table. */
export function controlsText(): { group: string; rows: [string, string][] }[] {
  const keyLabel = (keys: string[]) =>
    keys.map((k) => (k === " " ? "Space" : k)).join(" / ");
  const moves = BINDINGS.filter((b) => b.command.kind === "move");
  const fight = BINDINGS.filter((b) => b.command.kind === "ability" || b.command.kind === "spell" || b.command.kind === "pickup");
  const other = BINDINGS.filter((b) => !moves.includes(b) && !fight.includes(b));
  return [
    { group: "Moving", rows: moves.map((b) => [keyLabel(b.keys), b.what] as [string, string]) },
    { group: "Fighting", rows: fight.map((b) => [keyLabel(b.keys), b.what] as [string, string]) },
    { group: "Screens", rows: other.map((b) => [keyLabel(b.keys), b.what] as [string, string]) },
  ];
}
