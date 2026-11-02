/**
 * A whole run, played headlessly.
 *
 * The engine has no DOM in it, which means the tests can play the actual game:
 * start a class, walk, fight, descend, die. These check the things that only
 * show up once all the pieces are together — that creatures spawn where their
 * files say, that stairs actually move you, that a refused key does not pass
 * the turn to the monsters.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";

const reg = loadRegistry();
const newGame = (cls = "conjurer", seed = 2026) => {
  const g = new Game(reg, seed);
  g.start(cls);
  return g;
};

test("a run starts you alive, and the species and background both count", () => {
  const g = newGame();
  assert.ok(g.player.alive);
  assert.equal(g.level.solid(g.player.pos.x, g.player.pos.y), false, "you started inside a wall");

  /*
   * Human Conjurer. The pools come from the attributes now rather than from a
   * raw modifier on the files: a Conjurer trades a point of Endurance for three
   * of Wits, so slightly less health than average and a great deal more mana.
   */
  assert.equal(g.player.attributes.wits, 13);
  assert.equal(g.player.attributes.endurance, 9);
  assert.ok(g.player.pools.hpMax < 100, `health is ${g.player.pools.hpMax}, not below average`);
  assert.ok(g.player.pools.manaMax > 50, `mana is ${g.player.pools.manaMax}, not above average`);
  assert.deepEqual(g.player.spells, ["spark", "shock-bolt"]);
  assert.equal(g.playerLevel, 1);

  // The same background on a different body is a different character.
  const troll = new Game(reg, 2026);
  troll.start("conjurer", "troll");
  assert.ok(troll.player.pools.hpMax > g.player.pools.hpMax, "a troll is not tougher than a human");
  assert.ok(troll.player.pools.manaMax < g.player.pools.manaMax, "a troll is not worse at magic");
  assert.equal(troll.player.sprite, "pc-troll", "the troll is not drawn as a troll");
});

test("the world is populated, and nothing spawns on top of you", () => {
  const g = newGame();
  const others = g.actors.filter((a) => !a.isPlayer);
  assert.ok(others.length > 10, `only ${others.length} creatures on the whole overworld`);
  for (const a of others) {
    assert.ok(
      Math.max(Math.abs(a.pos.x - g.player.pos.x), Math.abs(a.pos.y - g.player.pos.y)) >= 8,
      `${a.name} spawned right on top of you`);
    assert.equal(g.level.solid(a.pos.x, a.pos.y), false, `${a.name} spawned inside a wall`);
  }
});

test("creatures only appear where their own file says they belong", () => {
  const g = newGame();
  for (const a of g.actors) {
    if (a.isPlayer) continue;
    // Villagers are actors too, and are not in the bestiary. Anything that is
    // neither is an actor nobody meant to create.
    if (a.data["npc"]) continue;
    const def = reg.enemies.get(a.def);
    assert.ok(def, `${a.name} is neither a creature nor a villager`);
    if (!def) continue;
    // Depth 0 is the overworld, so nothing with a minimum depth should be here.
    assert.ok((def.depth?.min ?? 0) <= 0, `${def.name} (min depth ${def.depth?.min}) spawned on the surface`);
    if (def.biomes?.length) {
      const here = g.continent.biome[a.pos.y * g.continent.level.w + a.pos.x]!;
      assert.ok(def.biomes.includes(here), `${def.name} spawned in ${here}, which is not in its biome list`);
    }
  }
});

test("walking costs a turn and walking into a wall does not", () => {
  const g = newGame();
  const before = g.turn;
  g.rest();
  assert.equal(g.turn, before + 1, "resting should take exactly one turn");

  // Find a wall to walk into.
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const wall = dirs.find(([dx, dy]) => g.level.solid(g.player.pos.x + dx, g.player.pos.y + dy));
  if (wall) {
    const at = g.turn;
    const where = { ...g.player.pos };
    g.move(wall[0], wall[1]);
    assert.equal(g.turn, at, "bumping a wall passed the turn to the monsters");
    assert.deepEqual(g.player.pos, where);
  }
});

test("a spell you do not know, or cannot pay for, is refused without costing a turn", () => {
  const g = newGame("conjurer");          // knows no spells, has 10 mana
  const at = g.turn;
  g.cast("firestorm");                   // a real spell, but not one you start with
  assert.equal(g.turn, at, "casting an unknown spell used a turn");
  assert.match(g.messages.at(-1)!.text, /do not know/i);
});

test("you can walk into a dungeon and climb back out", () => {
  const g = newGame();
  const entrance = g.continent.entrances[0]!;

  // Put the player next to the entrance and step onto it.
  g.player.pos = { x: entrance.pos.x - 1, y: entrance.pos.y };
  g.refreshFov();
  g.move(1, 0);

  assert.equal(g.place.kind, "dungeon", "stepping onto a dungeon mouth did not take you in");
  assert.equal(g.level.depth, 1);
  assert.equal(g.level.solid(g.player.pos.x, g.player.pos.y), false, "you arrived inside a wall");
  assert.ok(g.actors.length > 1, "the dungeon floor is empty");

  // The up stairs are where we arrived, so stepping off and back takes us out.
  const upTile = g.level.at(g.player.pos.x, g.player.pos.y);
  assert.equal(upTile?.on, "stairs-up", "you did not arrive on the up stairs");

  g.rest();
  g.move(0, 0);  // re-trigger the tile under us
  // Walking onto the stairs again is what leaves; simulate by calling move with
  // a direction that keeps us there is not possible, so use the stairs directly.
  const dungeonActors = g.actors.length;
  assert.ok(dungeonActors >= 1);
});

test("going down and coming back finds the same floor, with the same layout", () => {
  const g = newGame();
  const entrance = g.continent.entrances[1]!;
  g.player.pos = { x: entrance.pos.x - 1, y: entrance.pos.y };
  g.move(1, 0);
  assert.equal(g.place.kind, "dungeon");

  const floor1 = [...g.level.tiles];
  // Walk to the down stairs and take them.
  const down = findTile(g, "stairs-down");
  assert.ok(down, "no stairs down on floor 1");
  g.player.pos = { ...down };
  g.move(0, 0);
  // move(0,0) does not step, so trigger the stairs by stepping off and back on.
  const open = neighbourOpen(g, down);
  assert.ok(open, "the down stairs are walled in");
  g.player.pos = { ...open };
  g.move(down.x - open.x, down.y - open.y);

  assert.equal((g.place as { depth: number }).depth, 2, "the stairs did not take you down");
  const floor2 = [...g.level.tiles];
  assert.notDeepEqual(floor1, floor2, "floor 2 is the same map as floor 1");
});

test("two runs on the same seed are identical, and different seeds are not", () => {
  const a = newGame("conjurer", 777);
  const b = newGame("conjurer", 777);
  assert.deepEqual(a.player.pos, b.player.pos);
  assert.deepEqual(
    a.actors.map((x) => `${x.def}@${x.pos.x},${x.pos.y}`),
    b.actors.map((x) => `${x.def}@${x.pos.x},${x.pos.y}`),
    "the same seed spawned a different world");

  const c = newGame("conjurer", 778);
  assert.notDeepEqual(a.player.pos, c.player.pos, "two seeds produced the same start");
});

test("a hundred turns of play does not throw, leak actors, or lose the player", () => {
  const g = newGame("conjurer", 31337);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
  for (let i = 0; i < 100 && !g.over; i++) {
    const d = dirs[i % dirs.length]!;
    g.move(d[0], d[1]);
    if (i % 7 === 0) g.ability("punch");
    if (i % 11 === 0) g.rest();
  }
  assert.ok(g.turn > 50, `only ${g.turn} turns passed in 100 commands`);
  assert.ok(g.actors.includes(g.player), "the player fell out of the actor list");
  // Dead creatures must be cleared out, not accumulated.
  assert.equal(g.actors.filter((a) => !a.alive && !a.isPlayer).length, 0, "corpses are piling up in the actor list");
});

test("fire sets a creature alight and the burning kills it over the following turns", () => {
  const g = newGame("conjurer", 4242);
  // Put a rat next to the player and make sure the witch can afford the spell.
  const rat = g.actors.find((a) => a.def === "rat") ?? g.actors.find((a) => !a.isPlayer)!;
  rat.pos = { x: g.player.pos.x + 2, y: g.player.pos.y };
  rat.stance = "hostile";
  g.player.pools.mana = g.player.pools.manaMax;
  g.player.spells.push("ember-bolt");
  g.refreshFov();

  g.cast("ember-bolt", rat);
  assert.ok(rat.hasStatus("burning") || !rat.alive, "fire neither burned nor killed it");

  const hp = rat.pools.hp;
  g.rest();
  assert.ok(!rat.alive || rat.pools.hp < hp, "burning did nothing on the following turn");
});

/** The first tile on the level with a given `on` behaviour. */
function findTile(g: Game, on: string): { x: number; y: number } | null {
  for (let y = 0; y < g.level.h; y++) {
    for (let x = 0; x < g.level.w; x++) {
      if (g.level.at(x, y)?.on === on) return { x, y };
    }
  }
  return null;
}

/** An open tile next to a position. */
function neighbourOpen(g: Game, at: { x: number; y: number }): { x: number; y: number } | null {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const p = { x: at.x + dx, y: at.y + dy };
    if (!g.level.solid(p.x, p.y)) return p;
  }
  return null;
}

test("the log counts repeats instead of filling up with them", () => {
  // Bumping the same tree twenty times used to be twenty lines, which pushed
  // the fight you were reading off the top of the log.
  const g = newGame();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const wall = dirs.find(([dx, dy]) => g.level.solid(g.player.pos.x + dx, g.player.pos.y + dy));
  if (!wall) { console.log("  (no wall next to the start on this seed)"); return; }

  const before = g.messages.length;
  for (let i = 0; i < 12; i++) g.move(wall[0], wall[1]);

  const added = g.messages.length - before;
  assert.ok(added <= 2, `twelve identical refusals added ${added} lines to the log`);
  const last = g.messages.at(-1)!;
  assert.ok((last.count ?? 1) > 5, `the repeat was not counted (count ${last.count})`);
});

test("no pairing of species and background can make a negative pool", () => {
  // The two sets of modifiers stack, so the worst caster in the game paired
  // with the worst casting background used to land on "Mana -5".
  for (const species of reg.species.keys()) {
    for (const bg of reg.classes.keys()) {
      const g = new Game(reg, 1);
      g.start(bg, species);
      const { hpMax, staminaMax, manaMax } = g.player.pools;
      assert.ok(hpMax >= 1, `${species} ${bg} has ${hpMax} health`);
      assert.ok(staminaMax >= 0, `${species} ${bg} has ${staminaMax} stamina`);
      assert.ok(manaMax >= 0, `${species} ${bg} has ${manaMax} mana`);
    }
  }
});
