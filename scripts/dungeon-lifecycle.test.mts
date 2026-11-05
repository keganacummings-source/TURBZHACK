import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import type { Level } from "../src/engine/grid.ts";
import { replacementDungeonSite } from "../src/world/continent.ts";
import { DUNGEON_FLOORS, DUNGEON_THEMES, centreOf, generateDungeon } from "../src/world/dungeon.ts";
import type { DungeonTheme } from "../src/world/dungeon.ts";

const reg = loadRegistry();

function reachable(level: Level, from: { x: number; y: number }): Set<number> {
  const seen = new Set([level.idx(from.x, from.y)]);
  const pending = [...seen];
  while (pending.length) {
    const at = pending.pop()!;
    const x = at % level.w, y = Math.floor(at / level.w);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!level.inBounds(nx, ny) || level.solid(nx, ny)) continue;
      const next = level.idx(nx, ny);
      if (!seen.has(next)) { seen.add(next); pending.push(next); }
    }
  }
  return seen;
}

test("each dungeon theme is deterministic and has its own terrain palette", () => {
  const expected: Record<DungeonTheme, [string, string]> = {
    jungle: ["grass", "wall-wood"],
    swamp: ["swamp", "wall-clay"],
    caves: ["stone", "wall-stone"],
    mansion: ["flagstone", "wall-wood"],
    crypt: ["ash", "wall-stone"],
  };
  const layouts = new Set<string>();

  for (const theme of DUNGEON_THEMES) {
    const first = generateDungeon(918273, 4, reg.tiles, "Test floor", 80, 44, theme);
    const again = generateDungeon(918273, 4, reg.tiles, "Test floor", 80, 44, theme);
    const kinds = new Set(first.level.palette.map((tile) => tile.id));
    assert.ok(kinds.has(expected[theme][0]), `${theme} has no themed floor`);
    assert.ok(kinds.has(expected[theme][1]), `${theme} has no themed wall`);
    assert.equal(first.theme, theme);
    assert.deepEqual(first.rooms, again.rooms, `${theme} room layout changed for a fixed seed`);
    assert.deepEqual([...first.level.tiles], [...again.level.tiles], `${theme} tiles changed for a fixed seed`);
    layouts.add(JSON.stringify(first.rooms));
  }

  assert.equal(layouts.size, DUNGEON_THEMES.length, "different themes produced the same room layout");
});

test("every themed dungeon keeps its rooms and stairs connected", () => {
  for (const theme of DUNGEON_THEMES) {
    const dungeon = generateDungeon(314159, DUNGEON_FLOORS, reg.tiles, "Connectivity check", 80, 44, theme);
    const open = reachable(dungeon.level, dungeon.up);
    for (const room of dungeon.rooms) {
      const center = centreOf(room);
      assert.ok(open.has(dungeon.level.idx(center.x, center.y)), `${theme} has an unreachable room`);
    }
    assert.ok(open.has(dungeon.level.idx(dungeon.down.x, dungeon.down.y)), `${theme} disconnected its lower stair`);
    assert.ok(dungeon.exit && open.has(dungeon.level.idx(dungeon.exit.x, dungeon.exit.y)),
      `${theme} disconnected its keeper exit`);
  }
});

test("world generation includes all dungeon themes on the expanded continent", () => {
  const game = new Game(reg, "theme-coverage-seed");
  assert.deepEqual(
    [...new Set(game.continent.entrances.map((site) => site.theme))].sort(),
    [...DUNGEON_THEMES].sort(),
  );
});

test("leaving a cleared dungeon retires it, replaces its site, and preserves other dungeons", () => {
  const game = new Game(reg, "cleared-dungeon-replacement");
  game.start("fighter", "human");
  const oldSite = { ...game.continent.entrances[0]!, pos: { ...game.continent.entrances[0]!.pos } };
  const otherSite = game.continent.entrances[1]!;
  const otherFloor = (game as any).floor(1, 2);
  const clearedFloor = (game as any).floor(0, 2);
  otherFloor.level.known[5] = 1;
  (game as any).loot.set("d0:2:5", ["old-dungeon-item"]);
  (game as any).loot.set("d1:2:5", ["untouched-dungeon-item"]);
  game.quests.push({
    id: "delve:0:5", def: "delve-dungeon", kind: "delve", village: 0,
    giver: "keeper", target: "0", need: 5, done: 2,
    ask: `Reach floor 5 of ${oldSite.name}.`, pay: 10, standing: 1,
  });
  game.quests.push({
    id: "delve:1:5", def: "delve-dungeon", kind: "delve", village: 0,
    giver: "keeper", target: "1", need: 5, done: 2,
    ask: `Reach floor 5 of ${otherSite.name}.`, pay: 10, standing: 1,
  });
  game.deepestIn.set(0, 2);
  game.deepestIn.set(1, 3);
  game.bossesKilled.add("keeper:0");

  const finalFloor = (game as any).floor(0, DUNGEON_FLOORS);
  assert.ok(finalFloor.exit, "final floor lacks the keeper's exit");
  (game as any).enterLevel({ kind: "dungeon", entrance: 0, depth: DUNGEON_FLOORS }, finalFloor.up);
  game.player.pos = { ...finalFloor.exit };
  assert.equal((game as any).useTile(), true);

  const newSite = game.continent.entrances[0]!;
  const expectedReplacement = replacementDungeonSite(
    new Game(reg, "cleared-dungeon-replacement").continent,
    game.seed,
    0,
    oldSite.pos,
    oldSite.pos,
    1,
  );
  assert.deepEqual(newSite, expectedReplacement, "replacement site was not deterministic");
  assert.notDeepEqual(newSite.pos, oldSite.pos, "cleared dungeon site was reused");
  assert.notEqual(newSite.name, oldSite.name);
  assert.ok(DUNGEON_THEMES.includes(newSite.theme));
  assert.notEqual(game.continent.level.at(oldSite.pos.x, oldSite.pos.y)?.on, "dungeon-entrance",
    "cleared entrance remains on the overworld");
  assert.equal(game.continent.level.at(newSite.pos.x, newSite.pos.y)?.on, "dungeon-entrance",
    "replacement has no dungeon entrance marker");
  assert.deepEqual(game.continent.entrances[1], otherSite, "another entrance was changed");
  assert.equal((game as any).floors.has("0:2"), false, "old dungeon floor cache survived replacement");
  assert.equal((game as any).floors.get("1:2"), otherFloor, "another dungeon's cached floor was discarded");
  assert.equal(game.deepestIn.has(0), false, "replacement inherited the old dungeon's depth record");
  assert.equal(game.deepestIn.get(1), 3, "another dungeon's depth record was lost");
  assert.equal(game.bossesKilled.has("keeper:0"), false, "replacement inherited the old keeper's defeated state");
  assert.equal((game as any).loot.has("d0:2:5"), false, "old dungeon loot leaked into its replacement");
  assert.deepEqual((game as any).loot.get("d1:2:5"), ["untouched-dungeon-item"],
    "another dungeon's loot was lost");
  assert.equal(game.quests[0]!.done, 0, "unfinished delve progress carried over to a new dungeon");
  assert.ok(game.quests[0]!.ask.includes(newSite.name), "unfinished delve quest still names the retired site");
  assert.equal(game.quests[1]!.done, 2, "another dungeon's quest progress was changed");
  const newFloor = (game as any).floor(0, 2);
  assert.notDeepEqual([...newFloor.level.tiles], [...clearedFloor.level.tiles],
    "replacement reused the cleared dungeon's layout");

  const replacementDistance = (x: number, y: number) => Math.hypot(newSite.pos.x - x, newSite.pos.y - y);
  assert.ok(replacementDistance(oldSite.pos.x, oldSite.pos.y) >= 14);
  assert.ok(replacementDistance(game.player.pos.x, game.player.pos.y) >= 20);
  assert.ok(game.continent.villages.every((v) => replacementDistance(v.pos.x, v.pos.y) >= 24));
  assert.ok(game.continent.lairs.every((l) => replacementDistance(l.pos.x, l.pos.y) >= 12));
  assert.ok(game.continent.entrances.slice(1).every((e) =>
    Math.max(Math.abs(newSite.pos.x - e.pos.x), Math.abs(newSite.pos.y - e.pos.y)) >= 14));

  const restored = loadGame(reg, JSON.parse(JSON.stringify(game.toSave())));
  assert.deepEqual(restored.continent.entrances[0], newSite, "save/load lost the replacement site");
  assert.equal(restored.dungeonGeneration(0), 1, "save/load lost the dungeon generation count");
  assert.notEqual(restored.continent.level.at(oldSite.pos.x, oldSite.pos.y)?.on, "dungeon-entrance");
  assert.equal(restored.continent.level.at(newSite.pos.x, newSite.pos.y)?.on, "dungeon-entrance");
  assert.equal((restored as any).floor(1, 2).level.known[5], 1,
    "save/load lost an untouched dungeon's exploration");
});

test("leaving a cleared dungeon by its upper stairs also spawns a replacement", () => {
  const game = new Game(reg, 7654321);
  game.start("fighter", "human");
  const old = { ...game.continent.entrances[0]!.pos };
  game.bossesKilled.add("keeper:0");
  const firstFloor = (game as any).floor(0, 1);
  (game as any).enterLevel({ kind: "dungeon", entrance: 0, depth: 1 }, firstFloor.up);
  game.player.pos = { ...firstFloor.up };
  assert.equal((game as any).useTile(), true);
  assert.equal(game.place.kind, "overworld");
  assert.notDeepEqual(game.continent.entrances[0]!.pos, old);
});
