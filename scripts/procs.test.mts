/**
 * On-hit effects: the enchantments that do something beyond a flat bonus.
 *
 * These are what make a weapon an event rather than a stat stick — a strike that
 * leaps to the next creature, a blow that bursts fire around what it hits, a step
 * that sometimes comes free. Each kind is driven entirely by a `ProcDef` on an
 * affix, so the tests build the ability by hand and check the effect lands.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, makeGame, spawn } from "./lib/harness.mts";
import { useAbility } from "../src/engine/actions.ts";
import { Game } from "../src/game.ts";
import type { AbilityDef, ProcDef } from "../src/content/schema.ts";

const reg = loadRegistry();

/** An ability that always hits, carrying whatever procs a test wants. */
function swing(procs: ProcDef[], damage = 5): AbilityDef {
  return { id: "test-swing", name: "Test Swing", damage, kind: "physical", procs } as AbilityDef;
}

test("chain leaps from the struck creature to nearby others", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const a = spawn(reg, "enemies", "rat", 3, 2);
  const b = spawn(reg, "enemies", "rat", 4, 2);
  const c = spawn(reg, "enemies", "rat", 5, 2);
  const { ctx } = makeGame(reg, [you, a, b, c]);
  you.stats.accuracy = 100;

  const bHp = b.pools.hp, cHp = c.pools.hp;
  useAbility(ctx, you, swing([{ kind: "chain", damage: 6, jumps: 2 }]), a);
  assert.ok(b.pools.hp < bHp, "the arc did not reach the second creature");
  assert.ok(c.pools.hp < cHp, "the arc did not reach the third creature");
});

test("chain only jumps as far as it is told", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const a = spawn(reg, "enemies", "rat", 3, 2);
  const b = spawn(reg, "enemies", "rat", 4, 2);
  const c = spawn(reg, "enemies", "rat", 5, 2);
  const { ctx } = makeGame(reg, [you, a, b, c]);
  you.stats.accuracy = 100;

  const cHp = c.pools.hp;
  // One jump: it reaches b but must not go on to c.
  useAbility(ctx, you, swing([{ kind: "chain", damage: 6, jumps: 1 }]), a);
  assert.equal(c.pools.hp, cHp, "a one-jump arc reached a third creature");
});

test("burst catches everything around the struck creature", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const target = spawn(reg, "enemies", "rat", 5, 5);
  const near = spawn(reg, "enemies", "rat", 5, 6);     // adjacent to target
  const far = spawn(reg, "enemies", "rat", 9, 9);      // well outside the radius
  const { ctx } = makeGame(reg, [you, target, near, far]);
  you.stats.accuracy = 100;
  // Reach across the gap so the main blow lands; the burst is about the splash.
  const nearHp = near.pools.hp, farHp = far.pools.hp;
  useAbility(ctx, you, { ...swing([{ kind: "burst", damage: 8, radius: 1 }]), range: 10 }, target);
  assert.ok(near.pools.hp < nearHp, "the burst missed an adjacent creature");
  assert.equal(far.pools.hp, farHp, "the burst reached a creature outside its radius");
});

test("lifesteal heals the attacker for a share of the damage", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 3, 2);
  const { ctx } = makeGame(reg, [you, rat]);
  you.stats.accuracy = 100;
  you.hurt(60);
  const hurt = you.pools.hp;
  useAbility(ctx, you, swing([{ kind: "lifesteal", leech: 0.5 }], 20), rat);
  assert.ok(you.pools.hp > hurt, "lifesteal healed nothing");
});

test("execute finishes a creature already under the threshold", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 3, 2);
  const { ctx } = makeGame(reg, [you, rat]);
  you.stats.accuracy = 100;
  // Bring it low, then a tiny blow with execute should end it.
  rat.pools.hp = Math.max(1, Math.round(rat.pools.hpMax * 0.15));
  useAbility(ctx, you, swing([{ kind: "execute", threshold: 0.2 }], 1), rat);
  assert.equal(rat.alive, false, "execute did not finish a creature under the threshold");
});

test("knockback shoves the struck creature away", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 3, 2);
  const { ctx } = makeGame(reg, [you, rat]);
  you.stats.accuracy = 100;
  useAbility(ctx, you, { ...swing([{ kind: "knockback" }]), range: 1 }, rat);
  assert.equal(rat.pos.x, 4, "the creature was not shoved directly away");
});

test("a proc with chance 0 never fires", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const a = spawn(reg, "enemies", "rat", 3, 2);
  const b = spawn(reg, "enemies", "rat", 4, 2);
  const { ctx } = makeGame(reg, [you, a, b]);
  you.stats.accuracy = 100;
  const bHp = b.pools.hp;
  for (let i = 0; i < 20; i++) {
    a.pools.hp = a.pools.hpMax;    // keep the main target alive to swing at
    useAbility(ctx, you, swing([{ kind: "chain", damage: 6, chance: 0 }]), a);
  }
  assert.equal(b.pools.hp, bHp, "a chance-0 proc still fired");
});

test("a player's splash never catches a neutral bystander", () => {
  const you = spawn(reg, "classes", "fighter", 2, 2, true);
  const target = spawn(reg, "enemies", "rat", 5, 5);
  const villager = spawn(reg, "enemies", "rat", 5, 6);
  villager.stance = "neutral";                      // a townsperson standing nearby
  const { ctx } = makeGame(reg, [you, target, villager]);
  you.stats.accuracy = 100;
  const vHp = villager.pools.hp;
  useAbility(ctx, you, { ...swing([{ kind: "burst", damage: 8, radius: 2 }]), range: 10 }, target);
  assert.equal(villager.pools.hp, vHp, "a burst hit a neutral bystander");
});

// ---------------------------------------------------------------------------
// Through the real item path
// ---------------------------------------------------------------------------

const played = (bg = "fighter", sp = "human", seed: number | string = 7) => {
  const g = new Game(reg, seed);
  g.start(bg, sp);
  return g;
};

test("a weapon's proc affix reaches the swing it makes", () => {
  const g = played();
  g.pack.push("short-sword");
  const handle = g.handleOf("short-sword")!;
  g.instances.set(handle, { item: handle, material: "steel", affixes: ["levinbrand"] });
  g.wear(handle);
  const procs = g.weaponAbility.procs ?? [];
  assert.ok(procs.some((p) => p.kind === "chain"), "a levinbrand sword carries no chain proc");
});

test("a proc on a ring fires through the weapon in hand", () => {
  // Procs are gathered from everything worn, so an enchanted ring arcs lightning
  // even though the arc comes off the sword.
  const g = played();
  g.pack.push("short-sword");
  const sword = g.handleOf("short-sword")!;
  g.wear(sword);
  g.pack.push("ring-of-focus");
  const ring = g.handleOf("ring-of-focus") ?? g.pack.find((i) => g.baseOf(i) === "ring-of-focus")!;
  g.instances.set(ring, { item: ring, affixes: ["of-the-tempest"] });
  g.wear(ring);
  assert.ok((g.weaponAbility.procs ?? []).some((p) => p.kind === "chain"),
    "a ring's proc did not reach the weapon's swing");
});

test("boots of the wind set an extra-move chance on the wearer", () => {
  const g = played();
  g.pack.push("boots");
  const boots = g.handleOf("boots")!;
  g.instances.set(boots, { item: boots, affixes: ["of-the-wind"] });
  g.wear(boots);
  assert.ok(((g.player.data["extraMove"] as number) ?? 0) > 0,
    "boots of the wind granted no extra-move chance");
  g.remove("feet");
  assert.equal((g.player.data["extraMove"] as number) ?? 0, 0,
    "the extra-move chance stayed after the boots came off");
});

test("the signature boss weapons carry their on-hit effects", () => {
  const g = played();
  for (const base of ["ashmaw-fang", "the-long-patience"]) {
    const h = (g as unknown as { mint(s: string): string }).mint(base);
    g.pack.push(h);
    g.wear(h);
    assert.ok((g.weaponAbility.procs ?? []).length > 0, `${base} swings with no proc`);
    g.remove("weapon");
  }
});
