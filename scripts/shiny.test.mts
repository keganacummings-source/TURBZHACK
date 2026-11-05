import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { isShiny, shinyBonusCoins } from "../src/engine/shiny.ts";

const reg = loadRegistry();

test("shiny rolls are stable per seed and actor without consuming a shared random stream", () => {
  const first = isShiny(12345, "a27");
  assert.equal(isShiny(12345, "a27"), first);
  assert.equal(isShiny(12345, "a28"), isShiny(12345, "a28"));
  const shinyIds = Array.from({ length: 2400 }, (_, i) => `a${i}`)
    .filter((id) => isShiny(9876, id));
  assert.ok(shinyIds.length > 25 && shinyIds.length < 80, `unexpected rarity: ${shinyIds.length}/2400`);
});

test("shiny enemies receive a visible marker and always pay bonus coin when killed", () => {
  const game = new Game(reg, 2026);
  game.start("fighter");
  for (const actor of game.actors.filter((candidate) => reg.enemies.has(candidate.def))) {
    assert.equal(actor.data["shiny"] === true, isShiny(game.seed, actor.id), `${actor.name} has an inconsistent shiny roll`);
  }
  const enemy = game.actors.find((actor) => !actor.isPlayer && reg.enemies.has(actor.def));
  assert.ok(enemy, "the world did not spawn an enemy");
  if (!enemy) return;

  const direction = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
  ].find(({ x, y }) => {
    const tx = game.player.pos.x + x, ty = game.player.pos.y + y;
    return game.level.inBounds(tx, ty) && !game.level.solid(tx, ty) &&
      !game.actors.some((actor) => actor !== enemy && actor.pos.x === tx && actor.pos.y === ty);
  });
  assert.ok(direction, "there is no open neighboring tile for the test enemy");
  if (!direction) return;

  game.actors.splice(0, game.actors.length, game.player, enemy);
  enemy.pos = { x: game.player.pos.x + direction.x, y: game.player.pos.y + direction.y };
  enemy.stance = "hostile";
  enemy.data["shiny"] = true;
  enemy.name = `Shiny ${enemy.name}`;
  enemy.pools.hp = 1;
  enemy.pools.hpMax = 1;
  enemy.stats.evasion = -1000;
  game.player.stats.accuracy = 100;
  game.player.stats.might = 1000;
  game.player.pools.hp = game.player.pools.hpMax = 100_000;

  const enemyXp = reg.enemies.get(enemy.def)?.xp ?? 0;
  const expectedCoins = Math.round(enemyXp * 0.5) + shinyBonusCoins(enemyXp);
  for (let attempt = 0; attempt < 30 && enemy.alive; attempt++) {
    game.move(direction.x, direction.y);
  }
  assert.equal(enemy.alive, false, "the test failed to defeat its 1-HP enemy");
  assert.equal(game.coin, expectedCoins);
  assert.ok(game.messages.some((message) => message.text.includes("bonus coin")));
});
