/**
 * Attributes and weapons.
 *
 * These two are tested together because they only mean anything together: an
 * attribute is a number until something scales off it, and a weapon class is a
 * label until the arm swinging it matters.
 *
 * The thing most worth holding here is BALANCE, which is not usually testable —
 * but some of it is. "No weapon class is simply better than another" is a real
 * property of the table, and so is "no attribute is worthless and none is
 * mandatory". Those are checked by computing the actual curves rather than by
 * reading them.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import {
  ATTRIBUTES, ATTRIBUTE_BASE, ATTRIBUTE_CEILING, ATTRIBUTE_FLOOR, ATTRIBUTE_INFO,
  POINTS_PER_LEVEL, clampAttribute, derive, explainPoint, newAttributes, withAttributes,
  type AttributeId,
} from "../src/engine/attributes.ts";
import {
  MATERIAL, MATERIALS, QUALITIES, QUALITY, WEAPON_CLASS, WEAPON_CLASSES,
  accuracyWith, classOf, damageWith, fullName, itemValue, qualityFor, swingCost, weaponStats,
} from "../src/engine/weapons.ts";
import { xpForLevel } from "../src/engine/progress.ts";
import type { ItemDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const average = newAttributes();

// ---------------------------------------------------------------------------
// The attributes themselves
// ---------------------------------------------------------------------------

test("every attribute is described, and the description is not the formula", () => {
  for (const id of ATTRIBUTES) {
    const info = ATTRIBUTE_INFO[id];
    assert.ok(info?.name && info.short && info.about, `${id} is not described`);
    assert.ok(info.about.length > 30, `${id}'s description says almost nothing`);
  }
});

test("an average character is average, and the derived numbers say so", () => {
  const d = derive(average);
  assert.equal(d.hpBonus, 0, "the average character has a health bonus");
  assert.equal(d.manaBonus, 0);
  assert.equal(d.evasion, 0);
  assert.equal(d.speed, 100, "the average character is not the standard pace");
  assert.equal(d.heavyDamage, 0);
  assert.equal(d.lightDamage, 0);
});

test("every attribute is worth something, and none of them is worth everything", () => {
  /*
   * Two failures this guards against, both of which make the whole system
   * decorative. An attribute that changes nothing is a point you must never
   * spend; one that changes everything is a point you must always spend. Either
   * way the choice disappears.
   */
  for (const id of ATTRIBUTES) {
    const raised = { ...average, [id]: ATTRIBUTE_BASE + 1 };
    const before = derive(average);
    const after = derive(raised);
    const changed = (Object.keys(after) as (keyof typeof after)[])
      .filter((k) => Math.abs(after[k] - before[k]) > 0.0001);
    assert.ok(changed.length > 0, `a point of ${id} changes nothing at all`);
    assert.ok(changed.length <= 6, `a point of ${id} changes ${changed.length} things, which is too many`);
  }
});

test("one point of anything is a small change, not a transformation", () => {
  // Ten points should be worth about ten times one point: a curve that is
  // superlinear makes dumping everything into one attribute the only correct
  // play, which is the commonest way an attribute system collapses.
  for (const id of ATTRIBUTES) {
    const one = derive({ ...average, [id]: ATTRIBUTE_BASE + 1 });
    const ten = derive({ ...average, [id]: ATTRIBUTE_BASE + 10 });
    const base = derive(average);
    for (const key of ["hpBonus", "manaBonus", "evasion", "heavyDamage", "lightDamage", "spellPower"] as const) {
      const step = one[key] - base[key];
      const big = ten[key] - base[key];
      if (!step) continue;
      assert.ok(big <= step * 11, `${id} compounds: one point gives ${step}, ten give ${big}`);
    }
  }
});

test("attributes clamp at both ends", () => {
  assert.equal(clampAttribute(-50), ATTRIBUTE_FLOOR);
  assert.equal(clampAttribute(9999), ATTRIBUTE_CEILING);
  assert.equal(clampAttribute(12.4), 12);
  // The floor is above zero on purpose: several things divide by these.
  assert.ok(ATTRIBUTE_FLOOR >= 1, "an attribute can reach zero");
  const floored = withAttributes(average, { strength: -500 });
  assert.equal(floored.strength, ATTRIBUTE_FLOOR);
  assert.equal(floored.agility, ATTRIBUTE_BASE, "clamping one attribute moved another");
});

test("the healing delay never disappears entirely", () => {
  // Otherwise backing off two squares heals you and no fight ever resolves.
  const tanky = { ...average, endurance: ATTRIBUTE_CEILING };
  assert.ok(derive(tanky).regenDelay >= 3, "enough Endurance makes healing instant");
});

test("what a point would do is described from the arithmetic, not by hand", () => {
  for (const id of ATTRIBUTES) {
    const text = explainPoint(average, id);
    assert.notEqual(text, "nothing", `a point of ${id} is described as doing nothing`);
    // It has to read as English, not as field names.
    assert.ok(!text.includes("Bonus") && !text.includes("hpBonus"), `"${text}" leaks a field name`);
  }
  // And at the ceiling it honestly reports that there is nothing left.
  const maxed = { ...average, strength: ATTRIBUTE_CEILING } as const;
  assert.equal(explainPoint(maxed, "strength"), "nothing");
});

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

test("no weapon class is simply better than another", () => {
  /*
   * The real question about a weapon table. Compare damage per turn at average
   * attributes: if one class is ahead of another on damage AND on accuracy AND
   * on speed AND on reach, there is no reason to ever pick the other one, and
   * the class choice is cosmetic.
   */
  const profile = (cls: typeof WEAPON_CLASSES[number]) => {
    const info = WEAPON_CLASS[cls];
    return {
      dps: (14 * info.damage) / info.speed,
      accuracy: info.accuracy,
      reach: info.reach,
      hands: info.twoHanded ? 1 : 2,
      focus: info.focus ?? 0,
    };
  };
  for (const a of WEAPON_CLASSES) {
    for (const b of WEAPON_CLASSES) {
      if (a === b || a === "unarmed" || b === "unarmed") continue;
      const x = profile(a), y = profile(b);
      // Spell power counts as an axis: a staff is a poor weapon and pays for
      // itself in what it does for casting, which is the trade it offers.
      const dominates = x.dps > y.dps && x.accuracy > y.accuracy
        && x.reach >= y.reach && x.hands >= y.hands && x.focus >= y.focus;
      assert.ok(!dominates, `${a} beats ${b} on every axis at once`);
    }
  }
});

test("damage per turn is in the same ballpark across the classes", () => {
  // Not equal — a bow should be worse per turn for its reach — but within a
  // factor, or one class is a trap and another is the only answer.
  const dps = WEAPON_CLASSES
    .filter((c) => c !== "unarmed" && c !== "staff")   // both are deliberately poor weapons
    .map((c) => (14 * WEAPON_CLASS[c].damage) / WEAPON_CLASS[c].speed);
  const low = Math.min(...dps), high = Math.max(...dps);
  assert.ok(high / low < 1.5, `damage per turn runs from ${low.toFixed(1)} to ${high.toFixed(1)}`);
});

test("reach and two-handedness are paid for", () => {
  // A weapon that reaches further has to give something up, or reach is free.
  for (const cls of WEAPON_CLASSES) {
    const info = WEAPON_CLASS[cls];
    if (info.reach <= 1) continue;
    const worse = info.accuracy < 0 || info.speed > 1 || info.twoHanded;
    assert.ok(worse, `${cls} reaches ${info.reach} squares and costs nothing for it`);
  }
});

test("every material and every quality is distinct and ordered", () => {
  // Two materials with identical numbers are one material with two names.
  const seen = new Set<string>();
  for (const id of MATERIALS) {
    const m = MATERIAL[id];
    const key = `${m.damage}:${m.armour}:${m.accuracy}`;
    assert.ok(!seen.has(key), `${id} is numerically identical to another material`);
    seen.add(key);
    assert.ok(m.value > 0, `${id} is worth nothing`);
  }
  // Quality is a ladder, so each rung has to be above the last.
  for (let i = 1; i < QUALITIES.length; i++) {
    const below = QUALITY[QUALITIES[i - 1]!], here = QUALITY[QUALITIES[i]!];
    assert.ok(here.damage > below.damage, `${QUALITIES[i]} is no better than ${QUALITIES[i - 1]}`);
    assert.ok(here.value > below.value, `${QUALITIES[i]} is worth no more than ${QUALITIES[i - 1]}`);
  }
});

test("a quality roll lands somewhere for every plausible score", () => {
  for (const roll of [-100, 0, 9, 10, 29, 30, 54, 55, 79, 80, 500]) {
    assert.ok(QUALITIES.includes(qualityFor(roll)), `a roll of ${roll} produced nothing`);
  }
  assert.equal(qualityFor(-5), "crude", "a terrible roll is not crude");
  assert.equal(qualityFor(999), "masterwork", "a perfect roll is not masterwork");
});

test("every weapon in the game names a class, and the class is real", () => {
  let weapons = 0;
  for (const [id, item] of reg.items) {
    if (item.slot !== "weapon") continue;
    weapons++;
    assert.ok(item.weaponClass, `content/items/${id}.json is a weapon with no class`);
    assert.ok((WEAPON_CLASSES as readonly string[]).includes(item.weaponClass!),
      `content/items/${id}.json has class "${item.weaponClass}", which does not exist`);
    assert.equal(classOf(item), item.weaponClass, "classOf disagrees with the file");
  }
  assert.ok(weapons >= 25, `only ${weapons} weapons in the game`);
});

test("every weapon class has at least one weapon you can actually find", () => {
  // A class with no weapon is a table entry nobody will ever see.
  for (const cls of WEAPON_CLASSES) {
    if (cls === "unarmed") continue;
    const any = [...reg.items.values()].some((i) => i.weaponClass === cls && !i.unique);
    assert.ok(any, `nothing in the game is a ${cls}`);
  }
});

test("a weapon's file number is what it does, undisturbed", () => {
  /*
   * The bug this comes from: the class and material multipliers were applied on
   * top of a number the author had already written knowing the class and the
   * material, so a wooden staff written as 9 damage came out at 5. A file says
   * what the weapon does; only a crafted copy's material and quality move it.
   */
  for (const [id, item] of reg.items) {
    if (item.slot !== "weapon" || !item.damage) continue;
    const stats = weaponStats(item);
    assert.equal(stats.damage, item.damage,
      `content/items/${id}.json says ${item.damage} damage and the game gives ${stats.damage}`);
  }
});

test("material and quality move a crafted copy, and show in its name", () => {
  const axe = reg.items.get("war-axe")!;
  const plain = weaponStats(axe);
  const good = weaponStats(axe, { item: "war-axe", material: "meteoric", quality: "masterwork" });

  assert.ok(good.damage > plain.damage * 1.5, "a masterwork meteoric axe is barely better");
  assert.ok(good.accuracy > plain.accuracy);
  assert.equal(fullName(axe), axe.name, "a plain one has a decorated name");
  assert.match(fullName(axe, { item: "war-axe", material: "meteoric", quality: "masterwork" }),
    /Masterwork Meteoric/);
  assert.ok(itemValue(axe, { item: "war-axe", material: "meteoric", quality: "masterwork" })
    > itemValue(axe) * 10, "the good one is not worth much more");
});

test("everything tradeable is worth something", () => {
  // A zero-value item is free to buy and worthless to sell, which looks like the
  // economy is broken rather than like a file is missing a field.
  for (const [id, item] of reg.items) {
    assert.ok(itemValue(item) > 0, `content/items/${id}.json is worth nothing`);
  }
});

test("who is holding it matters as much as what it is", () => {
  const axe = weaponStats(reg.items.get("war-axe")!);
  const dagger = weaponStats(reg.items.get("dagger")!);
  const strong = { ...average, strength: 20 };
  const quick = { ...average, agility: 20 };

  // The axe scales off Strength and the dagger off Agility, so each is better in
  // the right hands — which is the whole point of having classes.
  assert.ok(damageWith(axe, strong) > damageWith(axe, quick), "Strength does nothing for an axe");
  assert.ok(damageWith(dagger, quick) > damageWith(dagger, strong), "Agility does nothing for a dagger");
  assert.ok(accuracyWith(dagger, quick) > accuracyWith(dagger, average));
});

test("practice is worth the same proportion whatever you practise with", () => {
  // A flat bonus per skill point would make every point better spent on the
  // heavier weapon, and the class choice would collapse.
  const axe = weaponStats(reg.items.get("war-axe")!);
  const dagger = weaponStats(reg.items.get("dagger")!);
  const ratio = (w: ReturnType<typeof weaponStats>) =>
    damageWith(w, average, 50) / Math.max(1, damageWith(w, average, 0));
  assert.ok(Math.abs(ratio(axe) - ratio(dagger)) < 0.05,
    `practice is worth ${ratio(axe).toFixed(2)}x with an axe and ${ratio(dagger).toFixed(2)}x with a dagger`);
});

test("a fast weapon genuinely swings more often", () => {
  const dagger = weaponStats(reg.items.get("dagger")!);
  const maul = weaponStats(reg.items.get("maul")!);
  assert.ok(swingCost(dagger, average) < swingCost(maul, average), "a dagger is not faster than a maul");
  // And being quick helps, but cannot make an action free.
  const quick = { ...average, agility: ATTRIBUTE_CEILING };
  assert.ok(swingCost(dagger, quick) <= swingCost(dagger, average));
  assert.ok(swingCost(dagger, quick) >= 0.33, "a swing became free");
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

const newGame = (bg = "fighter", sp = "human", seed: number | string = 2026) => {
  const g = new Game(reg, seed);
  g.start(bg, sp);
  return g;
};

test("a species and a background both show in the attributes", () => {
  const minotaur = newGame("berserker", "minotaur");
  const elf = newGame("conjurer", "deep-elf");

  assert.ok(minotaur.player.attributes.strength > elf.player.attributes.strength + 6,
    "a minotaur berserker is not much stronger than a deep elf conjurer");
  assert.ok(elf.player.attributes.wits > minotaur.player.attributes.wits + 6);
  // And that reaches the pools, which is what the player sees.
  assert.ok(minotaur.player.pools.hpMax > elf.player.pools.hpMax);
  assert.ok(elf.player.pools.manaMax > minotaur.player.pools.manaMax);
});

test("attributes are the difference from average, not the finished number", () => {
  /*
   * The bug this comes from: the finished value was passed where a modifier was
   * expected, so every attribute was added to the base of ten and came out
   * doubled. It was invisible on the sheet, because 20 Strength is a perfectly
   * plausible number — it only showed up as a Conjurer with 134 health.
   */
  const g = newGame("fighter", "human");
  for (const id of ATTRIBUTES) {
    assert.ok(g.player.attributes[id] < 20,
      `${id} is ${g.player.attributes[id]}, which looks doubled`);
  }
  assert.equal(g.player.attributes.cunning, ATTRIBUTE_BASE, "a Fighter's Cunning is not average");
});

test("a level grants points, and spending one changes the character", () => {
  const g = newGame();
  const before = g.attributePoints;
  g.xp = xpForLevel(2);
  g.rest();
  assert.equal(g.attributePoints, before + POINTS_PER_LEVEL, "a level granted no points");

  const hp = g.player.pools.hpMax;
  assert.equal(g.raiseAttribute("endurance"), true);
  assert.ok(g.player.pools.hpMax > hp, "a point of Endurance gave no health");
  assert.equal(g.attributePoints, before + POINTS_PER_LEVEL - 1, "the point was not spent");
});

test("you cannot spend points you do not have", () => {
  const g = newGame();
  g.attributePoints = 0;
  const was = g.player.attributes.strength;
  assert.equal(g.raiseAttribute("strength"), false);
  assert.equal(g.player.attributes.strength, was, "it raised the attribute anyway");
});

test("raising a pool attribute does not leave you at death's door", () => {
  // Scaling the maximum must scale what is in it, or every point of Endurance
  // would arrive as a wound.
  const g = newGame();
  g.attributePoints = 5;
  g.player.pools.hp = g.player.pools.hpMax;
  g.raiseAttribute("endurance");
  assert.equal(g.player.pools.hp, g.player.pools.hpMax, "a point of Endurance left you hurt");
});

test("swinging a weapon is practice, and practice is per class", () => {
  const g = newGame();
  const victim = g.actors.find((a) => !a.isPlayer)!;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim.stance = "hostile";
  victim.pools.hp = 500;
  g.player.stats.accuracy = 100;
  g.refreshFov();

  const cls = g.heldClass;
  const before = g.skillIn(cls);
  g.ability("punch", victim);
  assert.equal(g.skillIn(cls), before + 1, "a swing taught nothing");
  // And nothing else improved.
  for (const other of WEAPON_CLASSES) {
    if (other === cls) continue;
    assert.equal(g.skillIn(other), 0, `swinging a ${cls} improved your ${other}`);
  }
});

test("what you are holding is what you swing, with its own reach and speed", () => {
  const g = newGame();
  g.pack.push("halberd");
  g.wear("halberd");
  const polearm = g.weaponAbility;
  assert.equal(polearm.range, WEAPON_CLASS.polearm.reach, "a halberd has a fist's reach");

  g.pack.push("dagger");
  g.wear("dagger");
  const knife = g.weaponAbility;
  assert.equal(knife.range, 1);
  assert.ok((knife.cost ?? 1) < (polearm.cost ?? 1), "a dagger is not quicker than a halberd");
});

test("a fast weapon buys more actions out of the world", () => {
  // The real test of swing cost: not what the number says, but whether the turn
  // counter moves less for a dagger than for a maul.
  const measure = (weapon: string) => {
    const g = newGame("fighter", "human", 55);
    g.pack.push(weapon);
    g.wear(weapon);
    const victim = g.actors.find((a) => !a.isPlayer)!;
    victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
    victim.stance = "hostile";
    victim.pools.hp = 100000;
    victim.pools.hpMax = 100000;
    g.player.stats.accuracy = 100;
    g.refreshFov();
    const from = g.turn;
    for (let n = 0; n < 10; n++) g.ability("punch", victim);
    return g.turn - from;
  };
  const quick = measure("dagger");
  const slow = measure("maul");
  assert.ok(quick < slow, `ten dagger swings took ${quick} turns and ten maul swings took ${slow}`);
});

test("armour you cannot carry costs you", () => {
  const weak = newGame("conjurer", "spriggan");
  weak.pack.push("plate-armour");
  const before = weak.player.stats.evasion;
  weak.wear("plate-armour");
  assert.ok(weak.player.stats.evasion < before,
    "a spriggan in plate armour dodges exactly as well as one without it");

  // And somebody who can carry it pays less for it.
  const strong = newGame("fighter", "troll");
  strong.pack.push("plate-armour");
  const trollBefore = strong.player.stats.evasion;
  strong.wear("plate-armour");
  const trollCost = trollBefore - strong.player.stats.evasion;
  const sprigganCost = before - weak.player.stats.evasion;
  assert.ok(trollCost < sprigganCost, "Strength does not help with armour");
});

test("attributes, practice and crafted items all survive a save", () => {
  const g = newGame();
  g.attributePoints = 3;
  g.raiseAttribute("strength");
  g.weaponSkills["axe"] = 17;
  g.instances.set("war-axe", { item: "war-axe", material: "steel", quality: "superior", maker: "You" });

  const back = loadGame(reg, g.toSave());
  assert.equal(back.player.attributes.strength, g.player.attributes.strength);
  assert.equal(back.player.baseAttributes.strength, g.player.baseAttributes.strength);
  assert.equal(back.attributePoints, 2);
  assert.equal(back.skillIn("axe"), 17);
  assert.deepEqual(back.instanceOf("war-axe"), g.instanceOf("war-axe"));
  assert.equal(back.player.pools.hpMax, g.player.pools.hpMax, "the body came back different");
});

test("a save written before attributes existed still opens", () => {
  const g = newGame();
  const save = g.toSave() as Record<string, unknown>;
  delete save["attributePoints"];
  delete save["weaponSkills"];
  delete save["instances"];
  for (const actor of save["actors"] as Record<string, unknown>[]) {
    delete actor["attributes"];
    delete actor["baseAttributes"];
  }
  const back = loadGame(reg, save as never);
  for (const id of ATTRIBUTES) {
    assert.equal(back.player.attributes[id as AttributeId], ATTRIBUTE_BASE,
      `${id} did not fall back to average`);
  }
  assert.equal(back.attributePoints, 0);
});
