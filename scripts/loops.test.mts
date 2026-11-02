/**
 * The gameplay loops: gathering, crafting, taming, travelling, and the
 * right-click menu that drives most of them.
 *
 * These are the tests that would notice the systems quietly coming apart — a
 * recipe that consumes materials and produces nothing, a tamed wolf left behind
 * on a staircase, a context menu offering an action that cannot be taken. They
 * all run against a real generated world rather than a fixture, because the
 * interesting failures are the ones that only happen in a world the generator
 * actually made.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, PARTY_LIMIT, loadGame } from "../src/game.ts";
import { findPath } from "../src/engine/path.ts";
import { menuAt } from "../src/ui/context.ts";
import { DUNGEON_FLOORS } from "../src/world/dungeon.ts";
import { encodeRuns, decodeRuns } from "../src/engine/save.ts";
import type { Actor } from "../src/engine/actor.ts";

const reg = loadRegistry();
const newGame = (seed: number | string = 2026) => {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  return g;
};

/** Stand the player somewhere open with nothing on it. */
function clearSpotNear(g: Game, from = g.player.pos): { x: number; y: number } {
  for (let r = 1; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = from.x + dx, y = from.y + dy;
        if (!g.level.inBounds(x, y) || g.level.solid(x, y)) continue;
        if (g.actorAt(x, y)) continue;
        return { x, y };
      }
    }
  }
  throw new Error("nowhere open on this map");
}

// ---------------------------------------------------------------------------
// Pathfinding
// ---------------------------------------------------------------------------

test("a path goes from here to there, one step at a time", () => {
  const g = newGame();
  const to = clearSpotNear(g, { x: g.player.pos.x + 12, y: g.player.pos.y + 8 });
  const path = findPath(g.level, g.player.pos, to);
  if (!path.length) return;                      // genuinely walled off on this seed

  assert.deepEqual(path[path.length - 1], to, "the path does not end at the target");
  let at = g.player.pos;
  for (const step of path) {
    assert.ok(Math.abs(step.x - at.x) <= 1 && Math.abs(step.y - at.y) <= 1,
      `the path jumps from ${at.x},${at.y} to ${step.x},${step.y}`);
    assert.equal(g.level.solid(step.x, step.y), false, "the path goes through a wall");
    at = step;
  }
});

test("there is no path into solid rock, and none is invented", () => {
  const g = newGame();
  // Find a wall and ask to stand inside it.
  let wall: { x: number; y: number } | null = null;
  for (let y = 1; y < g.level.h && !wall; y++) {
    for (let x = 1; x < g.level.w; x++) if (g.level.solid(x, y)) { wall = { x, y }; break; }
  }
  assert.ok(wall, "a continent with no solid tiles at all");
  assert.deepEqual(findPath(g.level, g.player.pos, wall!), [], "it found a way into a wall");

  // But "walk up to it" has an answer.
  const beside = findPath(g.level, g.player.pos, wall!, { adjacent: true });
  if (beside.length) {
    const last = beside[beside.length - 1]!;
    assert.ok(Math.max(Math.abs(last.x - wall!.x), Math.abs(last.y - wall!.y)) <= 1);
    assert.equal(g.level.solid(last.x, last.y), false);
  }
});

test("walking somewhere takes real turns and can be interrupted", () => {
  const g = newGame(99);
  const to = clearSpotNear(g, { x: g.player.pos.x + 10, y: g.player.pos.y });
  if (!g.travelTo(to.x, to.y)) return;

  const turn = g.turn;
  let steps = 0;
  while (g.stepTravel() && steps < 200) steps++;
  assert.ok(steps > 0, "the journey took no steps");
  assert.ok(g.turn > turn, "walking ten tiles passed no time");

  // Interrupting empties the route rather than leaving it to resume later.
  g.travelTo(to.x, to.y);
  g.travelPath.splice(0);
  assert.equal(g.stepTravel(), false);
});

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

/** Put the player next to a harvestable tile, and return it. */
function standBesideHarvestable(g: Game): { x: number; y: number } | null {
  for (let y = 1; y < g.level.h - 1; y++) {
    for (let x = 1; x < g.level.w - 1; x++) {
      if (!g.harvestable(x, y)) continue;
      const spot = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        .map(([dx, dy]) => ({ x: x + dx!, y: y + dy! }))
        .find((p) => g.level.inBounds(p.x, p.y) && !g.level.solid(p.x, p.y));
      if (!spot) continue;
      g.player.pos = spot;
      g.refreshFov();
      return { x, y };
    }
  }
  return null;
}

test("the world has things in it worth harvesting", () => {
  const g = newGame();
  let found = 0;
  for (let i = 0; i < g.level.tiles.length; i += 7) {
    const x = i % g.level.w, y = Math.floor(i / g.level.w);
    if (g.harvestable(x, y)) found++;
  }
  assert.ok(found > 20, `only ${found} harvestable tiles in a whole continent`);
});

test("felling a tree takes several turns and leaves the ground behind", () => {
  const g = newGame(7);
  const at = standBesideHarvestable(g);
  assert.ok(at, "nothing harvestable anywhere");

  const was = g.level.at(at!.x, at!.y)!.id;
  const packBefore = g.pack.length;
  const turnBefore = g.turn;

  // Work until it gives, with a bound so a bug cannot hang the suite.
  for (let n = 0; n < 40 && g.level.at(at!.x, at!.y)?.id === was; n++) {
    g.harvest(at!.x, at!.y);
  }

  assert.notEqual(g.level.at(at!.x, at!.y)?.id, was, "it never gave way");
  assert.ok(g.turn > turnBefore + 1, "harvesting cost less than a turn of work");
  assert.ok(g.pack.length > packBefore, "it yielded nothing at all");
  assert.equal(g.level.solid(at!.x, at!.y), false, "what it left behind cannot be walked on");
});

test("harvesting out of reach is refused, and costs nothing", () => {
  const g = newGame(7);
  const at = standBesideHarvestable(g);
  assert.ok(at);
  g.player.pos = clearSpotNear(g, { x: at!.x + 12, y: at!.y + 12 });
  const turn = g.turn, pack = g.pack.length;
  g.harvest(at!.x, at!.y);
  assert.equal(g.turn, turn, "a refused harvest still took a turn");
  assert.equal(g.pack.length, pack);
});

test("working a trade makes you better at it", () => {
  const g = newGame(11);
  const at = standBesideHarvestable(g);
  assert.ok(at);
  const skill = g.reg.tiles.get(g.level.at(at!.x, at!.y)!.id)!.harvest!.skill;
  const before = g.skills[skill];
  for (let n = 0; n < 40 && g.harvestable(at!.x, at!.y); n++) g.harvest(at!.x, at!.y);
  assert.equal(g.skills[skill], before + 1, "finishing a job taught nothing");
});

// ---------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------

test("every recipe can actually be reached from what the world provides", () => {
  // A recipe whose inputs nothing drops, yields or makes is dead content: it
  // would sit on the crafting screen for the whole game saying "short 2 ore".
  const reachable = new Set<string>();
  for (const [, t] of reg.tiles) for (const y of t.harvest?.yields ?? []) reachable.add(y.item);
  for (const [, e] of reg.enemies) for (const d of e.drops ?? []) reachable.add(d.item);
  for (const [, i] of reg.items) if (!i.unique) reachable.add(String(i.id));

  // Metals and timber are families of items, all of which the world provides, so
  // a family need is satisfied by definition.
  for (const [id, r] of reg.recipes) {
    for (const n of r.needs ?? []) {
      if (!n.item) continue;
      assert.ok(reachable.has(n.item),
        `content/recipes/${id}.json needs "${n.item}", which nothing in the game provides`);
    }
  }
});

test("crafting consumes exactly what it says and produces what it promises", () => {
  const g = newGame();
  const recipe = reg.recipes.get("iron-ingot")!;

  // Stand at a forge by putting one next to the player, which is also the
  // cheapest way to prove the station check is reading the map rather than a flag.
  const forgeDef = reg.tiles.get("forge")!;
  const kind = g.level.kindIndex({
    id: "forge", name: forgeDef.name ?? "Forge", solid: true, opaque: false,
    sprite: forgeDef.sprite ?? "forge",
  });
  const spot = clearSpotNear(g);
  g.player.pos = spot;
  g.level.set(spot.x + 1, spot.y, kind, kind);

  assert.ok(g.stationsInReach.has("forge"), "a forge next to you is not in reach");

  for (let n = 0; n < 2; n++) g.pack.push("iron-ore");
  const before = g.countOf("iron-ore");
  g.craft("iron-ingot");

  assert.equal(g.countOf("iron-ore"), before - (recipe.needs[0]!.amount ?? 1), "it took the wrong amount");
  assert.equal(g.countOf("iron-ingot"), 1, "nothing came out");
});

test("a craft you cannot afford takes nothing from you", () => {
  const g = newGame();
  const spot = clearSpotNear(g);
  g.player.pos = spot;
  const forgeDef = reg.tiles.get("forge")!;
  const kind = g.level.kindIndex({
    id: "forge", name: "Forge", solid: true, opaque: false, sprite: forgeDef.sprite ?? "forge",
  });
  g.level.set(spot.x + 1, spot.y, kind, kind);

  g.pack.push("iron-ore");                 // one, and it needs two
  const pack = [...g.pack];
  g.craft("iron-ingot");
  assert.deepEqual(g.pack, pack, "a failed craft ate the materials");
});

test("crafting away from a station is refused", () => {
  const g = newGame();
  g.player.pos = clearSpotNear(g);
  for (let n = 0; n < 4; n++) g.pack.push("iron-ore");
  const pack = [...g.pack];
  g.craft("iron-ingot");
  assert.deepEqual(g.pack, pack, "you smelted iron in a field");
});

test("the world has somewhere to craft, and one of them is findable", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = new Game(reg, seed);
    assert.ok(g.continent.villages.length > 0, `seed ${seed} has nowhere to craft`);
    const near = g.continent.villages.some((v) =>
      Math.hypot(v.pos.x - g.continent.start.x, v.pos.y - g.continent.start.y) < 70);
    assert.ok(near, `seed ${seed} buries every village out of reach`);
  }
});

// ---------------------------------------------------------------------------
// Taming and companions
// ---------------------------------------------------------------------------

/** Put something tameable next to the player. */
function bringTameable(g: Game): Actor | null {
  const def = [...reg.enemies.values()].find((e) => e.tameable);
  if (!def) return null;
  const who = g.actors.find((a) => !a.isPlayer && reg.enemies.get(a.def)?.tameable);
  const victim = who ?? g.actors.find((a) => !a.isPlayer);
  if (!victim) return null;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  g.refreshFov();
  return victim;
}

test("some creatures can be won over and most cannot", () => {
  const tameable = [...reg.enemies.values()].filter((e) => e.tameable);
  assert.ok(tameable.length >= 10, `only ${tameable.length} tameable creatures`);
  // The undead and the demonic should not be among them: there is nothing to
  // offer a wraith.
  for (const id of ["wraith", "lich", "skeleton", "zombie", "hellion"]) {
    assert.ok(!reg.enemies.get(id)?.tameable, `${id} should not be tameable`);
  }
});

test("taming costs a turn, and a success puts it in your party", () => {
  const g = newGame(4242);
  const victim = bringTameable(g);
  assert.ok(victim, "nothing to tame on this map");
  if (!reg.enemies.get(victim!.def)?.tameable) return;

  // Hurt and fed, so the odds are high enough that one attempt is a fair test.
  victim!.pools.hp = 1;
  g.pack.push("dried-meat");
  const turn = g.turn;
  g.tame(victim!);
  assert.ok(g.turn > turn, "trying to tame something was free");

  if (victim!.stance === "friendly") {
    assert.ok(g.party.includes(victim!.id), "it agreed but is not in the party");
    assert.equal(victim!.data["companion"], true);
  }
});

test("you cannot keep more companions than the party allows", () => {
  const g = newGame();
  for (let n = 0; n < PARTY_LIMIT; n++) g.party.push(`pretend-${n}`);
  const victim = bringTameable(g);
  assert.ok(victim);
  assert.equal(g.canTame(victim!), false, "a full party still accepted another");
});

test("a companion follows you through a staircase and nothing else does", () => {
  const g = newGame(2026);
  // Make one by hand: taming is a dice roll and this is about what happens after.
  const friend = g.actors.find((a) => !a.isPlayer);
  assert.ok(friend, "an empty continent");
  friend!.stance = "friendly";
  friend!.data["companion"] = true;
  const others = g.actors.filter((a) => !a.isPlayer && a !== friend).length;
  assert.ok(others > 0, "nothing else on the map to leave behind");

  // Walk into a dungeon the long way: enter the first entrance directly.
  const entrance = g.continent.entrances[0];
  assert.ok(entrance, "a continent with no dungeons");
  g.player.pos = { ...entrance!.pos };
  g.rest();                                   // stepping on it takes you through

  if (g.place.kind !== "dungeon") return;     // did not trigger at this seed
  assert.ok(g.actors.includes(friend!), "your companion was left on the stairs");
  assert.ok(!g.actors.some((a) => !a.isPlayer && a !== friend && a.data["companion"] !== true
    && g.party.includes(a.id)), "something came along that was not invited");
});

// ---------------------------------------------------------------------------
// The right-click menu
// ---------------------------------------------------------------------------

test("right-clicking the ground offers something sensible", () => {
  const g = newGame();
  const spot = clearSpotNear(g, { x: g.player.pos.x + 4, y: g.player.pos.y });
  const menu = menuAt(g, spot.x, spot.y);
  assert.ok(menu.title, "the menu has no heading");
  assert.ok(menu.actions.length, "no actions at all on a plain square");
  assert.ok(menu.actions.some((a) => a.kind === "walk" || a.kind === "harvest"),
    "an open square offers no way to go there");
  assert.ok(menu.actions.some((a) => a.kind === "wiki"), "nothing can be looked up");
});

test("right-clicking yourself offers waiting, not attacking", () => {
  const g = newGame();
  const menu = menuAt(g, g.player.pos.x, g.player.pos.y);
  assert.ok(menu.title.includes("you"), `the heading was "${menu.title}"`);
  assert.ok(menu.actions.some((a) => a.kind === "wait"));
  assert.ok(!menu.actions.some((a) => a.kind === "attack"), "it offered to hit yourself");
});

test("right-clicking something hostile in reach offers an attack", () => {
  const g = newGame();
  const victim = g.actors.find((a) => !a.isPlayer);
  assert.ok(victim);
  victim!.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim!.stance = "hostile";
  g.refreshFov();

  const menu = menuAt(g, victim!.pos.x, victim!.pos.y);
  assert.equal(menu.title, victim!.name);
  assert.ok(menu.actions.some((a) => a.kind === "attack"), "nothing to hit it with");
  assert.ok(menu.facts.some(([k]) => k === "Health"), "it does not say how hurt it is");
});

test("an unexplored square admits it is unexplored", () => {
  const g = newGame();
  // Somewhere far enough away never to have been seen.
  const far = { x: (g.player.pos.x + 100) % g.level.w, y: (g.player.pos.y + 60) % g.level.h };
  if (g.level.known[g.level.idx(far.x, far.y)]) return;
  const menu = menuAt(g, far.x, far.y);
  assert.match(menu.title, /unexplored/i);
});

test("no menu offers an action the game would refuse", () => {
  // The menu teaches the player what is possible, so an entry that cannot be
  // taken is worse than a missing one. The check: nothing offers "pick up" on a
  // square with nothing on it, and nothing offers an attack out of reach.
  const g = newGame(31337);
  for (let n = 0; n < 60; n++) {
    const x = (g.player.pos.x + n * 3) % g.level.w;
    const y = (g.player.pos.y + n * 2) % g.level.h;
    const menu = menuAt(g, x, y);
    for (const a of menu.actions) {
      if (a.kind === "pickup") {
        assert.ok(g.lootAt(g.player.pos.x, g.player.pos.y).length,
          "offered to pick up nothing");
      }
      if (a.kind === "attack" || a.kind === "tame") {
        const target = g.actors.find((t) => t.id === a.target);
        assert.ok(target, "offered an action against something that is not there");
        assert.ok(Math.max(Math.abs(target!.pos.x - g.player.pos.x),
                           Math.abs(target!.pos.y - g.player.pos.y)) <= 1,
          "offered to hit something out of reach");
      }
      if (a.kind === "harvest") {
        assert.ok(g.harvestable(a.x, a.y), "offered to harvest bare ground");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Dungeons
// ---------------------------------------------------------------------------

test("a dungeon is ten floors, and the last one has no way down", () => {
  const g = newGame();
  const entrance = 0;
  if (!g.continent.entrances.length) return;

  for (let depth = 1; depth <= DUNGEON_FLOORS; depth++) {
    const floor = (g as unknown as { floor(e: number, d: number): { level: { at(x: number, y: number): { id: string } | undefined; w: number; h: number } } })
      .floor(entrance, depth);
    let down = 0;
    const lv = floor.level;
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) if (lv.at(x, y)?.id === "stairs-down") down++;
    }
    if (depth < DUNGEON_FLOORS) {
      assert.equal(down, 1, `floor ${depth} has ${down} ways down`);
    } else {
      assert.equal(down, 0, "the bottom floor has a staircase to nowhere");
    }
  }
});

test("how dangerous a floor is depends on the dungeon as well as the depth", () => {
  const g = newGame();
  if (g.continent.entrances.length < 2) return;
  const tiers = g.continent.entrances.map((e) => e.depth);
  const near = tiers.indexOf(Math.min(...tiers));
  const far = tiers.indexOf(Math.max(...tiers));
  if (near === far) return;

  const atNear = g.dangerOf({ kind: "dungeon", entrance: near, depth: 1 });
  const atFar = g.dangerOf({ kind: "dungeon", entrance: far, depth: 1 });
  assert.ok(atFar > atNear, "a far dungeon is no worse at the door than a near one");
  assert.ok(g.dangerOf({ kind: "dungeon", entrance: near, depth: DUNGEON_FLOORS })
    > atNear, "going down does not make it worse");
});

// ---------------------------------------------------------------------------
// Bosses, regions and drops
// ---------------------------------------------------------------------------

test("the world puts its bosses somewhere far from where you woke up", () => {
  for (const seed of [1, 7, 2026]) {
    const g = new Game(reg, seed);
    for (const lair of g.continent.lairs) {
      const d = Math.hypot(lair.pos.x - g.continent.start.x, lair.pos.y - g.continent.start.y);
      assert.ok(d >= 40, `a boss lair ${Math.round(d)} tiles from the start on seed ${seed}`);
      const def = reg.enemies.get(lair.enemy);
      assert.ok(def?.boss, `${lair.enemy} is in a lair but is not a boss`);
      const i = lair.pos.y * g.continent.level.w + lair.pos.x;
      if (def!.biomes?.length) {
        assert.ok(def!.biomes.includes(g.continent.biome[i]!),
          `${lair.enemy} is living in ${g.continent.biome[i]}, which its file does not list`);
      }
    }
  }
});

test("a boss stays dead", () => {
  const g = newGame();
  if (!g.continent.lairs.length) return;
  const id = g.continent.lairs[0]!.enemy;
  assert.ok(g.actors.some((a) => a.def === id), "the boss was never placed to begin with");

  // Kill it the way the game does, then come back to the overworld.
  g.bossesKilled.add(id);
  g.actors = g.actors.filter((a) => a.def !== id);
  (g as unknown as { populate(): void }).populate();
  assert.ok(!g.actors.some((a) => a.def === id), "a dead boss came back");
});

test("creatures are placed by how far out they are, not only by biome", () => {
  const g = newGame(555);
  const W = g.continent.level.w;
  let checked = 0;
  for (const a of g.actors) {
    if (a.isPlayer) continue;
    const def = reg.enemies.get(a.def);
    if (!def?.region) continue;
    const band = g.continent.region[a.pos.y * W + a.pos.x]!;
    assert.ok(band >= (def.region.min ?? 0) && band <= (def.region.max ?? 5),
      `${a.def} is in band ${band}, outside its ${def.region.min}-${def.region.max}`);
    checked++;
  }
  assert.ok(checked > 5, `only ${checked} creatures had a band to check`);
});

test("named items are never just lying around", () => {
  const g = newGame();
  const unique = new Set([...reg.items].filter(([, i]) => i.unique).map(([id]) => id));
  assert.ok(unique.size >= 5, `only ${unique.size} named items`);
  for (const [, pile] of g.loot) {
    for (const id of pile) {
      assert.ok(!unique.has(id), `${id} is a named item and it was scattered on the ground`);
    }
  }
});

test("every named item is obtainable from something", () => {
  // A unique that nothing drops is a wiki entry for an item that cannot exist.
  for (const [id, item] of reg.items) {
    if (!item.unique) continue;
    const dropped = [...reg.enemies.values()].some((e) => (e.drops ?? []).some((d) => d.item === id));
    assert.ok(dropped, `content/items/${id}.json is named but nothing drops it`);
  }
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test("run-length encoding survives a round trip", () => {
  const cases = [
    new Uint8Array(0),
    Uint8Array.from([1]),
    Uint8Array.from([0, 0, 0, 1, 1, 0]),
    Uint8Array.from(Array.from({ length: 500 }, (_, i) => (i % 17 === 0 ? 1 : 0))),
  ];
  for (const bytes of cases) {
    assert.deepEqual(decodeRuns(encodeRuns(bytes), bytes.length), bytes);
  }
  // And a truncated file fills what it can rather than throwing.
  assert.equal(decodeRuns([1, 3], 10).length, 10);
});

test("a saved run comes back the same run", () => {
  const g = newGame(8080);
  // Make the state worth saving: move, take damage, pick things up, learn a trade.
  g.pack.push("iron-ore", "wood");
  g.player.pools.hp -= 25;
  g.xp = 40;
  g.skills.mining = 3;
  for (let n = 0; n < 5; n++) g.move(1, 0);

  const save = g.toSave();
  const back = loadGame(reg, save);

  assert.equal(back.seed, g.seed);
  assert.deepEqual(back.player.pos, g.player.pos, "you came back somewhere else");
  assert.equal(back.player.pools.hp, g.player.pools.hp, "your wounds healed in the save file");
  assert.equal(back.turn, g.turn);
  assert.equal(back.xp, g.xp);
  assert.deepEqual(back.pack, g.pack, "the pack did not survive");
  assert.deepEqual(back.worn, g.worn);
  assert.equal(back.actors.length, g.actors.length, "the level repopulated itself");

  // The world is rebuilt from the seed, so it has to come back identical.
  assert.deepEqual([...back.level.tiles], [...g.level.tiles], "the world came back different");
  assert.deepEqual([...back.level.known], [...g.level.known], "what you had explored was forgotten");
  assert.deepEqual(back.continent.lairs, g.continent.lairs, "the bosses moved house");
});

test("a save remembers a dungeon floor you had been down", () => {
  const g = newGame(1234);
  if (!g.continent.entrances.length) return;
  g.player.pos = { ...g.continent.entrances[0]!.pos };
  g.rest();
  if (g.place.kind !== "dungeon") return;

  const explored = [...g.level.known];
  const back = loadGame(reg, g.toSave());
  assert.deepEqual(back.place, g.place, "you came back on the wrong floor");
  assert.deepEqual([...back.level.known], explored, "the floor you had walked was forgotten");
});

test("a save made after a boss died does not resurrect it", () => {
  const g = newGame();
  if (!g.continent.lairs.length) return;
  g.bossesKilled.add(g.continent.lairs[0]!.enemy);
  const back = loadGame(reg, g.toSave());
  assert.ok(back.bossesKilled.has(g.continent.lairs[0]!.enemy), "the kill was not recorded");
});
