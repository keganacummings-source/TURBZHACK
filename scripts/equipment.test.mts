/**
 * Carrying, wearing, and finding.
 *
 * The thing that goes wrong in equipment systems is bookkeeping: a bonus that
 * stays behind after the sword comes off, a slot that eats what was in it, a
 * stat that drifts upward every time you re-equip. Every test here is really
 * about that.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, spawn } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import {
  SLOTS, applyLoadout, describe, equip, loadoutOf, slotsFor, unequip,
} from "../src/engine/equipment.ts";
import type { ItemDef, EnchantmentDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const items = reg.items as Map<string, ItemDef>;
const ench = reg.enchantments as Map<string, EnchantmentDef>;

test("the game has a real equipment table", () => {
  assert.ok(items.size >= 25, `only ${items.size} items`);
  const wearable = [...items.values()].filter((i) => slotsFor(i).length);
  assert.ok(wearable.length >= 20, `only ${wearable.length} wearable items`);
  // Every slot the game defines has something that fits it, or the slot is
  // decoration.
  const covered = new Set(wearable.flatMap((i) => slotsFor(i)));
  for (const slot of SLOTS) {
    if (slot === "ring2") continue;   // the same items as "ring"
    assert.ok(covered.has(slot), `nothing in the game can be worn in the "${slot}" slot`);
  }
});

test("a weapon is only a weapon in the weapon hand", () => {
  const sword: Record<string, string> = { weapon: "short-sword" };
  const inHand = loadoutOf(sword, items, ench);
  assert.ok(inHand.weapon, "a sword in the weapon hand gives no weapon");
  assert.equal(inHand.weapon!.damage, items.get("short-sword")!.damage);

  const offHand = loadoutOf({ offhand: "short-sword" }, items, ench);
  assert.equal(offHand.weapon, null, "a sword in the off-hand armed you anyway");
});

test("wearing and removing leaves no trace", () => {
  // The bug this guards against: stats that creep upward every time gear goes
  // on and off, because the totals were added rather than recomputed.
  const you = spawn(reg, "classes", "conjurer", 2, 2, true);
  const before = JSON.stringify([you.stats, you.armour, you.resist]);

  const pack = ["plate-armour", "shield", "ring-of-might"];
  const worn = {};
  for (const id of [...pack]) equip(pack, worn, id, items);
  applyLoadout(you, loadoutOf(worn, items, ench));
  const geared = JSON.stringify([you.stats, you.armour, you.resist]);
  assert.notEqual(geared, before, "wearing three things changed nothing");

  for (const slot of SLOTS) unequip(pack, worn, slot, items);
  applyLoadout(you, loadoutOf(worn, items, ench));
  assert.equal(
    JSON.stringify([you.stats, you.armour, you.resist]), before,
    "taking everything off did not put you back where you started");
});

test("equipping twenty times in a row does not inflate anything", () => {
  const you = spawn(reg, "classes", "conjurer", 2, 2, true);
  const pack = ["plate-armour"];
  const worn = {};

  equip(pack, worn, "plate-armour", items);
  applyLoadout(you, loadoutOf(worn, items, ench));
  const once = you.armour;

  for (let i = 0; i < 20; i++) {
    unequip(pack, worn, "body", items);
    equip(pack, worn, "plate-armour", items);
    applyLoadout(you, loadoutOf(worn, items, ench));
  }
  assert.equal(you.armour, once, `armour drifted from ${once} to ${you.armour}`);
});

test("putting something on a full slot returns what was there", () => {
  // Losing a good item by putting on a worse one would be the commonest way to
  // lose a good item, so it has to go back to the pack.
  const pack = ["robe", "plate-armour"];
  const worn = {};
  equip(pack, worn, "robe", items);
  assert.equal(worn.body, "robe");
  assert.deepEqual(pack, ["plate-armour"]);

  const out = equip(pack, worn, "plate-armour", items);
  assert.equal(out.ok, true);
  assert.equal(worn.body, "plate-armour");
  assert.deepEqual(pack, ["robe"], "the robe vanished instead of going back to the pack");
  assert.match(out.message, /put away/i);
});

test("two rings fit, a third does not displace both", () => {
  const pack = ["ring-of-might", "ring-of-focus", "ring-of-guarding"];
  const worn = {};
  equip(pack, worn, "ring-of-might", items);
  equip(pack, worn, "ring-of-focus", items);
  assert.equal(worn.ring, "ring-of-might");
  assert.equal(worn.ring2, "ring-of-focus");

  equip(pack, worn, "ring-of-guarding", items);
  const wornRings = [worn.ring, worn.ring2].filter(Boolean);
  assert.equal(wornRings.length, 2, "a third ring left you wearing something other than two");
  assert.equal(pack.length, 1, "a ring was lost putting a third one on");
});

test("you cannot wear a potion, or wear what you are not carrying", () => {
  const pack = ["potion-of-mending"];
  const worn = {};
  const no = equip(pack, worn, "potion-of-mending", items);
  assert.equal(no.ok, false);
  assert.match(no.message, /not something you can wear/i);

  const nope = equip([], {}, "plate-armour", items);
  assert.equal(nope.ok, false);
  assert.match(nope.message, /not carrying/i);
});

test("resistances from gear multiply rather than replace", () => {
  const load = loadoutOf({ ring: "ring-of-fire", amulet: "amulet-of-warding" }, items, ench);
  assert.ok(load.resist.fire! < 1, "a ring of fire gave no fire resistance");

  // And they compound with the wearer's own.
  const you = spawn(reg, "classes", "conjurer", 2, 2, true);
  you.baseResist = { fire: 0.5 };
  applyLoadout(you, load);
  assert.ok(you.resist.fire! < 0.5, "gear resistance did not compound with the wearer's own");
});

test("every item describes itself as something", () => {
  for (const [id, item] of items) {
    const text = describe(item);
    assert.notEqual(text, "no effect", `content/items/${id}.json has no effect at all`);
  }
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

test("you start wearing your class's kit, with the rest in the pack", () => {
  const g = new Game(reg, 2026);
  g.start("conjurer");
  assert.equal(g.worn.body, "robe", "the Conjurer did not put a robe on");
  assert.equal(g.worn.weapon, "ruin-staff", "the Conjurer is not holding a staff");
  // And the staff's focus bonus is actually on them.
  assert.ok(g.player.stats.focus > g.player.baseStats.focus, "the staff gave no focus");
});

test("what you are holding is what you swing", () => {
  const g = new Game(reg, 2026);
  g.start("conjurer");
  const staff = g.weaponAbility;
  assert.equal(staff.name, reg.items.get("ruin-staff")!.name);
  assert.equal(staff.damage, reg.items.get("ruin-staff")!.damage);

  g.remove("weapon");
  const fist = g.weaponAbility;
  assert.equal(fist.name, "Punch", "with nothing in hand you should be punching");
  assert.equal(fist.damage, reg.abilities.get("punch")!.damage);
});

test("the world has loot in it, and you can pick it up", () => {
  const g = new Game(reg, 4242);
  g.start("conjurer");

  // Find some.
  let found: { x: number; y: number } | null = null;
  for (let y = 0; y < g.level.h && !found; y++) {
    for (let x = 0; x < g.level.w; x++) {
      if (g.lootAt(x, y).length) { found = { x, y }; break; }
    }
  }
  assert.ok(found, "there is no loot anywhere in the world");

  const before = g.pack.length;
  g.player.pos = { ...found! };
  g.refreshFov();
  g.pickUp();
  assert.ok(g.pack.length > before, "standing on loot and pressing g picked nothing up");
  assert.equal(g.lootAt(found!.x, found!.y).length, 0, "the loot is still on the ground");
});

test("picking up nothing costs no turn", () => {
  const g = new Game(reg, 7);
  g.start("conjurer");
  // Somewhere with nothing on it.
  for (let y = 0; y < g.level.h; y++) {
    for (let x = 0; x < g.level.w; x++) {
      if (!g.level.solid(x, y) && !g.lootAt(x, y).length) { g.player.pos = { x, y }; break; }
    }
    if (!g.lootAt(g.player.pos.x, g.player.pos.y).length) break;
  }
  const turn = g.turn;
  g.pickUp();
  assert.equal(g.turn, turn, "picking up nothing passed the turn to the monsters");
});

test("dropping something leaves it where you stand", () => {
  const g = new Game(reg, 99);
  g.start("conjurer");
  // Drop whatever this background happens to be carrying.
  g.pack.push("potion-of-mending");
  g.drop("potion-of-mending");
  assert.ok(!g.pack.includes("potion-of-mending"), "it is still in the pack");
  assert.deepEqual(g.lootAt(g.player.pos.x, g.player.pos.y), ["potion-of-mending"]);
});

test("using a potion spends it and heals you", () => {
  const g = new Game(reg, 2026);
  g.start("conjurer");
  g.player.pools.hp = 10;
  g.player.pools.mana = 0;        // an item's spell is free; the charge is the cost
  g.pack.push("potion-of-mending");

  g.use("potion-of-mending");
  assert.ok(g.player.pools.hp > 10, "the potion of mending did not heal");
  assert.ok(!g.pack.includes("potion-of-mending"), "the potion was not used up");
  assert.equal(g.player.pools.mana, 0, "using an item cost mana");
});
