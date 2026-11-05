import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { createQuickStart } from "../src/game/quickstart.ts";

const reg = loadRegistry();

test("QuickStart chooses a valid character reproducibly from the supplied seed", () => {
  const a = createQuickStart(reg, "quick-start-seed");
  const b = createQuickStart(reg, "quick-start-seed");
  assert.ok(reg.species.has(a.speciesId));
  assert.ok(reg.classes.has(a.classId));
  assert.equal(a.speciesId, b.speciesId);
  assert.equal(a.classId, b.classId);
  assert.ok(a.player.alive);
});

test("QuickStart places the player on a clear tile beside a dungeon staircase", () => {
  const game = createQuickStart(reg, 123456);
  assert.equal(game.place.kind, "overworld");
  const entrance = game.continent.entrances.find(({ pos }) =>
    Math.max(Math.abs(pos.x - game.player.pos.x), Math.abs(pos.y - game.player.pos.y)) === 1);
  assert.ok(entrance, "player is not adjacent to a dungeon entrance");
  assert.equal(game.level.solid(game.player.pos.x, game.player.pos.y), false);
  assert.equal(game.actorAt(game.player.pos.x, game.player.pos.y), game.player);
  assert.equal(game.level.at(entrance.pos.x, entrance.pos.y)?.on, "dungeon-entrance");
});
