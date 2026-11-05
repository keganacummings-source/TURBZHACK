/**
 * The keyboard layer.
 *
 * Bindings are the one part of the UI a player can break for themselves, so the
 * invariants worth holding are about not letting them: a key does one thing, the
 * controls screen shows what the resolver will actually do, and a stored file
 * from an older version cannot stop the game starting.
 *
 * `KeyboardEvent` does not exist in Node, so presses are faked. Only `key` and
 * `code` are read, and faking exactly those is what keeps this honest — if the
 * resolver ever starts reading something else, this stops compiling rather than
 * passing for the wrong reason.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS, actionFor, commandFor, controlsText, defaultBindings, isBindable,
  keyLabel, keyToken, loadBindings, movementHint, rebind, unbind,
} from "../src/ui/input.ts";

/** A pretend key press. Only `key` and `code` are ever read. */
const press = (key: string, code = ""): KeyboardEvent =>
  ({ key, code } as KeyboardEvent);

test("a key token tells the numpad from the number row", () => {
  // This is the whole reason tokens exist: the numpad moves and the number row
  // casts spells, and `event.key` is "1" for both.
  assert.equal(keyToken(press("1", "Numpad1")), "Numpad1");
  assert.equal(keyToken(press("1", "Digit1")), "1");
  assert.notEqual(keyToken(press("1", "Numpad1")), keyToken(press("1", "Digit1")));

  // Letters go by meaning, so a Dvorak player gets h where they type h.
  assert.equal(keyToken(press("h", "KeyJ")), "h");
  assert.equal(keyToken(press("H", "KeyH")), "h");
  // Named keys go by code.
  assert.equal(keyToken(press("Escape", "Escape")), "Escape");
  assert.equal(keyToken(press("ArrowLeft", "ArrowLeft")), "ArrowLeft");
  assert.equal(keyToken(press(" ", "Space")), "Space");
});

test("the numpad is the primary way to move", () => {
  const b = defaultBindings();
  const moves = ACTIONS.filter((a) => a.group === "Moving" && a.id !== "wait");
  assert.equal(moves.length, 8, "a roguelike moves in eight directions");

  for (const a of moves) {
    const keys = b.get(a.id) ?? [];
    assert.ok(keys[0]?.startsWith("Numpad"), `${a.id} does not lead with a numpad key`);
  }
  assert.ok((b.get("wait") ?? []).includes("Numpad5"), "numpad 5 does not wait");

  // And the numpad resolves to the direction it points at.
  const expect: [string, number, number][] = [
    ["Numpad7", -1, -1], ["Numpad8", 0, -1], ["Numpad9", 1, -1],
    ["Numpad4", -1, 0], ["Numpad6", 1, 0],
    ["Numpad1", -1, 1], ["Numpad2", 0, 1], ["Numpad3", 1, 1],
  ];
  for (const [code, dx, dy] of expect) {
    const cmd = commandFor(press(code.slice(6), code), b);
    assert.ok(cmd && cmd.kind === "move", `${code} does not move`);
    assert.deepEqual([cmd.dx, cmd.dy], [dx, dy], `${code} points the wrong way`);
  }
});

test("the number row still casts spells", () => {
  const b = defaultBindings();
  const cmd = commandFor(press("1", "Digit1"), b);
  assert.ok(cmd && cmd.kind === "spell");
  assert.equal(cmd.slot, 0);
});

test("the transformation screen is reachable from its default key", () => {
  const command = commandFor(press("v", "KeyV"), defaultBindings());
  assert.deepEqual(command, { kind: "forms" });
});

test("no two actions share a key out of the box", () => {
  const b = defaultBindings();
  const owner = new Map<string, string>();
  for (const [id, keys] of b) {
    for (const k of keys) {
      const had = owner.get(k);
      assert.equal(had, undefined, `"${k}" is bound to both ${had} and ${id}`);
      owner.set(k, id);
    }
  }
});

test("every action has at least one key, and a label for it", () => {
  const b = defaultBindings();
  for (const a of ACTIONS) {
    const keys = b.get(a.id) ?? [];
    assert.ok(keys.length, `${a.id} is unbound by default`);
    for (const k of keys) assert.ok(keyLabel(k).length, `"${k}" has no label`);
  }
});

test("rebinding takes the key off whatever had it", () => {
  const b = defaultBindings();
  // "m" opens the map. Give it to the pack instead.
  const { tookFrom } = rebind(b, "pack", "m");
  assert.equal(tookFrom?.id, "map", "it did not say who lost the key");
  assert.ok(!(b.get("map") ?? []).includes("m"), "the map still answers to m");
  assert.ok((b.get("pack") ?? []).includes("m"));

  const cmd = commandFor(press("m", "KeyM"), b);
  assert.equal(cmd?.kind, "pack", "the resolver disagrees with the binding");
});

test("rebinding the same key twice does not list it twice", () => {
  const b = defaultBindings();
  rebind(b, "pack", "p");
  rebind(b, "pack", "p");
  assert.equal((b.get("pack") ?? []).filter((k) => k === "p").length, 1);
});

test("an action can be left with no keys at all", () => {
  // Deliberate: someone who never wants the texture designer should be able to
  // free the key entirely, and the game must not mind.
  const b = defaultBindings();
  for (const k of [...(b.get("designer") ?? [])]) unbind(b, "designer", k);
  assert.deepEqual(b.get("designer"), []);
  assert.equal(commandFor(press("t", "KeyT"), b), null);
});

test("the controls screen lists exactly what the resolver knows", () => {
  const b = defaultBindings();
  const listed = controlsText(b).flatMap((g) => g.rows.map((r) => r.id));
  assert.deepEqual([...listed].sort(), ACTIONS.map((a) => a.id).sort(),
    "the controls screen and the key table disagree about which actions exist");

  // And every key it shows actually resolves to that action.
  for (const group of controlsText(b)) {
    for (const row of group.rows) {
      for (const k of row.keys) {
        const code = k.startsWith("Numpad") ? k : k.length === 1 ? `Key${k.toUpperCase()}` : k;
        const key = k.startsWith("Numpad") ? k.slice(6) : k;
        const found = actionFor(press(key, code), b);
        assert.equal(found?.id, row.id, `the screen says "${k}" does ${row.id}, the resolver says ${found?.id}`);
      }
    }
  }
});

test("r is bound to the full-rest action without changing the one-turn wait", () => {
  const b = defaultBindings();
  assert.equal(commandFor(press("r", "KeyR"), b)?.kind, "long-rest");
  assert.equal(commandFor(press("5", "Numpad5"), b)?.kind, "rest");
});

test("modifiers on their own are never bindable", () => {
  for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
    assert.equal(isBindable(press(k, k)), false, `${k} should not be bindable`);
  }
  assert.equal(isBindable(press("a", "KeyA")), true);
  assert.equal(isBindable(press("Escape", "Escape")), true, "Escape should be bindable");
});

test("the movement hint describes the keys you actually have", () => {
  const b = defaultBindings();
  assert.match(movementHint(b), /numpad/i);

  // Strip the numpad and the hint has to change, or it is lying to the player.
  for (const a of ACTIONS) {
    if (a.group !== "Moving") continue;
    for (const k of [...(b.get(a.id) ?? [])]) if (k.startsWith("Numpad")) unbind(b, a.id, k);
  }
  assert.doesNotMatch(movementHint(b), /numpad/i);
});

test("a stored binding file from another version cannot stop the game", () => {
  // `loadBindings` runs before anything is on screen, so anything it throws is a
  // blank page. Node has no localStorage at all, which is the harshest version
  // of "storage is not available" and exactly what has to be survived.
  assert.equal(typeof globalThis.localStorage, "undefined",
    "this test is meaningless if Node has grown a localStorage");
  const b = loadBindings();
  assert.deepEqual([...b.keys()].sort(), ACTIONS.map((a) => a.id).sort());
});
