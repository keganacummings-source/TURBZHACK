/**
 * The bottom of a dungeon: a keeper's hall, and the door it guards.
 *
 * Floor ten is the end of a delve, so three things have to hold: the keeper is
 * there, waiting in its arena; the door home will not open while the keeper
 * lives; and once the keeper falls the same door takes you straight back to
 * daylight rather than making you climb ten floors. The last one is the reward
 * for going all the way down.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { DUNGEON_FLOORS } from "../src/world/dungeon.ts";

const reg = loadRegistry();

/** A run standing on the final floor of its first dungeon. */
function onFinalFloor(seed: number | string = 2026): Game {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  const floor = (g as any).floor(0, DUNGEON_FLOORS);
  (g as any).enterLevel({ kind: "dungeon", entrance: 0, depth: DUNGEON_FLOORS }, floor.up);
  return g;
}

test("the final floor has a keeper waiting in its arena", () => {
  const g = onFinalFloor();
  const keeper = g.actors.find((a) => typeof a.data["keeper"] === "string");
  assert.ok(keeper, "no keeper on the final floor");
  const floor = (g as any).floor(0, DUNGEON_FLOORS);
  assert.ok(floor.boss, "the final floor recorded no boss spot");
  assert.deepEqual(keeper!.pos, floor.boss, "the keeper is not standing in its arena");
  // It is a scaled-up version of its kind — worth the descent.
  assert.ok(keeper!.name.includes("Keeper"), "the keeper is not named as one");
});

test("the door home exists on the final floor and nowhere else", () => {
  const g = onFinalFloor();
  const floor = (g as any).floor(0, DUNGEON_FLOORS);
  assert.ok(floor.exit, "the final floor has no exit door");
  assert.equal(g.level.at(floor.exit.x, floor.exit.y)?.on, "dungeon-exit", "the exit tile is not a door");

  const upper = (g as any).floor(0, 3);
  assert.equal(upper.exit, undefined, "a middle floor has an exit door it should not");
  assert.equal(upper.boss, undefined, "a middle floor has a boss arena it should not");
});

test("the door will not open while the keeper lives, and opens once it falls", () => {
  const g = onFinalFloor();
  const floor = (g as any).floor(0, DUNGEON_FLOORS);
  // Stand on the sealed door and try to use it.
  g.player.pos = { x: floor.exit.x, y: floor.exit.y };
  assert.equal((g as any).useTile(), false, "the sealed door let the player out early");
  assert.equal(g.place.kind, "dungeon", "the player left the dungeon through a sealed door");

  // Slay the keeper (mark its key dead, as a kill does), then the same door works.
  const key = `keeper:0`;
  g.bossesKilled.add(key);
  g.player.pos = { x: floor.exit.x, y: floor.exit.y };
  assert.equal((g as any).useTile(), true, "the open door did nothing");
  assert.equal(g.place.kind, "overworld", "the door did not lead back to the overworld");
});

test("felling the keeper in real combat opens the door home", () => {
  // The whole loop, through the real attack path: the kill must register (even
  // though the scheduler prunes the corpse the instant it dies), and then the
  // same door the player could not open now leads back to the surface.
  const g = onFinalFloor();
  const floor = (g as any).floor(0, DUNGEON_FLOORS);
  const keeper = g.actors.find((a) => typeof a.data["keeper"] === "string")!;
  keeper.pools.hp = 1;                         // a single honest blow will do
  g.player.pos = { x: keeper.pos.x - 1, y: keeper.pos.y };
  g.player.stats.might = 99999;
  g.player.stats.accuracy = 100;
  g.refreshFov();

  g.move(1, 0);                                // walk into it = attack it
  assert.ok(g.bossesKilled.has("keeper:0"), "the keeper's death was not recorded");

  g.player.pos = { x: floor.exit.x, y: floor.exit.y };
  assert.equal((g as any).useTile(), true, "the door did not open after the keeper fell");
  assert.equal(g.place.kind, "overworld", "the door did not lead home");
});

test("once the keeper is dead the floor no longer respawns one", () => {
  const g = onFinalFloor();
  g.bossesKilled.add("keeper:0");
  (g as any).enterLevel({ kind: "dungeon", entrance: 0, depth: DUNGEON_FLOORS }, (g as any).floor(0, DUNGEON_FLOORS).up);
  assert.equal(g.actors.some((a) => typeof a.data["keeper"] === "string"), false,
    "a slain keeper came back");
});

test("the Riftbell boss encounter is placed and guarantees its unique weapon", () => {
  const g = new Game(reg, "riftbell-lair-test");
  const boss = reg.enemies.get("riftbell-colossus");
  assert.ok(boss?.boss, "the Riftbell is not registered as a boss");
  assert.ok(g.continent.lairs.some((lair) => lair.enemy === "riftbell-colossus"),
    "the world did not place the Riftbell lair");
  assert.equal(boss.drops?.find((drop) => drop.item === "riftbell-hook")?.chance, 1,
    "the boss does not guarantee its weapon");
  assert.equal(reg.items.get("riftbell-hook")?.unique, true,
    "the boss weapon is not marked unique");
});
