/**
 * Sliding between tiles.
 *
 * Presentation only — nothing here may change the rules — so what is worth
 * testing is that it starts, that it finishes, and above all that it STOPS. The
 * app asks for another animation frame while anything is moving, so a slide that
 * never expires is a render loop that never ends.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { IMPACT_MS, SLIDE_MS, moving, newMotion, noteMoves, offsetOf } from "../src/render/motion.ts";
import { Actor } from "../src/engine/actor.ts";

const someone = (id: string, x: number, y: number) =>
  new Actor({ id, def: "test", name: "Test", pos: { x, y } });

test("a step starts a slide, and the slide runs from where it was", () => {
  const m = newMotion();
  const a = someone("a", 5, 5);
  noteMoves(m, [a], 0);
  assert.equal(moving(m), false, "standing still is not moving");

  a.pos = { x: 6, y: 5 };
  noteMoves(m, [a], 1000);
  assert.equal(moving(m), true);

  // At the start it is drawn a whole tile back, and at the end exactly on its tile.
  const begin = offsetOf(m, "a", 1000);
  assert.ok(Math.abs(begin.dx + 1) < 0.001, `started at dx ${begin.dx}, not -1`);
  assert.equal(begin.dy, 0);

  const mid = offsetOf(m, "a", 1000 + SLIDE_MS / 2);
  assert.ok(mid.dx > -1 && mid.dx < 0, `halfway through it is at ${mid.dx}`);

  assert.deepEqual(offsetOf(m, "a", 1000 + SLIDE_MS), { dx: 0, dy: 0 });
});

test("a slide for something nobody is drawing still expires", () => {
  /*
   * The bug this comes from: slides were dropped inside `offsetOf`, which only
   * runs for an actor the renderer actually draws. Something that stepped and
   * then walked out of view kept its slide for ever, `moving()` stayed true, and
   * the app asked for an animation frame on every frame — for the rest of the
   * session.
   */
  const m = newMotion();
  const a = someone("a", 5, 5);
  noteMoves(m, [a], 0);
  a.pos = { x: 6, y: 5 };
  noteMoves(m, [a], 1000);
  assert.equal(moving(m), true);

  // Time passes and nothing ever asks for its offset.
  noteMoves(m, [a], 1000 + SLIDE_MS + 1);
  assert.equal(moving(m), false, "the slide outlived its own duration");
});

test("a jump of more than one tile is not animated", () => {
  // A staircase, a blink, or a fresh level. Sliding smoothly across forty tiles
  // of solid rock would be a lie about what happened.
  const m = newMotion();
  const a = someone("a", 5, 5);
  noteMoves(m, [a], 0);
  a.pos = { x: 40, y: 60 };
  noteMoves(m, [a], 10);
  assert.equal(moving(m), false);
  assert.deepEqual(offsetOf(m, "a", 10), { dx: 0, dy: 0 });
});

test("nothing is remembered about an actor that has left", () => {
  // Otherwise both maps grow for the length of the run, one entry per creature
  // that has ever existed on any level.
  const m = newMotion();
  const a = someone("a", 1, 1), b = someone("b", 2, 2);
  noteMoves(m, [a, b], 0);
  a.pos = { x: 2, y: 1 };
  noteMoves(m, [a, b], 100);
  assert.equal(m.seen.size, 2);

  noteMoves(m, [b], 200);
  assert.equal(m.seen.size, 1, "it still remembers a creature that is gone");
  assert.ok(!m.slides.has("a"));
});

test("damage starts a short impact and reports one combat event", () => {
  const m = newMotion();
  const a = someone("a", 5, 5);
  noteMoves(m, [a], 0);

  a.pools.hp -= 12;
  const events = noteMoves(m, [a], 10);
  assert.deepEqual(events, [{ actorId: "a", x: 5, y: 5, kind: "hit" }]);
  assert.equal(m.impacts.length, 1);
  assert.equal(moving(m), true);

  assert.deepEqual(noteMoves(m, [a], 10 + IMPACT_MS + 1), []);
  assert.equal(moving(m), false, "an impact kept the render loop alive");
});

test("healing does not create an impact", () => {
  const m = newMotion();
  const a = someone("a", 5, 5);
  a.pools.hp = 50;
  noteMoves(m, [a], 0);
  a.pools.hp += 10;
  assert.deepEqual(noteMoves(m, [a], 10), []);
  assert.equal(m.impacts.length, 0);
});

test("an unknown actor has no offset rather than throwing", () => {
  const m = newMotion();
  assert.deepEqual(offsetOf(m, "nobody", 0), { dx: 0, dy: 0 });
});
