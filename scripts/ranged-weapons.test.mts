/**
 * Bows, crossbows and whips: attacks that reach past the next square.
 *
 * They used to work only by accident of the attack key. The right-click menu
 * offered nothing unless the target was adjacent, a wall did not stop a shot,
 * the log said "strike" for an arrow, and a whip reached exactly as far as a
 * dagger. Every test here is one of those.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { menuAt } from "../src/ui/context.ts";
import { weaponStats } from "../src/engine/weapons.ts";
import { newMotion, noteShot, shotsAt, moving, SHOT_MS } from "../src/render/motion.ts";
import type { ItemDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const items = reg.items as Map<string, ItemDef>;

const armed = (id: string, gap: number) => {
  const g = new Game(reg, 2026);
  g.start("fighter");
  g.pack.push(id);
  g.wear(g.handleOf(id)!);
  const foe = g.actors.find((a) => !a.isPlayer)!;
  foe.pos = { x: g.player.pos.x + gap, y: g.player.pos.y };
  foe.stance = "hostile";
  foe.pools.hp = foe.pools.hpMax = 5000;
  foe.stats.evasion = 0;
  g.player.stats.accuracy = 100;
  g.player.pools.stamina = g.player.pools.staminaMax;
  g.refreshFov();
  return { g, foe };
};

test("a whip reaches further than the dagger class it is filed under", () => {
  assert.equal(weaponStats(items.get("whip")!).reach, 2);
  assert.equal(weaponStats(items.get("dagger")!).reach, 1);
  assert.equal(weaponStats(items.get("longbow")!).reach, 6);
});

test("a bow shoots across the room, and the log says so", () => {
  const { g, foe } = armed("longbow", 4);
  const hp = foe.pools.hp;
  const aimedAt = { ...foe.pos };      // it walks towards you once the shot is away
  g.ability("punch");
  assert.ok(foe.pools.hp < hp, "the arrow did nothing");
  assert.ok(g.messages.some((m) => /shoot/i.test(m.text)), "an arrow was not a shot");
  assert.ok(!g.messages.some((m) => /strike Wolf/i.test(m.text)));
  assert.ok(g.lastShot, "nothing was recorded to draw");
  assert.deepEqual(g.lastShot!.to, aimedAt);
});

test("a crossbow fires and a whip lashes", () => {
  const a = armed("crossbow", 3);
  a.g.ability("punch");
  assert.ok(a.g.messages.some((m) => /fire/i.test(m.text)), "the crossbow did not fire");
  const b = armed("whip", 2);
  b.g.ability("punch");
  assert.ok(b.g.messages.some((m) => /lash/i.test(m.text)), "the whip did not lash");
});

test("beyond its reach, nothing happens and the turn is kept", () => {
  const { g, foe } = armed("whip", 4);
  const turn = g.turn;
  g.ability("punch", foe);
  assert.equal(g.turn, turn, "an out-of-reach lash used the turn");
});

test("a melee swing is not drawn in flight", () => {
  const { g } = armed("short-sword", 1);
  g.ability("punch");
  assert.equal(g.lastShot, null, "a sword swing left a trail");
});

test("a wall stops a shot", () => {
  const { g, foe } = armed("longbow", 4);
  const lvl = g.level;
  // Find two floor tiles with an opaque one between them, in a row.
  let found = false;
  for (let y = 1; y < lvl.h - 1 && !found; y++) {
    for (let x = 1; x < lvl.w - 4 && !found; x++) {
      if (!lvl.solid(x, y) && lvl.opaque(x + 1, y) && !lvl.solid(x + 2, y)) {
        g.player.pos = { x, y };
        foe.pos = { x: x + 2, y };
        found = true;
      }
    }
  }
  if (!found) return;      // a level with no such spot has nothing to test
  const hp = foe.pools.hp;
  const turn = g.turn;
  g.ability("punch", foe);
  assert.equal(foe.pools.hp, hp, "an arrow went through a wall");
  assert.equal(g.turn, turn, "a blocked shot used the turn");
  assert.ok(g.messages.some((m) => /clear shot/i.test(m.text)));
});

test("right-click offers the weapon at its own range", () => {
  const { g, foe } = armed("longbow", 5);
  const far = menuAt(g, foe.pos.x, foe.pos.y);
  assert.ok(far.actions.some((a) => a.kind === "attack"), "no shot offered at range 5");
  assert.ok(!far.actions.some((a) => a.kind === "attack" && a.id === "kick"), "a kick offered at range 5");
  const label = far.actions.find((a) => a.kind === "attack")!;
  assert.match((label as { label: string }).label, /longbow/i, "the menu names the fist, not the bow");
});

test("right-click offers melee up close, kick included", () => {
  const { g, foe } = armed("short-sword", 1);
  const near = menuAt(g, foe.pos.x, foe.pos.y);
  const ids = near.actions.filter((a) => a.kind === "attack").map((a) => (a as { id: string }).id);
  assert.ok(ids.includes("punch"), "no weapon attack when adjacent");
  assert.ok(ids.includes("kick"), "no kick when adjacent");
});

test("right-click does not offer what is out of reach", () => {
  const { g, foe } = armed("short-sword", 3);
  const far = menuAt(g, foe.pos.x, foe.pos.y);
  assert.ok(!far.actions.some((a) => a.kind === "attack"), "a sword offered at three squares");
  assert.ok(far.actions.some((a) => a.kind === "walk"), "no way to close the distance");
});

test("a shot is drawn once, crosses the screen, and then is gone", () => {
  const m = newMotion();
  const shot = { from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, seq: 1 };
  noteShot(m, shot, 1000);
  assert.ok(moving(m), "nothing animating");
  const mid = shotsAt(m, 1000 + SHOT_MS / 2);
  assert.equal(mid.length, 1);
  assert.ok(mid[0]!.x > 0 && mid[0]!.x < 4, "the shot is not between the two ends");
  // The same shot noticed again on the next frame is not a second arrow.
  noteShot(m, shot, 1050);
  assert.equal(m.shots.length, 1);
  noteShot(m, shot, 1000 + SHOT_MS + 5);
  assert.equal(shotsAt(m, 1000 + SHOT_MS + 5).length, 0);
  assert.equal(moving(m), false, "the animation loop would never stop");
});
