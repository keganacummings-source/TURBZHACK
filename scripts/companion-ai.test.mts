/**
 * Companions: they follow you, and they fight for you.
 *
 * A tamed beast that stands where you left it is not a companion, it is scenery.
 * These check the two things that make it feel alive on the same map: it closes
 * the gap when you walk away, and it goes for a hostile that comes near rather
 * than waiting to be told.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, makeGame, spawn } from "./lib/harness.mts";
import { monsterTurn, type AiCtx } from "../src/engine/ai.ts";
import { distance } from "../src/engine/grid.ts";
import type { Actor } from "../src/engine/actor.ts";

const reg = loadRegistry();

/** An AiCtx over a set of actors, with the registry maps the AI reads. */
function aiOver(actors: Actor[], player: Actor): AiCtx {
  const { ctx } = makeGame(reg, actors);
  return {
    ...ctx,
    player,
    enemies: reg.enemies as never,
    abilities: reg.abilities as never,
    spells: reg.spells as never,
  };
}

/** Turn a spawned creature into a tamed companion of the player's. */
function tamed(a: Actor): Actor {
  a.stance = "friendly";
  a.data["companion"] = true;
  return a;
}

test("a companion closes the gap when left behind", () => {
  const you = spawn(reg, "classes", "fighter", 3, 6, true);
  const wolf = tamed(spawn(reg, "enemies", "jackal", 14, 6));
  const ctx = aiOver([you, wolf], you);

  const before = distance(wolf.pos, you.pos);
  for (let i = 0; i < 6; i++) monsterTurn(wolf, { ...ctx, turn: i });
  assert.ok(distance(wolf.pos, you.pos) < before - 2,
    `the companion did not follow (was ${before}, now ${distance(wolf.pos, you.pos)})`);
});

test("a companion at your heel holds its ground", () => {
  const you = spawn(reg, "classes", "fighter", 6, 6, true);
  const wolf = tamed(spawn(reg, "enemies", "jackal", 7, 6));   // already adjacent-ish
  const ctx = aiOver([you, wolf], you);
  for (let i = 0; i < 4; i++) monsterTurn(wolf, { ...ctx, turn: i });
  assert.ok(distance(wolf.pos, you.pos) <= 2.5, "a heeling companion wandered off");
});

test("a companion attacks a hostile that comes near you", () => {
  const you = spawn(reg, "classes", "fighter", 6, 6, true);
  const wolf = tamed(spawn(reg, "enemies", "jackal", 7, 6));
  const rat = spawn(reg, "enemies", "rat", 8, 6);     // hostile, next to the wolf
  const ctx = aiOver([you, wolf, rat], you);

  const before = rat.pools.hp;
  for (let i = 0; i < 6; i++) monsterTurn(wolf, { ...ctx, turn: i });
  assert.ok(rat.pools.hp < before, "the companion ignored a hostile beside it");
});

test("a companion never turns on you or a neutral creature", () => {
  const you = spawn(reg, "classes", "fighter", 6, 6, true);
  const wolf = tamed(spawn(reg, "enemies", "jackal", 7, 6));
  const deer = spawn(reg, "enemies", "hog", 6, 7);
  deer.stance = "neutral";
  const ctx = aiOver([you, wolf, deer], you);

  const yourHp = you.pools.hp, deerHp = deer.pools.hp;
  for (let i = 0; i < 8; i++) monsterTurn(wolf, { ...ctx, turn: i });
  assert.equal(you.pools.hp, yourHp, "a companion hurt its owner");
  assert.equal(deer.pools.hp, deerHp, "a companion attacked a neutral creature");
});

test("a companion does not charge off after a distant wanderer", () => {
  const you = spawn(reg, "classes", "fighter", 6, 6, true);
  const wolf = tamed(spawn(reg, "enemies", "jackal", 7, 6));
  const farRat = spawn(reg, "enemies", "rat", 18, 10);    // hostile but far from you
  const ctx = aiOver([you, wolf, farRat], you);

  for (let i = 0; i < 5; i++) monsterTurn(wolf, { ...ctx, turn: i });
  assert.ok(distance(wolf.pos, you.pos) <= 3, "the companion abandoned you for a distant foe");
});
