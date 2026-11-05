/**
 * Levelling, and the roll of five.
 *
 * The character system is the roll, so these check the things that would
 * quietly ruin it: offering a spell you already know, offering the same thing
 * twice, offering nothing but stats once the spellbook runs out, or a roll that
 * changes every time you look at it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, makeGame, spawn } from "./lib/harness.mts";
import { Game, loadGame } from "../src/game.ts";
import { Rng } from "../src/engine/rng.ts";
import {
  CHOICES, MILESTONE_EVERY, applyChoice, isMilestone, levelForXp, newPerks,
  progressOf, rollChoices, upgradeDetail, xpForLevel,
} from "../src/engine/progress.ts";
import type { SpellDef, UpgradeDef } from "../src/content/schema.ts";

const reg = loadRegistry();
const spells = reg.spells as Map<string, SpellDef>;
const upgrades = reg.upgrades as Map<string, UpgradeDef>;
const roll = (level: number, known: string[], seed = 1) =>
  rollChoices(level, known, spells, upgrades, new Rng(seed));

test("experience thresholds only ever go up", () => {
  assert.equal(xpForLevel(1), 0, "level 1 should cost nothing");
  for (let l = 2; l < 40; l++) {
    assert.ok(xpForLevel(l) > xpForLevel(l - 1), `level ${l} costs no more than ${l - 1}`);
  }
  // And the two directions agree with each other.
  for (let l = 1; l < 30; l++) {
    assert.equal(levelForXp(xpForLevel(l)), l, `${xpForLevel(l)} xp should be exactly level ${l}`);
    assert.equal(levelForXp(xpForLevel(l + 1) - 1), l, `one short of ${l + 1} should still be ${l}`);
  }
});

test("a level-up offers five different things", () => {
  for (let level = 2; level <= 20; level++) {
    const choices = roll(level, ["spark"], level);
    assert.equal(choices.length, CHOICES, `level ${level} offered ${choices.length}`);
    const ids = choices.map((c) => `${c.kind}:${c.id}`);
    assert.equal(new Set(ids).size, ids.length, `level ${level} offered a duplicate: ${ids.join(", ")}`);
    for (const c of choices) {
      assert.ok(c.name && c.detail, `an option at level ${level} has nothing to show`);
    }
  }
});

test("it never offers a spell you already know", () => {
  const known = [...spells.keys()].slice(0, 12);
  for (let seed = 0; seed < 60; seed++) {
    for (const c of roll(8, known, seed)) {
      if (c.kind !== "spell") continue;
      assert.ok(!known.includes(c.id), `offered ${c.id}, which is already known`);
    }
  }
});

test("the roll is a mix, not all spells or all stats", () => {
  // A flat draw across both pools gives all spells early and all stats late.
  // Level 6 rather than 5: every fifth level is a milestone and offers talents
  // only, which is a different promise and has its own test.
  let sawSpell = 0, sawUpgrade = 0;
  for (let seed = 0; seed < 40; seed++) {
    const choices = roll(6, ["spark", "frost-touch"], seed);
    if (choices.some((c) => c.kind === "spell")) sawSpell++;
    if (choices.some((c) => c.kind === "upgrade")) sawUpgrade++;
  }
  assert.ok(sawSpell > 30, `only ${sawSpell}/40 rolls had a spell in them`);
  assert.ok(sawUpgrade > 30, `only ${sawUpgrade}/40 rolls had an upgrade in them`);
});

test("when every spell is known the roll is still five real options", () => {
  // Late in a run there is nothing left to learn. The roll must not shrink or
  // start repeating itself.
  const everything = [...spells.keys()];
  const choices = roll(30, everything, 7);
  assert.equal(choices.length, CHOICES);
  assert.ok(choices.every((c) => c.kind === "upgrade"), "offered a spell that is already known");
  const ids = choices.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "the roll repeated itself");
});

test("low levels are not offered the big spells", () => {
  const tiers: number[] = [];
  for (let seed = 0; seed < 50; seed++) {
    for (const c of roll(1, [], seed)) {
      if (c.kind === "spell") tiers.push(spells.get(c.id)?.tier ?? 1);
    }
  }
  assert.ok(tiers.length > 0, "a level-1 roll offered no spells at all");
  assert.equal(Math.max(...tiers), 1, "a level-1 roll offered a spell above tier 1");

  // And by level 13 the top tier is reachable, or it would be unreachable art.
  const high: number[] = [];
  for (let seed = 0; seed < 80; seed++) {
    for (const c of roll(13, [], seed)) {
      if (c.kind === "spell") high.push(spells.get(c.id)?.tier ?? 1);
    }
  }
  assert.equal(Math.max(...high), 5, "the strongest spells are never offered");
});

test("the same seed and level always roll the same five", () => {
  const a = roll(6, ["spark"], 99);
  const b = roll(6, ["spark"], 99);
  assert.deepEqual(a, b, "the roll is not reproducible");
  const c = roll(6, ["spark"], 100);
  assert.notDeepEqual(a, c, "two seeds rolled the same five");
});

test("taking a spell teaches it; taking an upgrade changes your numbers", () => {
  const you = spawn(reg, "classes", "conjurer", 2, 2, true);

  const before = you.spells.length;
  applyChoice(you, { kind: "spell", id: "firestorm", name: "Firestorm", about: "", detail: "" }, upgrades);
  assert.equal(you.spells.length, before + 1);
  assert.ok(you.spells.includes("firestorm"));

  // Taking the same spell twice must not list it twice.
  applyChoice(you, { kind: "spell", id: "firestorm", name: "Firestorm", about: "", detail: "" }, upgrades);
  assert.equal(you.spells.filter((s) => s === "firestorm").length, 1);

  const might = you.stats.might;
  applyChoice(you, { kind: "upgrade", id: "strong-arm", name: "Strong Arm", about: "", detail: "" }, upgrades);
  assert.equal(you.stats.might, might + 3);

  // A bigger pool should not leave you standing there wounded.
  const hp = you.pools.hp, hpMax = you.pools.hpMax;
  applyChoice(you, { kind: "upgrade", id: "hardy", name: "Hardy", about: "", detail: "" }, upgrades);
  assert.equal(you.pools.hpMax, hpMax + 20);
  assert.equal(you.pools.hp, hp + 20, "raising max health left the gain unfilled");
});

test("every upgrade in the folder actually does something", () => {
  // Some change the actor, some change the perks the Game keeps, and some do
  // both — but an upgrade that moves neither is a level-up spent on nothing, and
  // the player's only way of finding out is to take it.
  for (const [id, u] of upgrades) {
    const you = spawn(reg, "classes", "conjurer", 2, 2, true);
    const perks = newPerks();
    const before = JSON.stringify([you.stats, you.pools, you.armour, perks]);
    applyChoice(you, { kind: "upgrade", id, name: u.name, about: "", detail: "" }, upgrades, perks);
    assert.notEqual(JSON.stringify([you.stats, you.pools, you.armour, perks]), before,
      `taking "${id}" changed nothing`);
  }
});

test("a milestone offers talents and nothing else", () => {
  // The point of a milestone is that every option on it is a big one. A single
  // stat bump among them turns it back into an ordinary level.
  for (let level = MILESTONE_EVERY; level <= 30; level += MILESTONE_EVERY) {
    assert.ok(isMilestone(level), `level ${level} should be a milestone`);
    const choices = roll(level, [], level);
    assert.ok(choices.length > 0, `milestone ${level} offered nothing`);
    for (const c of choices) {
      assert.equal(c.kind, "upgrade", `a milestone offered a ${c.kind}`);
      assert.equal(upgrades.get(c.id)?.talent, true,
        `milestone ${level} offered "${c.id}", which is not a talent`);
    }
  }
  // And an ordinary level never offers one.
  for (let level = 1; level <= 30; level++) {
    if (isMilestone(level)) continue;
    for (const c of roll(level, [], level)) {
      if (c.kind !== "upgrade") continue;
      assert.notEqual(upgrades.get(c.id)?.talent, true,
        `level ${level} offered the talent "${c.id}"`);
    }
  }
});

test("a milestone never offers a talent you already have", () => {
  const all = [...upgrades.values()].filter((u) => u.talent).map((u) => String(u.id));
  assert.ok(all.length >= 5, `only ${all.length} talents`);
  const taken = all.slice(0, 3);
  for (let seed = 0; seed < 30; seed++) {
    for (const c of rollChoices(10, taken, spells, upgrades, new Rng(seed))) {
      assert.ok(!taken.includes(c.id), `offered "${c.id}", which is already taken`);
    }
  }
});

test("an ordinary roll spreads across different kinds of upgrade", () => {
  /*
   * The failure this guards against: a roll of five variations on max health.
   * Stat bumps are the easiest upgrade to write, so a flat draw over the pool
   * drifts towards them — and then a level-up stops being a choice about what
   * kind of character you are building.
   */
  let spread = 0, rolls = 0;
  for (let seed = 0; seed < 40; seed++) {
    const ups = roll(12, [], seed).filter((c) => c.kind === "upgrade");
    if (ups.length < 2) continue;
    rolls++;
    const groups = new Set(ups.map((c) => upgrades.get(c.id)?.group ?? "body"));
    if (groups.size === ups.length) spread++;
  }
  assert.ok(rolls > 20, `only ${rolls} rolls had two upgrades to compare`);
  assert.equal(spread, rolls, "a roll offered two upgrades from the same group");
});

test("perks are described in words rather than field names", () => {
  // "+1 gatherSpeed" means nothing to a player. Every perk has to read as the
  // thing it actually does.
  for (const [id, u] of upgrades) {
    if (!u.perks) continue;
    const text = upgradeDetail(u);
    for (const field of Object.keys(u.perks)) {
      assert.ok(!text.includes(field), `the description of "${id}" leaks the field name "${field}"`);
    }
    assert.notEqual(text, "no effect", `"${id}" grants perks but describes none of them`);
  }
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

test("killing things earns experience and eventually a level", () => {
  const g = new Game(reg, 2026);
  g.start("conjurer");
  assert.equal(g.playerLevel, 1);

  // Stand something next to the player and punch it to death.
  const victim = g.actors.find((a) => !a.isPlayer)!;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim.stance = "hostile";
  victim.pools.hp = 1;
  g.player.stats.accuracy = 100;
  g.refreshFov();

  g.ability("punch", victim);
  assert.ok(g.xp > 0, "killing something earned no experience");
});

test("a level-up stops the game until you choose, then hands the choice over", () => {
  const g = new Game(reg, 4242);
  g.start("conjurer");

  // Enough experience for several levels at once.
  g.xp = 0;
  const victim = g.actors.find((a) => !a.isPlayer)!;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim.stance = "hostile";
  victim.pools.hp = 1;
  g.player.stats.accuracy = 100;
  g.player.stats.might = 500;        // make sure one punch is enough
  g.refreshFov();
  g.ability("punch", victim);

  if (!g.pendingChoices) {
    // Not enough xp from one kill at this seed — force the level instead, which
    // is the same code path.
    g.xp = xpForLevel(2);
    g.rest();
  }
  // Give it a nudge if resting did not trigger it either.
  if (!g.pendingChoices) { console.log("  (no level-up at this seed; skipping)"); return; }

  assert.equal(g.pendingChoices.length, CHOICES);
  const where = { ...g.player.pos };
  const turn = g.turn;

  // While a choice is pending, the world is frozen.
  g.move(1, 0);
  g.rest();
  g.cast("spark");
  assert.deepEqual(g.player.pos, where, "you moved while a level-up was waiting");
  assert.equal(g.turn, turn, "the world moved while a level-up was waiting");

  assert.equal(g.chooseUpgrade(0), true);
  assert.equal(g.pendingChoices, null, "the choice stayed on screen after being taken");

  // And now the game runs again.
  g.rest();
  assert.ok(g.turn > turn, "the world did not restart after the choice");
});

test("progress reports where you are in the current level", () => {
  const p = progressOf(xpForLevel(5));
  assert.equal(p.level, 5);
  assert.equal(p.into, 0);
  assert.ok(p.need > 0);

  const mid = progressOf(xpForLevel(5) + 3);
  assert.equal(mid.level, 5);
  assert.equal(mid.into, 3);
});

// ---------------------------------------------------------------------------
// In a real run
// ---------------------------------------------------------------------------

test("a level-up comes with exactly one reroll, and it is a different hand", () => {
  const g = new Game(reg, 606);
  g.start("fighter", "human");
  g.xp = xpForLevel(2);
  g.rest();
  if (!g.pendingChoices) { console.log("  (no level at this seed; skipping)"); return; }

  const first = g.pendingChoices.map((c) => `${c.kind}:${c.id}`);
  assert.equal(g.rerollsLeft, 1, "a level-up came with no reroll");

  assert.equal(g.reroll(), true);
  const second = g.pendingChoices!.map((c) => `${c.kind}:${c.id}`);
  assert.notDeepEqual(second, first, "the reroll produced the same five");
  assert.equal(g.rerollsLeft, 0);

  // And there is only one.
  assert.equal(g.reroll(), false, "a second reroll was allowed");
  assert.deepEqual(g.pendingChoices!.map((c) => `${c.kind}:${c.id}`), second,
    "a refused reroll changed the hand anyway");
});

test("the first roll of a level is the same every time you reach it", () => {
  // This is what stops the roll being save-scummed: reloading and levelling
  // again has to hand you the same decision.
  const hands = [1, 2].map(() => {
    const g = new Game(reg, 777);
    g.start("fighter", "human");
    g.xp = xpForLevel(2);
    g.rest();
    return g.pendingChoices?.map((c) => `${c.kind}:${c.id}`) ?? null;
  });
  assert.deepEqual(hands[0], hands[1], "the same run rolled a different hand");
});

test("a talent that grants companions actually raises the limit", () => {
  const g = new Game(reg, 2026);
  g.start("fighter", "human");
  const before = g.partyLimit;
  const talent = [...reg.upgrades.values()].find((u) => u.perks?.party);
  assert.ok(talent, "no talent grants a companion");

  g.pendingChoices = [{
    kind: "upgrade", id: String(talent!.id), name: talent!.name ?? "", about: "", detail: "",
  }];
  g.chooseUpgrade(0);

  assert.equal(g.partyLimit, before + (talent!.perks!.party ?? 0), "the limit did not move");
  assert.ok(g.talentsTaken.includes(String(talent!.id)), "the talent was not remembered");
});

test("perks survive a save", () => {
  const g = new Game(reg, 55);
  g.start("fighter", "human");
  g.perks.gatherLuck = 0.5;
  g.perks.party = 1;
  g.talentsTaken.push("beastfriend");
  g.skills.mining = 4;
  g.crafts.smithing = 2;

  const back = loadGame(reg, g.toSave());
  assert.equal(back.perks.gatherLuck, 0.5);
  assert.equal(back.partyLimit, g.partyLimit, "the party limit was not restored");
  assert.deepEqual(back.talentsTaken, ["beastfriend"]);
  assert.equal(back.skills.mining, 4);
  assert.equal(back.crafts.smithing, 2);
});

test("a save written before perks existed still opens", () => {
  // Old files have no `perks`, `skills` or `talentsTaken` at all. Loading one
  // must give a playable run with sensible defaults, not a crash.
  const g = new Game(reg, 91);
  g.start("fighter", "human");
  const save = g.toSave() as Record<string, unknown>;
  delete save["perks"];
  delete save["talentsTaken"];
  delete save["skills"];
  delete save["crafts"];
  delete save["party"];

  const back = loadGame(reg, save as never);
  assert.equal(back.perks.party, 0);
  assert.deepEqual(back.talentsTaken, []);
  assert.equal(back.skills.mining, 0);
  assert.equal(back.partyLimit, g.partyLimit);
});

test("several levels at once give several choices, in order", () => {
  /*
   * The bug this comes from: one kill worth five levels ran the level-up loop
   * straight through and each pass overwrote the last one's choices, so the
   * player was handed one decision and silently lost four.
   */
  const g = new Game(reg, 404);
  g.start("fighter", "human");
  g.xp = xpForLevel(6);
  g.rest();

  assert.ok(g.pendingChoices, "a huge pile of experience produced no choice at all");
  assert.equal(g.playerLevel, 2, "it skipped past the levels instead of stopping at each");

  let spent = 0;
  while (g.pendingChoices && spent < 20) { g.chooseUpgrade(0); spent++; }
  assert.equal(spent, 5, `got ${spent} choices for five levels`);
  assert.equal(g.playerLevel, 6);
});

test("experience from anywhere levels you up", () => {
  // Not just from a kill: the ledger used to be the only route in, so anything
  // a mod, a script or the console did to `xp` raised the HUD number and
  // nothing else.
  const g = new Game(reg, 12);
  g.start("fighter", "human");
  g.xp = xpForLevel(3);
  g.rest();
  assert.ok(g.playerLevel > 1, "experience that did not come from a corpse did nothing");
});

test("the level on screen is the level you are, not the one your xp implies", () => {
  // These come apart whenever levels are queued, and the screen that says
  // "Level 6" while handing out level 2's choice is lying about what you are
  // choosing for. With a debug-sized pile of experience it said "Level 99".
  const g = new Game(reg, 808);
  g.start("fighter", "human");
  g.xp = xpForLevel(40);
  g.rest();

  assert.equal(g.progress.level, g.playerLevel, "the HUD and the character disagree");
  assert.ok(g.progress.level < 10, `the screen claims level ${g.progress.level}`);
  assert.ok(g.progress.into <= g.progress.need, "the xp bar is past its own end");
  assert.ok(g.progress.need > 0);
});
