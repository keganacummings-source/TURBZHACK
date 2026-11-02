/**
 * The rules of the game, as specified.
 *
 * These are the numbers the design asks for, written down as tests so that a
 * later change to a content file cannot quietly move them: 100/100/50 base,
 * punch 5 for nothing, kick 10 for 25 stamina, 25 stamina back every turn,
 * health only after ten clean turns, burning a quarter a turn, freeze an even
 * chance to break.
 *
 * They read the real content files, so they are also a check that those files
 * say what the design says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry, makeGame, spawn, logText } from "./lib/harness.mts";
import { BASE_POOLS, STAMINA_PER_TURN, REGEN_DELAY_TURNS } from "../src/engine/actor.ts";
import { castSpell, useAbility, moveOrAttack } from "../src/engine/actions.ts";
import { playerActed } from "../src/engine/turns.ts";
import { tickStatuses } from "../src/engine/status.ts";
import { Rng } from "../src/engine/rng.ts";

const reg = loadRegistry();

test("base stats are 100 health, 100 stamina, 50 mana", () => {
  assert.equal(BASE_POOLS.hpMax, 100);
  assert.equal(BASE_POOLS.staminaMax, 100);
  assert.equal(BASE_POOLS.manaMax, 50);
});

test("punch does 5 and costs no stamina; kick does 10 and costs 25", () => {
  const punch = reg.abilities.get("punch")!;
  const kick = reg.abilities.get("kick")!;
  assert.equal(punch.damage, 5);
  assert.equal(punch.stamina ?? 0, 0);
  assert.equal(kick.damage, 10);
  assert.equal(kick.stamina, 25);
});

test("a punch costs nothing and can be thrown forever", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 3, 2);
  const { ctx } = makeGame(reg, [you, rat]);
  you.stats.accuracy = 100;    // this test is about cost, not about hitting
  const before = you.pools.stamina;
  for (let i = 0; i < 5; i++) useAbility(ctx, you, reg.abilities.get("punch")!, rat);
  assert.equal(you.pools.stamina, before, "punching cost stamina");
});

test("kick empties you in four, and the fifth is refused without passing the turn", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const dummy = spawn(reg, "enemies", "iron-sentinel", 3, 2);
  const { ctx } = makeGame(reg, [you, dummy]);
  you.pools.stamina = 100;

  for (let i = 0; i < 4; i++) {
    const r = useAbility(ctx, you, reg.abilities.get("kick")!, dummy);
    assert.equal(r.tookTurn, true, `kick ${i + 1} should have landed`);
  }
  assert.equal(you.pools.stamina, 0);

  const refused = useAbility(ctx, you, reg.abilities.get("kick")!, dummy);
  assert.equal(refused.tookTurn, false, "a kick with no stamina must not use the turn");
  assert.match(refused.messages?.[0]?.text ?? "", /stamina/i);
});

test("everyone gets 25 stamina back at the end of a turn", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  you.pools.stamina = 0;
  you.endTurnRecovery();
  assert.equal(you.pools.stamina, STAMINA_PER_TURN);
  // And it never goes past the cap.
  you.pools.stamina = you.pools.staminaMax - 5;
  you.endTurnRecovery();
  assert.equal(you.pools.stamina, you.pools.staminaMax);
});

test("health comes back only after ten turns without being hurt", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  you.hurt(50);
  const wounded = you.pools.hp;

  // The hit reset the clock, so nothing for the next ten turns.
  for (let i = 0; i < REGEN_DELAY_TURNS; i++) you.endTurnRecovery();
  assert.equal(you.pools.hp, wounded, "health came back too early");

  you.endTurnRecovery();
  assert.ok(you.pools.hp > wounded, "health never came back");

  // And being hit again starts the wait over.
  const healed = you.pools.hp;
  you.hurt(1);
  for (let i = 0; i < REGEN_DELAY_TURNS; i++) you.endTurnRecovery();
  assert.ok(you.pools.hp <= healed, "being hit did not restart the regen delay");
});

test("fire burns for a quarter of the hit, every turn, through armour", () => {
  const burning = reg.statuses.get("burning")!;
  assert.equal(burning.tick?.percent, 0.25);
  assert.equal(burning.tick?.of, "sourceDamage");

  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const golem = spawn(reg, "enemies", "iron-sentinel", 4, 2);   // heavy armour
  const { ctx, messages } = makeGame(reg, [you, golem]);

  const res = castSpell(ctx, you, reg.spells.get("ember-bolt")!, golem);
  assert.equal(res.tookTurn, true);
  for (const m of res.messages ?? []) messages.push({ text: m.text, tone: m.tone, turn: 0 });
  assert.ok(golem.hasStatus("burning"), "fire did not set it alight");

  // The tick is a quarter of the damage that LANDED, and armour does not stop it.
  const dealt = golem.status("burning")!.power;
  const hpBefore = golem.pools.hp;
  const tick = tickStatuses(golem, reg.statuses as never, new Rng(5), new Map([[you.id, you]]));
  const lost = hpBefore - golem.pools.hp;
  assert.ok(lost > 0, "burning did nothing");

  /*
   * A quarter of the hit, then whatever this creature's own fire resistance
   * does to it — read off the creature rather than written in by hand, so that
   * retuning a monster's resistances does not break a test about burning.
   */
  const resist = golem.resist.fire ?? 1;
  const expected = Math.max(1, Math.round(Math.max(1, Math.round(dealt * 0.25)) * resist));
  assert.equal(lost, expected, `burning took ${lost}, expected ${expected}`);

  // And the armour really is bypassed: 8 points of it would have stopped this
  // outright if the tick had gone through the normal armour path.
  assert.ok(golem.armour > expected, "pick a target whose armour would have absorbed the tick");
  assert.ok(logText([...messages, ...tick.messages.map((m) => ({ ...m, turn: 0 }))]).length > 0);
});

test("freeze stops a creature acting, and gives it an even chance to break out", () => {
  const frozen = reg.statuses.get("frozen")!;
  assert.equal(frozen.breakChance, 0.5);
  assert.equal(frozen.preventsAction, true);

  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 5, 2);
  const { ctx } = makeGame(reg, [you, rat]);

  castSpell(ctx, you, reg.spells.get("freeze")!, rat);
  assert.ok(rat.hasStatus("frozen"), "freeze did not take");
  assert.equal(rat.canAct, false, "a frozen creature can still act");

  // Over many trials it should break out about half the time per turn. This is
  // a distribution check, not a single roll, so it cannot flake on one unlucky
  // number while still catching a chance that is wrong by a lot.
  let broke = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    const victim = spawn(reg, "enemies", "rat", 5, 2);
    const g = makeGame(reg, [you, victim], 1000 + i);
    castSpell(g.ctx, you, reg.spells.get("freeze")!, victim);
    you.pools.mana = you.pools.manaMax;
    tickStatuses(victim, reg.statuses as never, g.ctx.rng, new Map());
    if (!victim.hasStatus("frozen")) broke++;
  }
  const rate = broke / trials;
  assert.ok(rate > 0.38 && rate < 0.62, `thaw rate was ${(rate * 100).toFixed(0)}%, expected about 50%`);
});

test("a spell with no mana behind it is refused and costs no turn", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);   // 10 mana
  const rat = spawn(reg, "enemies", "rat", 4, 2);
  const { ctx } = makeGame(reg, [you, rat]);
  you.pools.mana = 0;
  const r = castSpell(ctx, you, reg.spells.get("ember-bolt")!, rat);
  assert.equal(r.tookTurn, false);
  assert.equal(rat.pools.hp, rat.pools.hpMax, "a refused spell still did damage");
});

test("moving is one turn, and walking into a wall is not", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const { ctx } = makeGame(reg, [you]);

  const stepped = moveOrAttack(ctx, you, 1, 0, undefined);
  assert.equal(stepped.tookTurn, true);
  assert.deepEqual(you.pos, { x: 3, y: 2 });

  you.pos = { x: 1, y: 1 };
  const bumped = moveOrAttack(ctx, you, -1, 0, reg.abilities.get("punch")!);
  assert.equal(bumped.tookTurn, false, "bumping a wall used the turn");
  assert.deepEqual(you.pos, { x: 1, y: 1 }, "bumping a wall moved you");
});

test("walking into a hostile creature attacks it; a neutral one is not attacked by accident", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 3, 2);
  const deer = spawn(reg, "enemies", "snow-fowl", 2, 3);
  const { ctx } = makeGame(reg, [you, rat, deer]);

  you.stats.accuracy = 100;    // this test is about who you attack, not whether you connect
  const hit = moveOrAttack(ctx, you, 1, 0, reg.abilities.get("punch")!);
  assert.equal(hit.tookTurn, true);
  assert.ok(rat.pools.hp < rat.pools.hpMax, "walking into a hostile did not attack it");
  assert.deepEqual(you.pos, { x: 2, y: 2 }, "attacking moved you into its tile");

  const spared = moveOrAttack(ctx, you, 0, 1, reg.abilities.get("punch")!);
  assert.equal(spared.tookTurn, false, "you attacked a neutral creature by walking");
  assert.equal(deer.pools.hp, deer.pools.hpMax);
});

test("the world only moves when you do", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const rat = spawn(reg, "enemies", "rat", 10, 6);
  const { ctx } = makeGame(reg, [you, rat]);
  you.energy = 100;

  const where = { ...rat.pos };
  const turnBefore = ctx.turn;

  // A refused action must not advance anything at all.
  playerActed(ctx, { tookTurn: false }, () => ({ tookTurn: true }));
  assert.deepEqual(rat.pos, where, "the world moved on a refused action");
  assert.equal(ctx.turn, turnBefore);

  // A real one advances it exactly once.
  playerActed(ctx, { tookTurn: true }, () => ({ tookTurn: true }));
  assert.equal(ctx.turn, turnBefore + 1, "one action should be one turn");
});

test("a faster creature gets more turns than a slower one", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const hound = spawn(reg, "enemies", "bat", 8, 2);   // speed 140
  const golem = spawn(reg, "enemies", "iron-sentinel", 12, 2);  // speed 60
  const { ctx } = makeGame(reg, [you, hound, golem]);
  you.energy = 100;

  const acts = new Map<string, number>();
  const count = (a: { id: string }) => acts.set(a.id, (acts.get(a.id) ?? 0) + 1);

  for (let i = 0; i < 20; i++) {
    playerActed(ctx, { tookTurn: true }, (a) => { count(a); return { tookTurn: true }; });
  }
  const fast = acts.get(hound.id) ?? 0;
  const slow = acts.get(golem.id) ?? 0;
  assert.ok(fast > slow, `the speed-140 hound acted ${fast} times, the speed-60 golem ${slow}`);
  assert.ok(fast >= 20 && slow <= 16, `fast ${fast}, slow ${slow} — energy is not accumulating as expected`);
});

// ---------------------------------------------------------------------------
// Seeing
// ---------------------------------------------------------------------------

test("field of view is a disc, not a star", async () => {
  // The first implementation walked each row diagonally instead of across it,
  // so every row tested one tile and the lit area came out as a sparse star.
  // In an empty room, a radius-6 view should light essentially the whole disc.
  const { testLevel } = await import("./lib/harness.mts");
  const { computeFov } = await import("../src/engine/grid.ts");
  const level = testLevel(31, 31);
  const from = { x: 15, y: 15 };
  computeFov(level, from, 6);

  let lit = 0, want = 0;
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const dx = x - from.x, dy = y - from.y;
      if (dx * dx + dy * dy > 36) continue;
      want++;
      if (level.visible[level.idx(x, y)]) lit++;
    }
  }
  assert.ok(lit / want > 0.95, `only ${lit} of ${want} tiles in an open disc are visible`);
});

test("you cannot see through a wall, and you can see the wall itself", async () => {
  const { testLevel } = await import("./lib/harness.mts");
  const { computeFov } = await import("../src/engine/grid.ts");
  const level = testLevel(21, 11);
  // A pillar two tiles east of the viewer.
  const wallIndex = 1;
  level.set(12, 5, wallIndex);
  computeFov(level, { x: 10, y: 5 }, 8);

  assert.ok(level.visible[level.idx(12, 5)], "the wall itself should be visible");
  assert.ok(!level.visible[level.idx(14, 5)], "you can see straight through a wall");
  assert.ok(level.visible[level.idx(12, 3)], "the wall blocked something it should not have");
});

test("what you have seen stays remembered after you look away", async () => {
  const { testLevel } = await import("./lib/harness.mts");
  const { computeFov } = await import("../src/engine/grid.ts");
  const level = testLevel(31, 11);
  computeFov(level, { x: 5, y: 5 }, 4);
  const sawHere = level.idx(5, 5);
  assert.ok(level.known[sawHere]);

  computeFov(level, { x: 25, y: 5 }, 4);
  assert.ok(level.known[sawHere], "the map forgot a tile you had already seen");
  assert.ok(!level.visible[sawHere], "a tile you walked away from is still marked visible");
});

// ---------------------------------------------------------------------------
// Reading the log
// ---------------------------------------------------------------------------

test("the log addresses you in the second person and monsters in the third", async () => {
  // "You punches Wolf." is what one template for both looks like, so content
  // writes the verb with an {s}/{es} token and this fills it in per speaker.
  const { say } = await import("../src/engine/actions.ts");
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const wolf = spawn(reg, "enemies", "wolf", 3, 2);

  assert.equal(say("{caster} punch{es} {target}.", you, wolf), "You punch Wolf.");
  assert.equal(say("{caster} punch{es} {target}.", wolf, you), "Wolf punches you.");
  assert.equal(say("{caster} bite{s} {target}.", wolf, you), "Wolf bites you.");
  assert.equal(say("{caster} bite{s} {target}.", you, wolf), "You bite Wolf.");
});

test("every say line in the content folder is written for both speakers", () => {
  /*
   * A `say` whose verb has no token reads wrong for one speaker or the other.
   * This catches a new spell written as "{caster} blasts {target}" before it
   * ever prints "You blasts Goblin."
   */
  const bad: string[] = [];
  for (const [kind, map] of [["spells", reg.spells], ["abilities", reg.abilities]] as const) {
    for (const [id, def] of map) {
      const line = (def as { say?: string }).say;
      if (!line) continue;
      const after = line.match(/\{caster\}\s+([a-z]+)/i);
      if (!after) continue;
      const verb = after[1]!;
      // The verb immediately after {caster} must carry a token, or be one of
      // the few that are identical in both persons.
      const tokenised = /\{caster\}\s+[a-z]+\{(s|es|are)\}/i.test(line);
      if (!tokenised) bad.push(`content/${kind}/${id}.json: "{caster} ${verb}" has no {s} or {es}`);
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}`);
});

test("damage messages name you as 'you', not as your name", () => {
  const you = spawn(reg, "classes", "ruinmage", 2, 2, true);
  const wolf = spawn(reg, "enemies", "wolf", 3, 2);
  const { ctx } = makeGame(reg, [you, wolf]);
  wolf.stats.accuracy = 100;

  const out = useAbility(ctx, wolf, reg.abilities.get("bite")!, you);
  const text = (out.messages ?? []).map((m) => m.text).join(" ");
  assert.match(text, /hits you for/, `the log read: ${text}`);
  assert.doesNotMatch(text, /hits You\b/, "the player was named instead of addressed");
});
