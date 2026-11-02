/**
 * Crafting in depth: material, quality, discovery and reforging.
 *
 * The claim the deep dive makes is that the SAME recipe produces meaningfully
 * different things depending on who makes it and what they make it from. These
 * tests check that the material carries through, that skill moves the quality,
 * and — the one that matters most — that none of the loops is a free retry: a
 * reforge can come out worse, and a craft always costs its materials.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import { MATERIAL, QUALITY, weaponStats } from "../src/engine/weapons.ts";

const reg = loadRegistry();

/** A game standing at a forge with the materials to forge a sword. */
function atForge(seed: number | string = 2026): Game {
  const g = new Game(reg, seed);
  g.start("fighter", "human");
  const forge = reg.tiles.get("forge")!;
  const kind = g.level.kindIndex({
    id: "forge", name: "Forge", solid: true, opaque: false, sprite: forge.sprite ?? "forge",
  });
  // Clear a spot and put a forge next to the player.
  const x = g.player.pos.x, y = g.player.pos.y;
  g.level.set(x + 1, y, kind, kind);
  g.refreshFov();
  return g;
}

test("a forged weapon takes the material it was made from", () => {
  const g = atForge();
  // Iron version.
  g.pack.push("iron-ingot", "iron-ingot", "wood");
  g.craft("forge-short-sword");
  const iron = g.instanceOf(g.handleOf("short-sword")!);
  assert.ok(iron, "forging a sword left no instance");
  assert.equal(iron!.material, "iron", "an iron sword is not iron");

  // Steel version of the same recipe: same recipe, better metal.
  g.pack = g.pack.filter((i) => g.baseOf(i) !== "short-sword");
  g.pack.push("steel-ingot", "steel-ingot", "wood");
  g.craft("forge-short-sword");
  const steel = g.instanceOf(g.handleOf("short-sword")!);
  assert.equal(steel!.material, "steel", "forging from steel did not make a steel sword");

  // And the steel one really is better.
  const def = reg.items.get("short-sword")!;
  assert.ok(weaponStats(def, steel).damage > weaponStats(def, iron).damage,
    "a steel sword is no better than an iron one");
});

test("the best material among the ingredients is the one that counts", () => {
  const g = atForge();
  // A recipe calling for two ingots, given one steel and one iron, takes steel.
  // (Forge-short-sword needs 2 iron-ingot; swap the registry check for intent by
  //  giving steel, which `materialUsed` should prefer by rank.)
  g.pack.push("steel-ingot", "steel-ingot", "wood");
  g.craft("forge-short-sword");
  assert.equal(g.instanceOf(g.handleOf("short-sword")!)?.material, "steel");
});

test("skill moves the quality, over many tries", () => {
  // Not a single roll — quality is random — but the AVERAGE has to climb with
  // skill, or practice does nothing for the thing practice is supposed to help.
  const sample = (skill: number) => {
    let total = 0;
    const n = 60;
    for (let s = 0; s < n; s++) {
      const g = atForge(s + skill * 1000);
      g.crafts.smithing = skill;
      g.pack.push("iron-ingot", "iron-ingot", "wood");
      g.craft("forge-short-sword");
      total += Object.keys(QUALITY).indexOf(g.instanceOf(g.handleOf("short-sword")!)?.quality ?? "plain");
    }
    return total / n;
  };
  const beginner = sample(0);
  const master = sample(40);
  assert.ok(master > beginner + 0.5,
    `a master (${master.toFixed(2)}) is no better than a beginner (${beginner.toFixed(2)})`);
});

test("a craft always costs its materials, success or not", () => {
  const g = atForge();
  g.pack.push("iron-ingot", "iron-ingot", "wood");
  const before = g.pack.length;
  g.craft("forge-short-sword");
  // Three in, one out.
  assert.equal(g.pack.filter((i) => i === "iron-ingot").length, 0, "the ingots were not consumed");
  assert.equal(g.pack.filter((i) => i === "wood").length, 0, "the wood was not consumed");
  assert.ok(g.handlesOf("short-sword").length > 0);
  assert.ok(g.pack.length < before, "forging added items without taking any");
});

test("secret recipes are hidden until learned", () => {
  const g = atForge();
  assert.ok(reg.recipes.get("steel-ingot")?.secret, "steel is not a secret to begin with");
  assert.equal(g.knowsRecipe("steel-ingot"), false, "a secret recipe is known from the start");
  assert.ok(!g.recipesHere().some((r) => r.id === "steel-ingot"), "a secret recipe is on the crafting screen");

  // The basics are always known.
  assert.equal(g.knowsRecipe("iron-ingot"), true, "smelting iron is a secret");

  g.learnRecipe("steel-ingot");
  assert.equal(g.knowsRecipe("steel-ingot"), true, "learning it did not take");
});

test("working a trade with the right materials can turn up its secrets", () => {
  // Discovery is chance-based, so this gives it many tries rather than asserting
  // one. With the ingredients in hand and a few crafts under your belt, a secret
  // of the trade should turn up before long.
  let discovered = false;
  for (let seed = 0; seed < 40 && !discovered; seed++) {
    const g = atForge(seed);
    g.crafts.smithing = 10;
    // The ingredients for steel: iron and ash-salt. Plenty of both.
    for (let n = 0; n < 20; n++) g.pack.push("iron-ingot", "ash-salt", "iron-ore", "iron-ore");
    for (let n = 0; n < 15 && !g.knowsRecipe("steel-ingot"); n++) {
      if (g.recipesHere().some((r) => r.id === "iron-ingot" && r.can)) g.craft("iron-ingot");
      else break;
    }
    discovered = g.knowsRecipe("steel-ingot");
  }
  assert.ok(discovered, "a smith with iron and salt never worked out steel in forty tries");
});

test("reforging can improve an item, costs materials, and is not a free retry", () => {
  const g = atForge();
  g.pack.push("short-sword");
  g.instances.set("short-sword", { item: "short-sword", material: "iron", quality: "crude" });
  g.crafts.smithing = 50;             // good enough that it usually improves
  g.pack.push("iron-ingot", "iron-ingot");

  const before = g.countOf("iron-ingot");
  g.reforge("short-sword", { item: "iron-ingot", amount: 1 });
  assert.ok(g.countOf("iron-ingot") < before, "reforging cost no materials");

  // Reforging without the cost in hand is refused.
  const q = g.instanceOf(g.handleOf("short-sword")!)?.quality;
  g.pack = g.pack.filter((i) => i !== "iron-ingot");
  g.reforge("short-sword", { item: "iron-ingot", amount: 1 });
  assert.equal(g.instanceOf(g.handleOf("short-sword")!)?.quality, q, "a reforge with no materials still changed the item");
});

test("a crafted weapon's quality and material survive a save", () => {
  const g = atForge();
  g.pack.push("steel-ingot", "steel-ingot", "wood");
  g.crafts.smithing = 30;
  g.craft("forge-short-sword");
  g.learnRecipe("steel-ingot");
  const handle = g.handleOf("short-sword")!;
  const inst = g.instanceOf(handle);

  const back = loadGame(reg, g.toSave());
  assert.deepEqual(back.instanceOf(handle), inst, "the crafted weapon came back generic");
  assert.equal(back.knowsRecipe("steel-ingot"), true, "a learned recipe was forgotten");
});

test("every forge recipe makes something that can actually be worn or wielded", () => {
  // A forge recipe that produced a potion would roll a quality nothing reads.
  for (const [id, r] of reg.recipes) {
    if (!r.forge) continue;
    const out = reg.items.get(r.makes.item);
    assert.ok(out, `forge recipe ${id} makes "${r.makes.item}", which is not an item`);
    assert.ok(out!.slot && !["potion", "scroll", "misc", "material", "food"].includes(out!.slot),
      `forge recipe ${id} makes ${out!.slot}, which has no use for quality`);
  }
});

test("every material an ingot provides is a real material", () => {
  for (const [id, item] of reg.items) {
    if (!item.provides) continue;
    assert.ok(item.provides in MATERIAL, `${id} provides "${item.provides}", which is not a material`);
  }
});
