import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, makeGame, spawn } from "./lib/harness.mts";
import { Actor } from "../src/engine/actor.ts";
import { Game, loadGame } from "../src/game.ts";
import { RING_SLOTS, speciesSlots, slotLabel, slotsFor } from "../src/engine/equipment.ts";
import { useAbility, moveOrAttack } from "../src/engine/actions.ts";
import type { Rng } from "../src/engine/rng.ts";
import type { ItemDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const items = reg.items as Map<string, ItemDef>;

test("Octopodes have eight tentacle ring slots and cannot wear body armor", () => {
  const slots = speciesSlots("octopode", "amorphous");
  assert.equal(slots.filter((slot) => RING_SLOTS.includes(slot)).length, 8);
  assert.ok(!slots.includes("body"));
  assert.equal(slotLabel("ring8", "octopode"), "Tentacle 8");
  assert.equal(slotsFor(items.get("ring-of-might")!).length, 8);

  const game = new Game(reg, 101);
  game.start("fighter", "octopode");
  game.pack.push(...Array(8).fill("ring-of-might"));
  for (let i = 0; i < 8; i++) game.wear("ring-of-might");
  assert.equal(RING_SLOTS.filter((slot) => !!game.worn[slot]).length, 8);

  game.pack.push("plate-armour");
  game.wear("plate-armour");
  assert.equal(game.worn.body, undefined);
  assert.ok(game.pack.includes("plate-armour"), "incompatible armor must remain in the pack");
});

test("loading legacy Octopode armor returns it safely to the pack", () => {
  const game = new Game(reg, 102);
  game.start("fighter", "octopode");
  game.worn.body = "plate-armour";
  const restored = loadGame(reg, game.toSave());
  assert.equal(restored.worn.body, undefined);
  assert.ok(restored.pack.includes("plate-armour"));
});

test("forms preflight mana, meld gear, persist, and expire", () => {
  const game = new Game(reg, 202);
  game.start("fighter");
  game.pack.push("plate-armour");
  game.wear("plate-armour");
  const plate = items.get("plate-armour")!;
  const armorBefore = game.player.armour;
  const turnBefore = game.turn;

  game.player.pools.mana = 14;
  assert.equal(game.transform("dire-bear"), false);
  assert.equal(game.turn, turnBefore, "a rejected transformation must not take a turn");
  assert.equal(game.worn.body, "plate-armour");

  game.player.pools.mana = 50;
  assert.equal(game.transform("dire-bear"), true);
  assert.equal(game.player.armour, armorBefore - (plate.armour ?? 0) - (items.get("shield")?.armour ?? 0) + 2);
  assert.equal(game.worn.body, "plate-armour", "melded equipment should remain worn");

  const restored = loadGame(reg, game.toSave());
  assert.equal(restored.activeForm?.id, "dire-bear");
  assert.equal(restored.worn.body, "plate-armour");
  assert.equal(restored.player.armour, game.player.armour);

  restored.actors = [restored.player];
  restored.activeForm = { id: "dire-bear", expiresAt: restored.turn + 1 };
  restored.rest();
  assert.equal(restored.activeForm, null, "the form should end at its expiry turn");
  assert.equal(restored.player.armour, armorBefore, "melded armor should reactivate after expiry");
});

test("kick pushes into a one-shot pit and immediately applies its effects", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const target = spawn(reg, "enemies", "rat", 3, 2);
  target.pools.hpMax = 500;
  target.pools.hp = 500;
  you.stats.accuracy = 1000;
  const { ctx, level } = makeGame(reg, [you, target]);
  ctx.rng = { next: () => 0 } as Rng;
  const floor = 0;
  const pit = level.kindIndex({
    id: "spiked-pit", name: "Spiked Pit", solid: false, opaque: false,
    sprite: "t-ash", on: "pit-trap",
  });
  level.set(4, 2, pit, floor);

  const kick = reg.abilities.get("kick")!;
  const result = useAbility(ctx, you, kick, target);
  assert.deepEqual(target.pos, { x: 4, y: 2 });
  assert.ok(target.pools.hp < 500, "the pit did no damage");
  assert.ok(target.statuses.some((status) => status.id === "pit-trapped"));
  assert.notEqual(level.at(4, 2)?.on, "pit-trap", "the pit should be consumed");
  assert.ok(result.messages?.some((message) => message.text.includes("spiked pit")));

  you.pos = { x: 3, y: 2 };
  const trappedAt = { ...target.pos };
  useAbility(ctx, you, kick, target);
  assert.deepEqual(target.pos, trappedAt, "a rooted target should resist another shove");
});

test("ordinary movement uses the same immediate pit resolution", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const { ctx, level } = makeGame(reg, [you]);
  const pit = level.kindIndex({
    id: "spiked-pit", name: "Spiked Pit", solid: false, opaque: false,
    sprite: "t-ash", on: "pit-trap",
  });
  level.set(3, 2, pit, 0);

  const before = you.pools.hp;
  const moved = moveOrAttack(ctx, you, 1, 0, reg.abilities.get("punch"));
  assert.equal(moved.tookTurn, true);
  assert.deepEqual(you.pos, { x: 3, y: 2 });
  assert.ok(you.pools.hp < before);
  assert.notEqual(level.at(3, 2)?.on, "pit-trap");
});

test("pit damage respects physical resistance", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  you.armour = 0;
  you.resist.physical = 0.5;
  const { ctx, level } = makeGame(reg, [you]);
  const pit = level.kindIndex({
    id: "spiked-pit", name: "Spiked Pit", solid: false, opaque: false,
    sprite: "t-ash", on: "pit-trap",
  });
  level.set(3, 2, pit, 0);

  const before = you.pools.hp;
  moveOrAttack(ctx, you, 1, 0, reg.abilities.get("punch"));
  assert.equal(before - you.pools.hp, 9);
});

test("kick collisions do not move a target through a wall or another creature", () => {
  for (const blockerKind of ["wall", "creature"] as const) {
    const you = spawn(reg, "classes", "fighter", 2, 2, true);
    const target = spawn(reg, "enemies", "rat", 3, 2);
    target.pools.hpMax = 500;
    target.pools.hp = 500;
    you.stats.accuracy = 1000;
    const blocker = blockerKind === "creature" ? spawn(reg, "enemies", "rat", 4, 2) : undefined;
    const actors = blocker ? [you, target, blocker] : [you, target];
    const { ctx, level } = makeGame(reg, actors);
    ctx.rng = { next: () => 0 } as Rng;
    if (blockerKind === "wall") level.set(4, 2, 1);

    const result = useAbility(ctx, you, reg.abilities.get("kick")!, target);
    assert.deepEqual(target.pos, { x: 3, y: 2 });
    assert.ok(target.pools.hp < 500, `${blockerKind} collision dealt no impact damage`);
    assert.ok(result.messages?.some((message) => message.text.includes("slams into")));
  }
});

test("kick force respects creature size and physical resistance", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const target = spawn(reg, "enemies", "two-headed-ogre", 3, 2);
  target.size = "huge";
  target.pools.hpMax = 500;
  target.pools.hp = 500;
  you.stats.accuracy = 1000;
  const { ctx } = makeGame(reg, [you, target]);
  ctx.rng = { next: () => 0 } as Rng;

  useAbility(ctx, you, reg.abilities.get("kick")!, target);
  assert.deepEqual(target.pos, { x: 3, y: 2 }, "a huge target should resist an ordinary kick");

  you.stats.might = 20;
  target.resist.physical = 0;
  useAbility(ctx, you, reg.abilities.get("kick")!, target);
  assert.deepEqual(target.pos, { x: 3, y: 2 }, "physical immunity should resist displacement");

  target.resist.physical = 1;
  useAbility(ctx, you, reg.abilities.get("kick")!, target);
  assert.deepEqual(target.pos, { x: 4, y: 2 }, "sufficient force should move a huge target");
  assert.equal(Actor.fromSave(target.toSave()).size, "huge", "creature size should survive save/load");
});

test("spent generated dungeon traps remain spent after save and load", () => {
  const game = new Game(reg, 303);
  game.start("fighter");
  game.place = { kind: "dungeon", entrance: 0, depth: 2 };
  const level = game.level;
  let pit: { x: number; y: number } | undefined;
  let approach: { x: number; y: number } | undefined;
  for (let y = 1; y < level.h - 1 && !pit; y++) {
    for (let x = 2; x < level.w - 1; x++) {
      if (level.at(x, y)?.on !== "pit-trap") continue;
      const neighbor = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ x: x + dx!, y: y + dy! }))
        .find((p) => !level.solid(p.x, p.y));
      if (neighbor) {
        pit = { x, y };
        approach = neighbor;
        break;
      }
    }
  }
  assert.ok(pit, "the generated floor should contain a reachable pit");

  game.actors = [game.player];
  game.player.pos = approach!;
  game.move(pit!.x - approach!.x, pit!.y - approach!.y);
  assert.notEqual(level.at(pit!.x, pit!.y)?.on, "pit-trap");

  const restored = loadGame(reg, game.toSave());
  assert.notEqual(restored.level.at(pit!.x, pit!.y)?.on, "pit-trap");
});
