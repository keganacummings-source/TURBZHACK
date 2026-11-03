/**
 * Affixes: the random modifiers that make each piece of gear its own.
 *
 * Two things matter and both are tested. First, that every source of gear —
 * found, dropped, bought, crafted — can produce a distinct piece, so two of the
 * same base item are rarely identical. Second, and this is the one a bug hid in,
 * that one piece's affixes never bleed onto another: a scattered staff must not
 * change the staff in your hand. That is what the unique-handle plumbing is for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import {
  affixEffect, affixNames, affixValueFactor, isEnchantable, rollAffixes,
} from "../src/engine/affixes.ts";
import { Rng } from "../src/engine/rng.ts";

const reg = loadRegistry();
const ench = reg.enchantments;

test("the affix table has prefixes and suffixes, all well-formed", () => {
  assert.ok(ench.size >= 15, `only ${ench.size} affixes`);
  let prefixes = 0, suffixes = 0;
  for (const [id, a] of ench) {
    if (a.place === "suffix") suffixes++; else prefixes++;
    const effect = affixEffect([id], ench);
    const does = effect.armour || effect.might || effect.bonusDamage || effect.evasion
      || effect.accuracy || effect.hpMax || effect.manaMax || effect.speed
      || Object.keys(effect.attributes).length || Object.keys(effect.resist).length
      || effect.applies.length || effect.procs.length || effect.extraMove;
    assert.ok(does, `affix ${id} does nothing`);
  }
  assert.ok(prefixes >= 5 && suffixes >= 5, `${prefixes} prefixes, ${suffixes} suffixes`);
});

test("an affix only lands where it fits", () => {
  // A weapon affix on a boot would be nonsense, so slot filtering has to hold.
  const flaming = reg.items.get("short-sword")!;    // a weapon
  const boots = reg.items.get("boots")!;            // armour
  // Over many rolls, a weapon-only affix never appears on armour.
  for (let seed = 0; seed < 60; seed++) {
    for (const id of rollAffixes(boots, ench, new Rng(seed), { luck: 1 })) {
      const a = ench.get(id)!;
      assert.ok(!(a.slots ?? []).includes("weapon") || (a.slots ?? []).includes("feet"),
        `${id} landed on boots`);
    }
  }
  assert.ok(isEnchantable(flaming) && isEnchantable(boots));
});

test("potions and materials never take an affix", () => {
  for (const base of ["potion-of-mending", "iron-ore", "dried-meat"]) {
    const def = reg.items.get(base)!;
    assert.equal(isEnchantable(def), false, `${base} is enchantable`);
    assert.deepEqual(rollAffixes(def, ench, new Rng(1), { luck: 1 }), [], `${base} rolled an affix`);
  }
});

test("luck makes affixes likelier", () => {
  const def = reg.items.get("short-sword")!;
  const count = (luck: number) => {
    let total = 0;
    for (let s = 0; s < 100; s++) total += rollAffixes(def, ench, new Rng(s), { luck }).length;
    return total;
  };
  assert.ok(count(0.8) > count(0.05), "a lucky character finds no better gear");
});

test("an affix's name goes in the right place and its effect is real", () => {
  const prefix = [...ench].find(([, a]) => (a.place ?? "prefix") === "prefix")![0];
  const suffix = [...ench].find(([, a]) => a.place === "suffix")![0];
  const names = affixNames([prefix, suffix], ench);
  assert.ok(names.prefix, "the prefix produced no prefix word");
  assert.ok(names.suffix?.startsWith("of") || names.suffix, "the suffix produced no suffix word");

  const factor = affixValueFactor([prefix, suffix], ench);
  assert.ok(factor > 1, "affixes add nothing to an item's worth");
});

// ---------------------------------------------------------------------------
// In a real run — the collision that started all this
// ---------------------------------------------------------------------------

const played = (bg = "fighter", sp = "human", seed: number | string = 2026) => {
  const g = new Game(reg, seed);
  g.start(bg, sp);
  return g;
};

test("a found piece does not change the one in your hand", () => {
  /*
   * The bug that forced unique handles: instances keyed by base id meant a
   * scattered staff's affixes overwrote the staff the player was holding. The
   * conjurer starts with a plain Ruin Staff; whatever the world scattered, the
   * one in hand stays plain.
   */
  const g = played("conjurer", "human");
  const held = g.worn.weapon!;
  assert.equal(g.baseOf(held), "ruin-staff", "the conjurer is not holding a ruin staff");
  const inst = g.instanceOf(held);
  // A starting item has no rolled affixes, whatever the ground is littered with.
  assert.ok(!inst || !(inst.affixes?.length), "the starting staff picked up affixes from the ground");
  assert.equal(g.displayName(held).includes("of "), false, "the starting staff has a suffix");
});

test("two found copies of the same base are separate objects", () => {
  const g = played();
  // Give the player two daggers by hand, each minted and rolled.
  const a = (g as unknown as { mint(s: string): string }).mint("dagger");
  const b = (g as unknown as { mint(s: string): string }).mint("dagger");
  assert.notEqual(a, b, "two minted daggers share a handle");
  g.instances.set(a, { item: a, affixes: ["flaming"] });
  g.instances.set(b, { item: b, affixes: ["keen"] });
  assert.notDeepEqual(g.instanceOf(a), g.instanceOf(b), "the two daggers are the same object");
  // And they both resolve to the same base def.
  assert.equal(g.itemDef(a)!.name, g.itemDef(b)!.name);
});

test("an affixed weapon actually hits for its bonus", () => {
  const g = played();
  g.pack.push("short-sword");
  const handle = g.handleOf("short-sword")!;
  g.instances.set(handle, { item: handle, material: "iron", affixes: ["flaming"] });
  g.wear(handle);
  // Flaming adds fire damage, which lands as extra might on the swing.
  const plain = (() => {
    const g2 = played();
    g2.pack.push("short-sword"); const h = g2.handleOf("short-sword")!; g2.wear(h);
    return g2.weaponAbility.damage;
  })();
  assert.ok(g.weaponAbility.damage > plain, "a flaming sword hits no harder than a plain one");
  // And it applies burning.
  assert.ok((g.weaponAbility.applies ?? []).includes("burning"), "a flaming sword does not burn");
});

test("an affix of attributes raises the attribute while worn, and only while worn", () => {
  const g = played();
  g.pack.push("helm");
  const handle = g.handleOf("helm")!;
  g.instances.set(handle, { item: handle, affixes: ["of-the-bear"] });   // +2 strength
  const before = g.player.attributes.strength;
  g.wear(handle);
  assert.equal(g.player.attributes.strength, before + 2, "the helm of the bear gave no strength");
  g.remove("head");
  assert.equal(g.player.attributes.strength, before, "taking it off left the strength behind");
});

test("an affixed find is worth more, and the market pays the difference", () => {
  const g = played();
  g.pack.push("war-axe");
  const handle = g.handleOf("war-axe")!;
  const plain = g.worthOf(handle);
  g.instances.set(handle, { item: handle, material: "iron", affixes: ["vicious", "of-the-titan"] });
  assert.ok(g.worthOf(handle) > plain * 1.5, "two tier-3 affixes barely raised the worth");
});

test("affixes and their unique handles survive a save", () => {
  const g = played();
  g.pack.push("short-sword");
  const handle = g.handleOf("short-sword")!;
  g.instances.set(handle, { item: handle, material: "steel", affixes: ["flaming", "of-the-bear"] });
  g.wear(handle);
  const str = g.player.attributes.strength;

  const back = loadGame(reg, g.toSave());
  const wornBack = back.worn.weapon!;
  assert.equal(back.baseOf(wornBack), "short-sword");
  assert.deepEqual(back.instanceOf(wornBack)?.affixes, ["flaming", "of-the-bear"]);
  assert.equal(back.player.attributes.strength, str, "the worn bonus did not come back");
});

test("gear found on the ground comes up unique when you look at it", () => {
  // Walk a fresh world and check that at least some of the equipment lying
  // around has rolled an affix — otherwise generation is not wiring through.
  const g = played("fighter", "human", 4242);
  let affixed = 0, equipment = 0;
  for (const [, pile] of g.loot) {
    for (const id of pile) {
      const def = g.itemDef(id);
      if (!def || !isEnchantable(def)) continue;
      equipment++;
      if (g.instanceOf(id)?.affixes?.length) affixed++;
    }
  }
  if (equipment >= 10) assert.ok(affixed > 0, `none of ${equipment} found pieces had an affix`);
});

// ---------------------------------------------------------------------------
// Rendering: the ground, and the paper-doll
// ---------------------------------------------------------------------------

test("a ground item resolves to a real sprite, tint and shimmer", () => {
  const g = played();
  const h = (g as unknown as { mint(s: string): string }).mint("war-axe");
  g.instances.set(h, { item: h, material: "meteoric", quality: "plain", affixes: ["flaming", "of-the-titan"] });
  const look = g.itemLook(h);
  assert.equal(look.sprite, reg.items.get("war-axe")!.sprite, "a handled item lost its sprite");
  assert.ok(look.tint, "a meteoric item has no material tint");
  assert.ok(look.shimmer > 0, "an enchanted item does not shimmer");

  // A plain stackable has a sprite and no shimmer.
  const ore = g.itemLook("iron-ore");
  assert.equal(ore.sprite, reg.items.get("iron-ore")!.sprite);
  assert.equal(ore.shimmer, 0, "plain ore shimmers");
});

test("the player paper-doll shows worn gear, gated by the species' build", () => {
  // Humanoid shows everything it wears.
  const human = played("fighter", "human");
  human.pack.push("plate-armour"); human.wear(human.handleOf("plate-armour")!);
  human.pack.push("helm"); human.wear(human.handleOf("helm")!);
  const layers = human.playerLayers();
  assert.ok(layers[0] === human.player.sprite, "the base sprite is not the bottom layer");
  assert.ok(layers.includes("ovl-body-plate"), "a human in plate shows no plate");
  assert.ok(layers.includes("ovl-head-helm"), "a human in a helm shows no helm");
  assert.ok(layers.some((l) => l.startsWith("ovl-weapon-")), "a human shows no weapon");

  // An octopode shows a weapon and a hat, but never body armour or boots.
  const octo = played("fighter", "octopode");
  octo.pack.push("plate-armour"); octo.wear(octo.handleOf("plate-armour")!);
  octo.pack.push("boots"); octo.wear(octo.handleOf("boots")!);
  const octoLayers = octo.playerLayers();
  assert.ok(!octoLayers.includes("ovl-body-plate"), "an octopode is wearing visible plate");
  assert.ok(!octoLayers.includes("ovl-feet"), "an octopode has visible boots");

  // A naga wears everything but boots.
  const naga = played("fighter", "naga");
  naga.pack.push("boots"); naga.wear(naga.handleOf("boots")!);
  naga.pack.push("plate-armour"); naga.wear(naga.handleOf("plate-armour")!);
  const nagaLayers = naga.playerLayers();
  assert.ok(!nagaLayers.includes("ovl-feet"), "a naga has visible boots");
  assert.ok(nagaLayers.includes("ovl-body-plate"), "a naga shows no body armour");
});
