/**
 * What a swing costs in stamina, and what it does to a fight.
 *
 * Weight sets the cost, and the cost is what stops one heavy weapon being
 * swung forever. The tests here are about the shape of that: light weapons
 * must stay free to spam, heavy ones must not, the numbers must agree across
 * the sheet and the blow, and a tired fighter must be weak rather than stuck.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { STAMINA_PER_TURN } from "../src/engine/actor.ts";
import { swingCost, swingStamina, weaponStats, weaponWeight } from "../src/engine/weapons.ts";
import type { ItemDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const items = reg.items as Map<string, ItemDef>;
const ATTR = { strength: 10, agility: 10, endurance: 10, wits: 10, cunning: 10, presence: 10 };

const stamina = (id: string, attr = ATTR, skill = 0): number => {
  const def = items.get(id)!;
  return swingStamina(weaponStats(def), attr, skill, def.requires?.["strength"] ?? 0);
};
/** Stamina a weapon's own swing time gives back, which is what "sustainable" means. */
const regen = (id: string): number =>
  STAMINA_PER_TURN * swingCost(weaponStats(items.get(id)!), ATTR);

test("heavier weapons cost more to swing, class by class", () => {
  assert.ok(stamina("dagger") < stamina("short-sword"));
  assert.ok(stamina("short-sword") < stamina("mace"));
  assert.ok(stamina("mace") < stamina("maul"));
  // Within one class, the bigger weapon is the heavier one.
  assert.ok(stamina("club") < stamina("maul"), "a club costs as much as a maul");
  assert.ok(stamina("hatchet") < stamina("bearded-axe"), "a hatchet costs as much as a great axe");
});

test("light weapons can be swung forever and heavy ones cannot", () => {
  for (const id of ["dagger", "knife", "rondel", "short-sword", "oak-staff"]) {
    assert.ok(stamina(id) <= regen(id), `${id} drains you faster than you recover`);
  }
  for (const id of ["maul", "greatsword", "morningstar"]) {
    assert.ok(stamina(id) > regen(id), `${id} can be spammed for free`);
  }
});

test("spamming the heaviest weapon runs dry in a handful of blows", () => {
  // Run by someone strong enough to be carrying it without strain.
  const maul = stamina("maul", { ...ATTR, strength: 15 });
  let pool = 100;
  let swings = 0;
  while (pool >= maul && swings < 100) {
    pool -= maul;
    swings++;
    pool = Math.min(100, pool + Math.round(regen("maul")));
  }
  assert.ok(swings >= 3, `the maul runs dry after ${swings} swing(s), which is no weapon at all`);
  assert.ok(swings <= 8, `the maul can be swung ${swings} times in a row`);
});

test("a file's own weight beats the guess, and a fist weighs nothing", () => {
  const def = { ...items.get("short-sword")!, weight: 9 } as ItemDef;
  assert.equal(weaponWeight(def), 9);
  assert.equal(stamina("short-sword") < swingStamina(weaponStats(def), ATTR), true);
  const fists = weaponStats({ id: "punch", name: "Punch", damage: 5 } as ItemDef);
  assert.equal(swingStamina(fists, ATTR), 0);
});

test("strength, practice and strain move the cost, and never to nothing", () => {
  const base = stamina("maul");
  assert.ok(stamina("maul", { ...ATTR, strength: 18 }) < base, "Strength does not help");
  assert.ok(stamina("maul", ATTR, 15) < base, "practice does not help");
  assert.ok(stamina("maul", { ...ATTR, strength: 8 }) > base, "being under-strength does not hurt");
  assert.ok(stamina("maul", { ...ATTR, strength: 40 }, 100) >= 1, "it came out free");
  // A dagger stays cheap however strong you are: there is no reason for
  // Strength to make a dagger free.
  assert.ok(stamina("dagger", { ...ATTR, strength: 40 }, 100) >= 1);
});

const played = (cls = "fighter") => {
  const g = new Game(reg, 2026);
  g.start(cls);
  return g;
};

const arm = (g: Game, id: string): void => {
  g.pack.push(id);
  g.wear(g.handleOf(id)!);
};

const foe = (g: Game) => {
  const victim = g.actors.find((a) => !a.isPlayer)!;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim.stance = "hostile";
  victim.pools.hp = victim.pools.hpMax = 5000;
  victim.stats.evasion = 0;
  g.player.stats.accuracy = 100;
  g.refreshFov();
  return victim;
};

test("the weapon in hand carries its cost, and a swing pays it", () => {
  const g = played();
  arm(g, "maul");
  const cost = g.weaponAbility.stamina!;
  assert.ok(cost > 0, "a maul swing is free");
  const victim = foe(g);
  g.player.pools.stamina = g.player.pools.staminaMax;
  const before = g.player.pools.stamina;
  const hp = victim.pools.hp;
  g.ability("punch", victim);
  assert.ok(victim.pools.hp < hp, "the swing did nothing");
  // Spent, then a turn's recovery on the way back to the player's go.
  assert.ok(g.player.pools.stamina <= before - cost + 2 * STAMINA_PER_TURN, "the swing cost nothing");
  assert.ok(g.player.pools.stamina < before, "the swing cost nothing");
});

test("too winded for the weapon means a fist, not a stuck key", () => {
  const g = played();
  arm(g, "maul");
  const victim = foe(g);
  const fist = g.fistAbility.damage;
  g.player.pools.stamina = 0;
  const turn = g.turn;
  const hp = victim.pools.hp;
  const practice = g.skillIn("mace");
  g.ability("punch", victim);
  assert.ok(g.turn > turn, "the winded swing did not take the turn");
  const lost = hp - victim.pools.hp;
  assert.ok(lost <= fist + g.player.stats.might, `a winded swing hit for ${lost}, more than a fist (${fist})`);
  assert.equal(g.skillIn("mace"), practice, "a fist thrown while winded trained the mace");
  assert.ok(g.messages.some((m) => /winded/i.test(m.text)), "nothing said why");
});

test("walking into something while winded also falls back, and says so", () => {
  const g = played();
  arm(g, "maul");
  const victim = foe(g);
  g.player.pools.stamina = 0;
  const hp = victim.pools.hp;
  g.move(1, 0);
  assert.ok(victim.pools.hp <= hp, "the bump healed it");
  assert.ok(g.messages.some((m) => /winded/i.test(m.text)));
  // And a plain step with nothing there does not complain.
  const g2 = played();
  arm(g2, "maul");
  g2.player.pools.stamina = 0;
  const before = g2.messages.length;
  g2.move(0, 1);
  g2.move(0, -1);
  assert.ok(!g2.messages.slice(before).some((m) => /winded/i.test(m.text)), "a step said you were winded");
});

test("swapping to a light weapon is the answer to being winded", () => {
  const g = played();
  arm(g, "maul");
  arm(g, "dagger");
  g.player.pools.stamina = 20;
  assert.ok(g.weaponAbility.stamina! <= 20, "a dagger swing is out of reach at 20 stamina");
  assert.equal(g.meleeAttack().winded, null, "the dagger was refused");
});

test("fists stay free", () => {
  const g = played();
  g.remove("weapon");
  assert.equal(g.weaponAbility.stamina ?? 0, 0);
});
