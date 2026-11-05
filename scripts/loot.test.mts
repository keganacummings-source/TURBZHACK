/**
 * Where loot comes from.
 *
 * The world used to be carpeted in scattered gear and kills left only coin, so
 * everything was found rather than earned. These lock in the opposite: the
 * ground holds only the occasional find, and a slain creature is worth
 * searching — more so the more dangerous it was.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { DUNGEON_FLOORS } from "../src/world/dungeon.ts";

const reg = loadRegistry();

const played = (seed: number | string = 2026) => {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  return g;
};

/** Count the loot piles on a given level key prefix. */
function piles(g: Game, prefix: string): number {
  let n = 0;
  for (const [k] of (g as any).loot as Map<string, string[]>) if (k.startsWith(prefix)) n++;
  return n;
}

test("the ground is sparse now — a handful of finds, not a carpet", () => {
  let scattered = 0, total = 0, caches = 0;
  for (let s = 0; s < 8; s++) {
    const game = played(s);
    const cachePiles = game.continent.structures.filter((site) => site.cache).filter((site) =>
      game.loot.has(`o:${game.continent.level.idx(site.pos.x, site.pos.y)}`)).length;
    total += piles(game, "o:");
    caches += cachePiles;
    scattered += piles(game, "o:") - cachePiles;
  }
  const avg = scattered / 8;
  assert.ok(avg <= 9, `the overworld still scatters a lot of random loot (avg ${avg.toFixed(1)})`);
  assert.ok(avg >= 1, `the overworld scatters nothing at all (avg ${avg.toFixed(1)})`);
  assert.ok(caches > 0, "landmark caches add no special exploration finds");
  assert.ok(total / 8 <= 20, `the total loot density is too high (avg ${(total / 8).toFixed(1)})`);
});

test("a deep floor is not carpeted either", () => {
  const g = played(3);
  (g as any).enterLevel({ kind: "dungeon", entrance: 0, depth: DUNGEON_FLOORS }, (g as any).floor(0, DUNGEON_FLOORS).up);
  assert.ok(piles(g, `d0:${DUNGEON_FLOORS}:`) <= 12, "the deepest floor is still ankle-deep in loot");
});

/** Kill `n` copies of a creature through the real attack path; count the drops. */
function dropRate(enemyId: string, n: number): { drops: number; enchanted: number } {
  let drops = 0, enchanted = 0;
  for (let i = 0; i < n; i++) {
    const g = played(5000 + i);
    const def = reg.enemies.get(enemyId)!;
    const p = { ...g.player.pos };
    const a = (g as any).makeActor(enemyId, def, { x: p.x + 1, y: p.y });
    a.pools.hpMax = 1; a.pools.hp = 1; a.stance = "hostile";
    g.actors.push(a);
    g.player.stats.might = 99999; g.player.stats.accuracy = 100;
    g.move(1, 0);
    for (let dy = -1; dy <= 1 && true; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const pile = g.lootAt(p.x + 1 + dx, p.y + dy);
        if (pile.length) {
          drops++;
          for (const id of pile) if (g.instanceOf(id)?.affixes?.length) enchanted++;
          dy = 2; break;
        }
      }
    }
  }
  return { drops, enchanted };
}

test("ordinary creatures drop loot when killed", () => {
  // A mid-weight creature should leave something a decent fraction of the time —
  // the point of the change is that kills, not the floor, are the supply.
  const mid = [...reg.enemies.values()]
    .filter((e) => !e.boss && (e.xp ?? 0) >= 60)
    .sort((a, b) => (a.xp ?? 0) - (b.xp ?? 0))[0]!;
  // ~24% per kill for a mid creature; over 100 kills, well clear of this floor.
  const { drops } = dropRate(String(mid.id), 100);
  assert.ok(drops >= 10, `${mid.id} dropped on only ${drops}/100 kills — kills are not a real supply`);
});

test("the more dangerous the kill, the likelier the drop", () => {
  const weak = [...reg.enemies.values()].filter((e) => !e.boss).sort((a, b) => (a.xp ?? 0) - (b.xp ?? 0))[0]!;
  const strong = [...reg.enemies.values()].filter((e) => !e.boss).sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0))[0]!;
  const weakDrops = dropRate(String(weak.id), 60).drops;
  const strongDrops = dropRate(String(strong.id), 60).drops;
  assert.ok(strongDrops > weakDrops,
    `a ${strong.id} (${strongDrops}/60) was no more generous than a ${weak.id} (${weakDrops}/60)`);
});

test("drops and finds are never named items or raw materials", () => {
  // The scatter and kill pools share one filter; a unique on the ground or ore
  // dropped by a goblin would both be wrong.
  const pool = (played() as any).lootPool(6) as { unique?: boolean; slot?: string }[];
  assert.ok(pool.length > 0, "nothing is eligible to be found at all");
  for (const i of pool) {
    assert.ok(!i.unique, "a named item is in the find pool");
    assert.notEqual(i.slot, "material", "a raw material is in the find pool");
  }
});
