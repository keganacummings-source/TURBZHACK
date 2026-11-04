/**
 * Random spells, and the spell effects that make them worth having.
 *
 * Two halves. The first is the generator: an ID has to name one spell and
 * always the same one, every spell it makes has to be a valid spell, and a bad
 * ID has to be "no such spell" rather than a crash. The second is what those
 * spells do when cast — chance to inflict, bounce, leech, root — checked against
 * real actors, because a spell that reads well on the level-up screen and does
 * something else in a fight is the failure this guards against.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Registry } from "../src/content/registry.ts";
import type { SpellDef } from "../src/content/schema.ts";
import { Actor } from "../src/engine/actor.ts";
import { castSpell, moveOrAttack } from "../src/engine/actions.ts";
import { rollChoices, spellDetail, applyChoice, CHOICES, maxSpellTier, xpForLevel } from "../src/engine/progress.ts";
import { Rng } from "../src/engine/rng.ts";
import {
  SpellBook, buildSpell, isGeneratedId, parseSpellId, rollRecipe, rollSpells, spellFromId, spellIdOf,
} from "../src/engine/spellgen.ts";
import { applyStatus, tickStatuses, type StatusDef } from "../src/engine/status.ts";
import { takeTurn } from "../src/engine/turns.ts";
import { Game, loadGame } from "../src/game.ts";
import { diskSource, loadRegistry, makeGame, spawn, statusMap } from "./lib/harness.mts";

const reg = loadRegistry();

/** A hand-built spell, so a test can fix exactly the numbers it is about. */
const spell = (over: Partial<SpellDef>): SpellDef => ({
  id: "test-spell", name: "Test Spell", mana: 1, kind: "pure", damage: 10, range: 7, target: "actor", ...over,
});

/** A creature with nothing to soften a hit: no armour, no resistances, a lot of health. */
function dummy(x: number, y: number, hp = 500): Actor {
  const a = spawn(reg, "enemies", "rat", x, y);
  a.pools.hpMax = a.pools.hp = hp;
  a.armour = 0;
  a.resist = {};
  return a;
}

function caster(x = 2, y = 5): Actor {
  const you = spawn(reg, "classes", "conjurer", x, y, true);
  you.pools.manaMax = you.pools.mana = 500;
  you.stats.focus = 0;                      // so a spell's listed damage is the damage
  return you;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

test("an id names exactly one spell, and reading it back gives the same id", () => {
  for (let seed = 0; seed < 300; seed++) {
    const recipe = rollRecipe(new Rng(seed), 1 + (seed % 5));
    const id = spellIdOf(recipe);
    assert.ok(isGeneratedId(id));
    const parsed = parseSpellId(id);
    assert.ok(parsed, `${id} did not parse`);
    assert.equal(spellIdOf(parsed), id, "writing a parsed id back changed it");
    assert.deepEqual(buildSpell(parsed), buildSpell(recipe), `${id} built a different spell the second time`);
  }
});

test("the same seed rolls the same spells, a different one rolls different ones", () => {
  const ids = (seed: number) => rollSpells(new Rng(seed), 3, 3).map((s) => s.id);
  assert.deepEqual(ids(5), ids(5));
  assert.notDeepEqual(ids(5), ids(6));
});

test("every generated spell is a valid spell that the real validator accepts", () => {
  // Run them through the registry exactly as if they were files. That is the
  // strongest check there is that a generated spell is a spell: it is held to
  // the same rules as one somebody wrote by hand.
  const defs: Record<string, unknown> = {};
  for (let seed = 0; seed < 400; seed++) {
    for (const d of rollSpells(new Rng(seed), 1 + (seed % 5), 2)) defs[String(d.id)] = d;
  }
  const checked = new Registry();
  checked.add(diskSource());
  checked.add({ name: "generated", files: { spells: defs } });
  checked.checkReferences();
  const bad = checked.problems.filter((p) => p.where.includes("gen-"));
  assert.deepEqual(bad, [], `generated spells were rejected:\n${bad.map((p) => `${p.where}: ${p.what}`).join("\n")}`);
  assert.ok(Object.keys(defs).length > 200, "the sample was too small to mean anything");
});

test("generated spells stay inside sane numbers and only name statuses that exist", () => {
  for (let seed = 0; seed < 400; seed++) {
    const tier = 1 + (seed % 5);
    const d = spellFromId(spellIdOf(rollRecipe(new Rng(seed), tier)))!;
    assert.equal(d.tier, tier);
    assert.ok(d.generated);
    assert.ok(d.mana >= 3 && d.mana < 60, `${d.id} costs ${d.mana} mana`);
    assert.ok((d.damage ?? 0) >= 1, `${d.id} does no damage`);
    assert.ok((d.range ?? 0) >= 1);
    assert.ok(d.name && d.about, `${d.id} has no name or description`);
    assert.match(String(d.say), /\{caster\}.*\{s\}/, `${d.id}'s say line has no verb token, so it would read "You casts"`);

    for (const f of d.inflicts ?? []) {
      assert.ok(reg.statuses.has(f.status), `${d.id} inflicts "${f.status}", which is not a status`);
      assert.ok(f.chance > 0 && f.chance <= 1, `${d.id} has a ${f.chance} chance`);
    }
    // Statuses are never listed twice, which would roll the same one twice.
    const names = (d.inflicts ?? []).map((f) => f.status);
    assert.equal(new Set(names).size, names.length, `${d.id} lists a status twice: ${names}`);

    if (d.bounce) {
      assert.equal(d.target, "actor", `${d.id} bounces but is not single-target`);
      assert.ok(d.bounce.jumps >= 1 && d.bounce.jumps <= 3);
    }
    if (d.leech !== undefined) assert.ok(d.leech > 0 && d.leech <= 0.5);
  }
});

test("a spell has more to it at a higher tier", () => {
  const avg = (tier: number, pick: (d: SpellDef) => number) => {
    let sum = 0;
    for (let seed = 0; seed < 200; seed++) sum += pick(spellFromId(spellIdOf(rollRecipe(new Rng(seed), tier)))!);
    return sum / 200;
  };
  assert.ok(avg(5, (d) => d.damage ?? 0) > avg(1, (d) => d.damage ?? 0) * 2, "damage barely grows with tier");
  assert.ok(avg(5, (d) => d.inflicts?.length ?? 0) > avg(1, (d) => d.inflicts?.length ?? 0), "higher tiers carry no more traits");
});

test("the spells the examples describe can come out of it", () => {
  // "Arcing Rooting Fire Bolt" and "Draining Poison Bolt" are the two shapes the
  // feature was asked for, so make sure they are really reachable by the roll
  // and by hand, with the names, bounce, leech and chances they should have.
  const arcing = spellFromId("gen-fire-bolt-t3-s4k2-sig45-arc2-root35")!;
  assert.equal(arcing.name, "Arcing Rooting Fire Bolt");
  assert.deepEqual(arcing.bounce, { jumps: 2, range: 4, falloff: 0.75 });
  assert.deepEqual(arcing.inflicts?.map((f) => [f.status, f.chance]), [["burning", 0.45], ["rooted", 0.35]]);
  assert.equal(arcing.kind, "fire");

  const draining = spellFromId("gen-poison-bolt-t2-s1a1-sig40-drain25")!;
  assert.equal(draining.name, "Draining Poison Bolt");
  assert.equal(draining.leech, 0.25);
  assert.deepEqual(draining.inflicts?.map((f) => [f.status, f.chance]), [["poisoned", 0.4]]);

  // And both shapes turn up in a sample of ordinary rolls, rather than being
  // something only a hand-typed id can produce.
  const rolled = Array.from({ length: 400 }, (_, i) => spellFromId(spellIdOf(rollRecipe(new Rng(i), 3)))!);
  assert.ok(rolled.some((d) => d.bounce && d.inflicts?.some((f) => f.status === "rooted")), "no rolled spell arcs and roots");
  assert.ok(rolled.some((d) => d.leech && d.kind === "poison"), "no rolled spell drains and poisons");
});

test("a bad id is no spell at all, not a crash", () => {
  for (const id of [
    "gen-", "gen-fire", "gen-fire-bolt", "gen-fire-bolt-t9-sab", "gen-lava-bolt-t1-sab", "gen-fire-orb-t1-sab",
    "gen-fire-bolt-t1-sab-wibble5", "gen-fire-bolt-t1-sab-root30-root40",
    "gen-fire-lance-t3-sab-arc2",          // a beam has nothing to leap from
    "spark", "",
  ]) {
    assert.equal(spellFromId(id), undefined, `"${id}" should not make a spell`);
  }
});

test("the spell table builds generated spells on demand without listing them", () => {
  const book = new SpellBook();
  book.set("spark", spell({ id: "spark", name: "Spark" }));
  const id = "gen-cold-lance-t2-sxyz-sig40-drain20";

  assert.equal(book.size, 1);
  assert.ok(book.has(id));
  assert.equal(book.get(id)?.name, "Draining Frost Lance");
  assert.equal(book.get(id), book.get(id), "built twice instead of once");
  assert.equal(book.size, 1, "a generated spell got added to the table");
  assert.deepEqual([...book.keys()], ["spark"], "a generated spell showed up when listing the table");

  assert.equal(book.get("gen-nonsense"), undefined);
  assert.equal(book.has("gen-nonsense"), false);
  assert.equal(book.get("spark")?.name, "Spark");
  // The real registry uses one, so every lookup in the game gets this for free.
  assert.ok(reg.spells.has(id));
  assert.equal(reg.spells.get(id)?.generated, true);
});

// ---------------------------------------------------------------------------
// Chance to inflict
// ---------------------------------------------------------------------------

test("a status with a chance lands about that often, and a chance of 1 always does", () => {
  const trials = 600;
  const rate = (chance: number) => {
    let hit = 0;
    for (let i = 0; i < trials; i++) {
      const you = caster();
      const target = dummy(5, 5);
      const { ctx } = makeGame(reg, [you, target], 100 + i);
      castSpell(ctx, you, spell({ inflicts: [{ status: "burning", chance }] }), target);
      if (target.hasStatus("burning")) hit++;
    }
    return hit / trials;
  };
  assert.equal(rate(0), 0, "a 0% status landed");
  assert.equal(rate(1), 1, "a 100% status missed");
  const r = rate(0.4);
  assert.ok(r > 0.32 && r < 0.48, `a 40% status landed ${(r * 100).toFixed(0)}% of the time`);
});

test("each status is its own roll, so a spell can burn, root, both or neither", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const you = caster();
    const target = dummy(5, 5);
    const { ctx } = makeGame(reg, [you, target], 900 + i);
    castSpell(ctx, you, spell({ inflicts: [{ status: "burning", chance: 0.5 }, { status: "rooted", chance: 0.5 }] }), target);
    seen.add(`${target.hasStatus("burning")}/${target.hasStatus("rooted")}`);
  }
  assert.equal(seen.size, 4, `only saw ${[...seen].join(", ")}`);
});

test("everything in a beam rolls its own chance", () => {
  let totals = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const you = caster();
    const row = [dummy(4, 5), dummy(5, 5), dummy(6, 5), dummy(7, 5)];
    const { ctx } = makeGame(reg, [you, ...row], 5000 + i);
    castSpell(ctx, you, spell({ target: "beam", inflicts: [{ status: "burning", chance: 0.5 }] }), row[0]);
    totals += row.filter((r) => r.hasStatus("burning")).length;
  }
  const mean = totals / trials;
  assert.ok(mean > 1.6 && mean < 2.4, `four targets at 50% burned ${mean.toFixed(2)} on average, not about 2`);
});

// ---------------------------------------------------------------------------
// Bounce
// ---------------------------------------------------------------------------

test("a bounce leaps to the nearest other creature, each hop a quarter weaker", () => {
  const you = caster();
  const first = dummy(5, 5), second = dummy(7, 5), third = dummy(9, 5);
  const { ctx } = makeGame(reg, [you, first, second, third]);

  const out = castSpell(ctx, you, spell({ damage: 40, bounce: { jumps: 2, range: 4, falloff: 0.75 } }), first);
  assert.equal(out.tookTurn, true);

  const lost = (a: Actor) => a.pools.hpMax - a.pools.hp;
  assert.equal(lost(first), 40);
  assert.equal(lost(second), 30, "the first hop should do three quarters");
  assert.equal(lost(third), 23, "the second hop should do three quarters of that");   // 40 * 0.75 * 0.75 = 22.5
  assert.match(out.messages!.map((m) => m.text).join("\n"), /arcs to/);
});

test("a bounce takes the nearest creature, not just any, and never the same one twice", () => {
  const you = caster();
  const first = dummy(5, 5);
  const near = dummy(6, 5), far = dummy(9, 5);
  const { ctx } = makeGame(reg, [you, first, far, near]);   // listed far-first on purpose

  castSpell(ctx, you, spell({ damage: 40, bounce: { jumps: 1, range: 4 } }), first);
  assert.ok(near.pools.hp < near.pools.hpMax, "the nearer creature was skipped");
  assert.equal(far.pools.hp, far.pools.hpMax, "the farther creature was hit as well");

  // More hops than there are creatures: it stops, and does not come back round.
  const a = dummy(5, 5), b = dummy(6, 5);
  const g = makeGame(reg, [you, a, b]);
  castSpell(g.ctx, you, spell({ damage: 40, bounce: { jumps: 3, range: 4, falloff: 1 } }), a);
  assert.equal(a.pools.hpMax - a.pools.hp, 40, "the first target was struck twice");
  assert.equal(b.pools.hpMax - b.pools.hp, 40);
});

test("a bounce does not reach past its range or round a wall", () => {
  const you = caster();
  const first = dummy(5, 5), tooFar = dummy(11, 5);
  const { ctx } = makeGame(reg, [you, first, tooFar]);
  castSpell(ctx, you, spell({ damage: 40, bounce: { jumps: 2, range: 4 } }), first);
  assert.equal(tooFar.pools.hp, tooFar.pools.hpMax, "it jumped further than its range");

  const walled = makeGame(reg, [you, dummy(5, 5), dummy(7, 5)]);
  const [w1, w2] = [walled.ctx.actors[1]!, walled.ctx.actors[2]!];
  walled.level.set(6, 5, 1);                      // a wall between them
  castSpell(walled.ctx, you, spell({ damage: 40, bounce: { jumps: 1, range: 4 } }), w1);
  assert.equal(w2.pools.hp, w2.pools.hpMax, "it arced through a wall");
});

test("a bounce never turns on allies, pets or neutral villagers", () => {
  const you = caster();
  const foe = dummy(5, 5);
  const pet = dummy(6, 5);
  pet.stance = "friendly";
  pet.data["companion"] = true;
  const villager = dummy(5, 6);
  villager.stance = "neutral";
  const { ctx } = makeGame(reg, [you, foe, pet, villager]);

  castSpell(ctx, you, spell({ damage: 40, bounce: { jumps: 3, range: 4 } }), foe);
  assert.equal(pet.pools.hp, pet.pools.hpMax, "the arc hit your pet");
  assert.equal(villager.pools.hp, villager.pools.hpMax, "the arc hit a neutral villager");
});

test("every creature a bounce reaches rolls its own statuses", () => {
  let first = 0, second = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const you = caster();
    const a = dummy(5, 5), b = dummy(7, 5);
    const { ctx } = makeGame(reg, [you, a, b], 700 + i);
    castSpell(ctx, you, spell({
      damage: 10, bounce: { jumps: 1, range: 4 }, inflicts: [{ status: "rooted", chance: 0.5 }],
    }), a);
    if (a.hasStatus("rooted")) first++;
    if (b.hasStatus("rooted")) second++;
  }
  for (const [label, n] of [["first", first], ["second", second]] as const) {
    const rate = n / trials;
    assert.ok(rate > 0.4 && rate < 0.6, `the ${label} creature was rooted ${(rate * 100).toFixed(0)}% of the time, not about 50%`);
  }
});

// ---------------------------------------------------------------------------
// Leech
// ---------------------------------------------------------------------------

test("leech returns a share of all the damage dealt, hops included", () => {
  const you = caster();
  you.pools.hpMax = 200;
  you.pools.hp = 50;
  const a = dummy(5, 5), b = dummy(7, 5);
  const { ctx } = makeGame(reg, [you, a, b]);

  castSpell(ctx, you, spell({ damage: 40, leech: 0.25, bounce: { jumps: 1, range: 4, falloff: 0.5 } }), a);
  // 40 on the first, 20 on the hop: 60 dealt, a quarter of it back.
  assert.equal(you.pools.hp, 50 + 15, `healed to ${you.pools.hp}`);
});

test("leech cannot heal past full, and heals nothing from a spell that does no damage", () => {
  const you = caster();
  you.pools.hp = you.pools.hpMax - 1;
  const a = dummy(5, 5);
  const { ctx } = makeGame(reg, [you, a]);
  castSpell(ctx, you, spell({ damage: 40, leech: 0.5 }), a);
  assert.equal(you.pools.hp, you.pools.hpMax);

  you.pools.hp = 10;
  castSpell(ctx, you, spell({ damage: 0, leech: 0.5, inflicts: [{ status: "burning", chance: 1 }] }), a);
  assert.equal(you.pools.hp, 10, "a spell that dealt nothing healed the caster");
});

test("a monster's leech spell heals the monster", () => {
  const you = caster();
  you.pools.hpMax = you.pools.hp = 500;
  const ghoul = dummy(5, 5);
  ghoul.pools.hpMax = 100;
  ghoul.pools.hp = 40;
  ghoul.pools.manaMax = ghoul.pools.mana = 50;      // a rat has none to cast with
  ghoul.stats.focus = 0;
  const { ctx } = makeGame(reg, [you, ghoul]);
  castSpell(ctx, ghoul, spell({ damage: 20, leech: 0.5 }), you);
  assert.equal(ghoul.pools.hp, 50);
});

// ---------------------------------------------------------------------------
// Beams and blasts
// ---------------------------------------------------------------------------

test("a blast does not hurt the caster, their pets or a neutral villager", () => {
  const you = caster(5, 5);
  const foe = dummy(6, 5);
  const pet = dummy(5, 6);
  pet.stance = "friendly";
  pet.data["companion"] = true;
  const villager = dummy(6, 6);
  villager.stance = "neutral";
  const { ctx } = makeGame(reg, [you, foe, pet, villager]);

  castSpell(ctx, you, spell({ target: "burst", radius: 2, damage: 30 }), foe);
  assert.ok(foe.pools.hp < foe.pools.hpMax, "the blast missed its target");
  assert.equal(you.pools.hp, you.pools.hpMax, "you were caught in your own blast");
  assert.equal(pet.pools.hp, pet.pools.hpMax, "the blast hurt your pet");
  assert.equal(villager.pools.hp, villager.pools.hpMax, "the blast hurt a villager");
});

test("a beam passes through allies without hurting them", () => {
  const you = caster(2, 5);
  const pet = dummy(4, 5);
  pet.stance = "friendly";
  pet.data["companion"] = true;
  const foe = dummy(6, 5);
  const { ctx } = makeGame(reg, [you, pet, foe]);
  castSpell(ctx, you, spell({ target: "beam", damage: 30 }), foe);
  assert.ok(foe.pools.hp < foe.pools.hpMax);
  assert.equal(pet.pools.hp, pet.pools.hpMax, "the beam hurt the pet in front of it");
});

// ---------------------------------------------------------------------------
// Root, and statuses that stop a turn
// ---------------------------------------------------------------------------

test("rooted holds a creature in place but not its hands", () => {
  const rooted = reg.statuses.get("rooted")!;
  assert.ok(rooted, "there is no rooted status");
  assert.equal(rooted.preventsMove, true);
  assert.ok(!rooted.preventsAction, "rooted should not stop a creature acting");

  const you = caster(2, 5);
  const wolf = spawn(reg, "enemies", "wolf", 6, 5);
  const { ctx } = makeGame(reg, [you, wolf]);
  applyStatus(wolf, rooted, 10, you);
  assert.ok(wolf.hasStatus("rooted"));

  // It cannot step toward you...
  const step = moveOrAttack(ctx, wolf, -1, 0, undefined);
  assert.deepEqual(wolf.pos, { x: 6, y: 5 }, "a rooted creature walked");
  assert.equal(step.tookTurn, true, "a monster that cannot move must still use its turn, or the AI will ask forever");

  // ...but something adjacent is still in reach. A swing can miss, so give it
  // a few tries: the point is that it is allowed to, not that it always lands.
  const next = spawn(reg, "classes", "fighter", 5, 5);
  ctx.actors.push(next);
  const fist = reg.abilities.get("punch")!;
  for (let i = 0; i < 40 && next.pools.hp === next.pools.hpMax; i++) {
    wolf.pools.stamina = wolf.pools.staminaMax;
    moveOrAttack(ctx, wolf, -1, 0, fist);
  }
  assert.ok(next.pools.hp < next.pools.hpMax, "a rooted creature could not fight what was beside it");
});

test("a rooted player is told so and keeps the turn, but can still cast", () => {
  const rooted = reg.statuses.get("rooted")!;
  const you = caster(5, 5);
  const foe = dummy(8, 5);
  const { ctx } = makeGame(reg, [you, foe]);
  applyStatus(you, rooted, 10);

  const step = moveOrAttack(ctx, you, 1, 0, undefined);
  assert.equal(step.tookTurn, false, "being rooted cost the player a turn for trying to walk");
  assert.deepEqual(you.pos, { x: 5, y: 5 });
  assert.match(step.messages?.map((m) => m.text).join(" ") ?? "", /rooted/i);

  const cast = castSpell(ctx, you, reg.spells.get("spark")!, foe);
  assert.equal(cast.tookTurn, true, "a rooted caster could not cast");
});

test("rooted wears off, and can be broken early", () => {
  const rooted = reg.statuses.get("rooted")!;
  const rng = new Rng(3);
  let broke = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    const rat = dummy(5, 5);
    applyStatus(rat, rooted, 5);
    tickStatuses(rat, statusMap(reg), rng, new Map());
    if (!rat.hasStatus("rooted")) broke++;
  }
  const rate = broke / trials;
  assert.ok(rate > 0.12 && rate < 0.28, `rooted broke ${(rate * 100).toFixed(0)}% of the time on the first turn, expected about 20%`);

  const rat = dummy(5, 5);
  applyStatus(rat, { ...rooted, breakChance: 0 }, 5);
  const defs = new Map(statusMap(reg));
  defs.set("rooted", { ...rooted, breakChance: 0 });
  for (let i = 0; i < rooted.turns - 1; i++) tickStatuses(rat, defs, rng, new Map());
  assert.ok(rat.hasStatus("rooted"), "it ended early with no chance to break");
  tickStatuses(rat, defs, rng, new Map());
  assert.ok(!rat.hasStatus("rooted"), "it never wore off");
});

test("any status marked preventsAction holds a creature, not only frozen", () => {
  // Stunned and webbed said they stop the bearer acting, but the turn loop only
  // ever looked for frozen, so they did nothing but print a message.
  for (const id of ["stunned", "webbed", "frozen"]) {
    const def = reg.statuses.get(id)!;
    assert.equal(def.preventsAction, true, `${id} is not marked preventsAction`);

    const you = caster(2, 5);
    const rat = dummy(5, 5);
    const { ctx } = makeGame(reg, [you, rat]);
    // No chance to break, so the test is about holding and not about the dice.
    const defs = new Map(statusMap(reg));
    defs.set(id, { ...def, breakChance: 0 });
    ctx.statuses = defs;
    applyStatus(rat, { ...def, breakChance: 0 }, 5, you);

    let acted = 0;
    takeTurn(rat, ctx, () => { acted++; return { tookTurn: true }; });
    assert.equal(acted, 0, `a ${id} creature still took its turn`);
  }

  // And an ordinary creature does.
  const rat = dummy(5, 5);
  const { ctx } = makeGame(reg, [caster(), rat]);
  let acted = 0;
  takeTurn(rat, ctx, () => { acted++; return { tookTurn: true }; });
  assert.equal(acted, 1);
});

// ---------------------------------------------------------------------------
// Level-ups and saves
// ---------------------------------------------------------------------------

test("an ordinary level-up always offers a generated spell when it is handed some", () => {
  const upgrades = reg.upgrades as never;
  for (let level = 2; level <= 20; level++) {
    if (level % 5 === 0) continue;                 // milestones offer talents only
    for (let seed = 0; seed < 25; seed++) {
      const generated = rollSpells(new Rng(seed * 31 + level), maxSpellTier(level), 3);
      const choices = rollChoices(level, [], reg.spells as never, upgrades, new Rng(seed), CHOICES, generated);
      assert.equal(choices.length, CHOICES);
      assert.equal(new Set(choices.map((c) => `${c.kind}:${c.id}`)).size, CHOICES, "a choice was offered twice");
      const gen = choices.filter((c) => c.kind === "spell" && isGeneratedId(c.id));
      assert.ok(gen.length >= 1, `level ${level}, seed ${seed}: no generated spell in ${choices.map((c) => c.id)}`);
      for (const c of gen) assert.ok(reg.spells.has(c.id));
    }
  }
});

test("a level-up with nothing generated is exactly the roll it always was", () => {
  for (let seed = 0; seed < 30; seed++) {
    const a = rollChoices(6, [], reg.spells as never, reg.upgrades as never, new Rng(seed));
    const b = rollChoices(6, [], reg.spells as never, reg.upgrades as never, new Rng(seed), CHOICES, []);
    assert.deepEqual(a, b);
    assert.ok(a.every((c) => !isGeneratedId(c.id)));
  }
});

test("a generated spell is never offered once you know it, and never above your tier", () => {
  const generated = rollSpells(new Rng(11), 2, 3);
  const known = [String(generated[0]!.id)];
  for (let seed = 0; seed < 40; seed++) {
    for (const c of rollChoices(4, known, reg.spells as never, reg.upgrades as never, new Rng(seed), CHOICES, generated)) {
      assert.ok(!known.includes(c.id), "offered a generated spell that is already known");
    }
  }
  const tooHigh = rollSpells(new Rng(12), 5, 3);
  for (let seed = 0; seed < 20; seed++) {
    const offered = rollChoices(2, [], reg.spells as never, reg.upgrades as never, new Rng(seed), CHOICES, tooHigh);
    assert.ok(offered.every((c) => !tooHigh.some((t) => t.id === c.id)), "a level-2 roll offered tier-5 spells");
  }
});

test("the level-up screen says what a generated spell does, chances included", () => {
  const d = spellFromId("gen-fire-bolt-t3-s4k2-sig45-arc2-root35-drain25")!;
  const detail = spellDetail(d);
  assert.match(detail, /45% burning/);
  assert.match(detail, /35% rooted/);
  assert.match(detail, /arcs to 2 more/);
  assert.match(detail, /25% leech/);
  assert.match(d.about ?? "", /leaps to 2 more creatures/);
});

test("in a real run: the roll offers a random spell, you learn it, cast it, and it survives a save", () => {
  const g = new Game(reg, 31337);
  g.start("conjurer", "human");
  g.xp = xpForLevel(2);
  g.rest();
  assert.ok(g.pendingChoices, "no level-up came");

  const slot = g.pendingChoices!.findIndex((c) => c.kind === "spell" && isGeneratedId(c.id));
  assert.ok(slot >= 0, `the roll had no generated spell: ${g.pendingChoices!.map((c) => c.id)}`);
  const id = g.pendingChoices![slot]!.id;
  const name = g.pendingChoices![slot]!.name;

  assert.equal(g.chooseUpgrade(slot), true);
  assert.ok(g.player.spells.includes(id), "choosing the spell did not teach it");
  assert.ok(g.reg.spells.get(id), "the game could not find the spell it just taught");

  // Cast it at something. It may be a spell with no range to the thing, so put
  // a target right beside the player.
  const victim = g.actors.find((a) => !a.isPlayer)!;
  victim.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
  victim.stance = "hostile";
  victim.pools.hp = victim.pools.hpMax = 400;
  victim.armour = 0;
  victim.resist = {};                       // so no element is shrugged off
  g.player.pools.mana = g.player.pools.manaMax = 300;
  g.refreshFov();
  const before = victim.pools.hp;
  g.cast(id);
  assert.ok(victim.pools.hp < before, `${name} did no damage`);

  // Save, reload, and it is still there and still castable.
  const reloaded = loadGame(reg, JSON.parse(JSON.stringify(g.toSave())));
  assert.ok(reloaded.player.spells.includes(id), "the generated spell was lost in a save");
  assert.equal(reloaded.reg.spells.get(id)?.name, name, "the spell changed name after loading");
  const again = reloaded.actors.find((a) => !a.isPlayer && a.alive);
  if (again) {
    again.pos = { x: reloaded.player.pos.x + 1, y: reloaded.player.pos.y };
    again.stance = "hostile";
    again.pools.hp = again.pools.hpMax = 400;
    again.armour = 0;
    again.resist = {};
    reloaded.player.pools.mana = reloaded.player.pools.manaMax = 300;
    reloaded.refreshFov();
    const hp = again.pools.hp;
    reloaded.cast(id);
    assert.ok(again.pools.hp < hp, "the reloaded spell did nothing");
  }
});

test("the first roll of a level offers the same random spells every time", () => {
  const hands = [1, 2].map(() => {
    const g = new Game(reg, 9090);
    g.start("conjurer", "human");
    g.xp = 1000;
    g.rest();
    return g.pendingChoices?.map((c) => `${c.kind}:${c.id}`) ?? null;
  });
  assert.ok(hands[0]);
  assert.deepEqual(hands[0], hands[1], "the same run rolled different random spells");
});

test("applying a generated choice teaches it exactly once", () => {
  const d = spellFromId("gen-cold-bolt-t1-sabc-sig40-drain20")!;
  const you = caster();
  you.spells = [];
  const choice = { kind: "spell" as const, id: String(d.id), name: String(d.name), about: "", detail: "" };
  applyChoice(you, choice, new Map());
  applyChoice(you, choice, new Map());
  assert.deepEqual(you.spells, [d.id]);
});
