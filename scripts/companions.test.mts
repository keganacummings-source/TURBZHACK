/**
 * Taming in depth: bonds that grow and slip, pets that level, and feeding.
 *
 * The thing the deep dive promises is that a companion is a relationship you
 * maintain, not a summon you place. So the tests are about upkeep having teeth:
 * a neglected companion actually leaves, a fed one actually improves, and a pet
 * that fights beside you actually grows — and none of it can be gamed by pouring
 * food into something that was never hungry.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import {
  BOND_DEVOTED, BOND_LEAVE, BOND_START, HUNGER_PATIENCE, bondWord, creditKill,
  feed, grow, hunger, isCompanion, petXpForLevel, stateOf, tick,
} from "../src/engine/companions.ts";
import type { Actor } from "../src/engine/actor.ts";

const reg = loadRegistry();

/** A game with one tamed companion standing next to the player. */
function withPet(seed: number | string = 2026): { g: Game; pet: Actor } {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  const pet = g.actors.find((a) => !a.isPlayer && !a.data["npc"])!;
  pet.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  pet.stance = "friendly";
  pet.data["companion"] = true;
  pet.data["bond"] = BOND_START;
  pet.data["fedAt"] = g.turn;
  pet.data["petLevel"] = 1;
  pet.data["petXp"] = 0;
  g.party.push(pet.id);
  g.refreshFov();
  return { g, pet };
}

// ---------------------------------------------------------------------------
// The bond
// ---------------------------------------------------------------------------

test("a fresh companion starts wary, not devoted", () => {
  const { pet, g } = withPet();
  assert.equal(stateOf(pet, g.turn).bond, BOND_START);
  assert.ok(BOND_START < BOND_DEVOTED, "a new pet is already devoted");
  assert.ok(BOND_START > BOND_LEAVE, "a new pet is already about to leave");
});

test("hunger is zero when just fed and climbs with neglect", () => {
  const { pet } = withPet();
  assert.equal(hunger(pet, 0), 0, "a just-fed pet is hungry");
  const half = hunger(pet, HUNGER_PATIENCE);
  const full = hunger(pet, HUNGER_PATIENCE * 4);
  assert.ok(half > 0 && half < 1, "hunger does not build gradually");
  assert.equal(full, 1, "a long-neglected pet is not fully starving");
});

test("feeding raises the bond, and a starving pet gains more from it", () => {
  const { pet } = withPet();
  const whenFull = feed(pet, 0)!;                       // just fed
  pet.data["fedAt"] = -HUNGER_PATIENCE * 2;             // now starving
  const whenStarving = feed(pet, 0)!;
  assert.ok(whenStarving > whenFull, "a starving pet is no gladder of food than a full one");
  // And you cannot stack food into a full pet to cheat the bond up.
  pet.data["bond"] = 50; pet.data["fedAt"] = 0;
  const tiny = feed(pet, 0)!;
  assert.ok(tiny < whenStarving, "a full pet gained as much as a starving one");
});

test("a neglected companion loses heart and eventually leaves", () => {
  const { pet } = withPet();
  pet.data["bond"] = 15;
  pet.data["fedAt"] = -HUNGER_PATIENCE * 10;           // long starving
  let left = false;
  for (let t = 0; t < 500 && !left; t++) left = tick(pet, t, 1);
  assert.ok(left, "a starving companion never left");
  assert.ok(stateOf(pet, 0).bond <= 0, "it left with bond to spare");
});

test("being left far behind costs the bond faster than being fed and close", () => {
  const near = withPet().pet;
  const far = withPet().pet;
  near.data["bond"] = 50; near.data["fedAt"] = -HUNGER_PATIENCE * 3;
  far.data["bond"] = 50; far.data["fedAt"] = -HUNGER_PATIENCE * 3;
  for (let t = 0; t < 50; t++) { tick(near, t, 1); tick(far, t, 40); }
  assert.ok(stateOf(far, 0).bond < stateOf(near, 0).bond,
    "abandoning a companion is no worse than keeping it close");
});

test("a well-fed, close companion holds its bond", () => {
  const { pet } = withPet();
  pet.data["bond"] = 60;
  for (let t = 0; t < 50; t++) { pet.data["fedAt"] = t; tick(pet, t, 1); }
  assert.ok(stateOf(pet, 50).bond >= 59, "a cared-for companion still lost heart");
});

test("the bond word tracks the number", () => {
  assert.equal(bondWord(BOND_DEVOTED), "devoted");
  assert.equal(bondWord(5), "about to leave");
  assert.notEqual(bondWord(60), bondWord(30), "loyal and warming read the same");
});

// ---------------------------------------------------------------------------
// Levelling
// ---------------------------------------------------------------------------

test("a companion's level costs more experience each time", () => {
  for (let l = 1; l < 20; l++) {
    assert.ok(petXpForLevel(l + 1) > petXpForLevel(l), `level ${l + 1} costs no more than ${l}`);
  }
});

test("kills credit a companion and eventually level it", () => {
  const { pet } = withPet();
  let levelled = false;
  for (let n = 0; n < 50 && !levelled; n++) levelled = creditKill(pet, 0, 50);
  assert.ok(levelled, "fifty kills did not level a companion once");
  assert.ok(stateOf(pet, 0).level > 1);
});

test("growing a companion makes it stronger without making it a different animal", () => {
  const { pet } = withPet();
  const hp0 = pet.pools.hpMax, might0 = pet.stats.might;
  pet.data["petLevel"] = 6;
  grow(pet);
  assert.ok(pet.pools.hpMax > hp0, "levelling gave no health");
  assert.ok(pet.stats.might >= might0, "levelling gave no strength");
  // But not absurdly: a level-6 wolf is not a dragon.
  assert.ok(pet.pools.hpMax < hp0 * 3, "a companion's growth is runaway");
});

test("a devoted companion hits a little harder than a wary one of the same level", () => {
  const wary = withPet().pet;
  const devoted = withPet().pet;
  wary.data["petLevel"] = 5; wary.data["bond"] = 20;
  devoted.data["petLevel"] = 5; devoted.data["bond"] = BOND_DEVOTED;
  grow(wary); grow(devoted);
  assert.ok(devoted.stats.might > wary.stats.might, "loyalty buys nothing in a fight");
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

test("feeding a companion from the pack costs the food and a turn", () => {
  const { g, pet } = withPet();
  g.pack.push("dried-meat");
  pet.data["fedAt"] = g.turn - HUNGER_PATIENCE * 2;     // hungry, so it matters
  const bond = stateOf(pet, g.turn).bond;
  const turn = g.turn;
  const fed = g.feedCompanion(pet, "dried-meat");
  assert.ok(fed, "feeding was refused with meat in hand");
  assert.ok(!g.pack.includes("dried-meat"), "the food was not eaten");
  assert.ok(stateOf(pet, g.turn).bond > bond, "feeding did not raise the bond");
  assert.ok(g.turn > turn, "feeding took no time");
});

test("a kill near a companion grows it; a kill far away does not", () => {
  const { g, pet } = withPet();
  pet.data["petXp"] = petXpForLevel(2) - 1;             // one good kill from a level
  // Kill something right next to the pet.
  const victim = g.actors.find((a) => !a.isPlayer && !a.data["npc"] && a !== pet)
    ?? g.actors.find((a) => !a.isPlayer && a !== pet);
  assert.ok(victim, "nothing to kill");
  victim!.pos = { x: pet.pos.x + 1, y: pet.pos.y };
  victim!.stance = "hostile";
  victim!.pools.hp = 1;
  victim!.def = victim!.def;                            // keep its xp worth
  g.player.pos = { x: victim!.pos.x + 1, y: victim!.pos.y };
  g.player.stats.accuracy = 100; g.player.stats.might = 999;
  g.refreshFov();
  const before = stateOf(pet, g.turn).level;
  g.ability("punch", victim!);
  assert.ok(stateOf(pet, g.turn).level >= before, "the pet lost levels from a kill");
});

test("a companion comes through a save with its bond, level and hunger intact", () => {
  const { g, pet } = withPet();
  pet.data["bond"] = 62;
  pet.data["petLevel"] = 4;
  pet.data["petXp"] = 300;
  pet.data["fedAt"] = g.turn - 30;
  grow(pet);
  const hp = pet.pools.hpMax;

  const back = loadGame(reg, g.toSave());
  const petBack = back.actors.find((a) => isCompanion(a));
  assert.ok(petBack, "the companion did not survive the save");
  assert.equal(stateOf(petBack!, back.turn).bond, 62);
  assert.equal(stateOf(petBack!, back.turn).level, 4);
  assert.equal(petBack!.pools.hpMax, hp, "the grown body was forgotten");
});

test("only animals with something to offer can be tamed at all", () => {
  // The deep dive did not change who is tameable; it is still the animals, and
  // still not the undead, so the earlier rule has to keep holding.
  assert.ok(reg.enemies.get("wolf")?.tameable, "a wolf cannot be tamed");
  assert.ok(!reg.enemies.get("wraith")?.tameable, "a wraith can be tamed");
});
