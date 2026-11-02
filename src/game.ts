/**
 * The game: one run, from the class you pick to the moment you die.
 *
 * This is the only file that knows about ALL the pieces at once — content,
 * world, actors, turns — and its job is to keep them agreeing with each other.
 * Everything it does is deliberately boring plumbing, because every interesting
 * decision belongs either in the engine (rules) or in a content file (things).
 */
import { Actor } from "./engine/actor.ts";
import { Rng, seedFrom, seedName } from "./engine/rng.ts";
import { computeFov, distance, type Level } from "./engine/grid.ts";
import { monsterTurn, type AiCtx } from "./engine/ai.ts";
import { castSpell, moveOrAttack, useAbility, wait, actorAt, type ActionCtx } from "./engine/actions.ts";
import { ENERGY_PER_ACTION, playerActed, type TurnContext } from "./engine/turns.ts";
import type { StatusDef } from "./engine/status.ts";
import type { ActionResult, Message, Pos } from "./engine/types.ts";
import type { Registry } from "./content/registry.ts";
import type { AbilityDef, ClassDef, EnemyDef, SpeciesDef, SpellDef, TileDef, UpgradeDef } from "./content/schema.ts";
import { applyChoice, levelForXp, progressOf, rollChoices, PER_LEVEL, type Choice } from "./engine/progress.ts";
import {
  applyLoadout, equip, loadoutOf, unequip, SLOTS, type Slot, type Worn,
} from "./engine/equipment.ts";
import type { EnchantmentDef, ItemDef } from "./content/schema.ts";
import { generateContinent, type Continent } from "./world/continent.ts";
import { generateDungeon, type Dungeon } from "./world/dungeon.ts";

/** How far you can see. Dungeons are dark; outdoors you can see across a field. */
export const SIGHT_DUNGEON = 8;
export const SIGHT_OUTDOORS = 14;

/** Where the player is: the overworld, or a floor of a named dungeon. */
export type Place =
  | { kind: "overworld" }
  | { kind: "dungeon"; entrance: number; depth: number };

export class Game {
  readonly reg: Registry;
  readonly seed: number;
  readonly rng: Rng;

  continent: Continent;
  place: Place = { kind: "overworld" };
  /** Dungeon floors already generated, so going back up returns to the same floor. */
  private floors = new Map<string, Dungeon>();

  player!: Actor;
  actors: Actor[] = [];
  messages: Message[] = [];
  turn = 0;
  cooldowns = new Map<string, number>();
  /** Set when the run is over, so the UI stops taking input. */
  over: null | { won: boolean; reason: string } = null;

  /**
   * Experience, and the character level it has earned.
   *
   * Named `playerLevel` rather than `level` because `level` on this class is
   * already the MAP you are standing on, and two meanings of the word in one
   * object is how you end up reading the wrong one.
   */
  xp = 0;
  playerLevel = 1;
  /**
   * The five on offer, when a level-up is waiting to be spent.
   *
   * The game does not pause itself for this — the turn that killed the thing
   * still resolved — but the UI will not take another command until it is
   * chosen, which is what makes it feel like a decision rather than a popup.
   */
  pendingChoices: Choice[] | null = null;

  /** Item ids in the pack, and what is worn. */
  pack: string[] = [];
  worn: Worn = {};
  /** Loot lying on the ground, keyed `levelKey:tileIndex`. */
  loot = new Map<string, string[]>();

  private nextId = 1;
  /** What each living creature is worth, so a death can be priced after the fact. */
  private deadXp = new Map<string, number>();

  constructor(reg: Registry, seed: number | string = Date.now()) {
    this.reg = reg;
    this.seed = typeof seed === "string" ? seedFrom(seed) : (seed >>> 0 || 1);
    this.rng = new Rng(this.seed);
    this.continent = generateContinent(this.seed, reg.tiles as Map<string, TileDef>);
  }

  get seedWord(): string {
    return seedName(this.seed);
  }

  /** The level the player is standing on. */
  get level(): Level {
    if (this.place.kind === "overworld") return this.continent.level;
    return this.floor(this.place.entrance, this.place.depth).level;
  }

  get sight(): number {
    return this.place.kind === "overworld" ? SIGHT_OUTDOORS : SIGHT_DUNGEON;
  }

  log(text: string, tone?: Message["tone"]): void {
    /*
     * Repeats are counted, not appended.
     *
     * Refused actions log every time they are refused, which is correct — you
     * asked, and it said no — but bumping the same tree twenty times filled the
     * whole log with it and pushed the fight above out of sight.
     */
    const last = this.messages[this.messages.length - 1];
    if (last && last.text === text && last.tone === tone) {
      last.count = (last.count ?? 1) + 1;
      last.turn = this.turn;
      return;
    }
    this.messages.push({ text, tone, turn: this.turn });
    // The log is read, not archived; keeping the last few hundred lines is
    // plenty and stops a long run growing without limit.
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  /** What you are, and what you trained as. */
  speciesId = "human";
  classId = "fighter";

  /**
   * Begin a run.
   *
   * A character is a SPECIES and a BACKGROUND, the way Crawl does it, and the
   * two contribute to the same totals: the species decides the body and the
   * background decides what you walked in carrying. Either may be omitted and
   * a sensible one is used, so a caller that only cares about one of them does
   * not have to know about the other.
   */
  start(classId: string, speciesId = "human"): void {
    const def = this.reg.classes.get(classId);
    if (!def) throw new Error(`no background "${classId}" in content/classes/`);
    const species = this.reg.species.get(speciesId);
    if (!species) throw new Error(`no species "${speciesId}" in content/species/`);
    this.classId = classId;
    this.speciesId = speciesId;

    this.player = this.makeCharacter(species, def, this.continent.start);
    /*
     * It is your turn when the game begins.
     *
     * Everyone starts on zero energy and gains their speed each tick. Without
     * this line the player starts a full action in debt, so their very first
     * command ticked the world twice and every monster got a free turn before
     * the player had done anything.
     */
    this.player.energy = ENERGY_PER_ACTION;

    // The starting kit goes into the pack and the wearable parts go on, so
    // that what you begin with is the same kind of thing as what you find.
    this.pack = [...(def.items ?? [])];
    for (const id of [...this.pack]) {
      const item = this.reg.items.get(id);
      if (item?.slot && !["potion", "scroll", "misc"].includes(item.slot)) {
        equip(this.pack, this.worn, id, this.reg.items as Map<string, ItemDef>);
      }
    }
    this.refreshGear();
    this.actors = [this.player];
    this.place = { kind: "overworld" };
    this.populate();
    this.rememberWorth();
    this.refreshFov();

    this.log(`You wake in ${this.continent.level.name}. Seed ${this.seedWord}.`, "good");
    this.log(`${species.name} ${def.name}. ${def.blurb ?? ""}`, "plain");
    this.log("Move with the arrow keys or hjklyubn. Walk into something to hit it. ? for help.", "plain");
  }

  /**
   * Build the player from a species and a background.
   *
   * The two stack: pools, stats, armour and resistances all add (resistances
   * multiply), and the spell and ability lists are merged. That is what makes
   * a Minotaur Conjurer different from a Deep Elf one in more than flavour.
   */
  private makeCharacter(species: SpeciesDef, bg: ClassDef, pos: Pos): Actor {
    /*
     * Floors, because the two sets of modifiers stack.
     *
     * A Minotaur is bad at magic and a Fighter is bad at magic, and together
     * they took the mana pool below zero, which showed up on the character
     * sheet as "Mana -5" and would have made every spell permanently
     * uncastable in a way no message explained. Nought is the honest answer:
     * that character does not cast.
     */
    const floor = (n: number) => Math.max(0, n);
    const hpMax = Math.max(1, 100 + (species.pools?.hp ?? 0) + (bg.pools?.hp ?? 0));
    const staminaMax = floor(100 + (species.pools?.stamina ?? 0) + (bg.pools?.stamina ?? 0));
    const manaMax = floor(50 + (species.pools?.mana ?? 0) + (bg.pools?.mana ?? 0));

    const stats: Record<string, number> = {};
    for (const key of ["might", "focus", "accuracy", "evasion"] as const) {
      const from = (species.stats?.[key] ?? 0) + (bg.stats?.[key] ?? 0);
      if (from) stats[key] = (key === "accuracy" ? 85 : 0) + from;
    }

    // Resistances multiply, so a Gargoyle Fighter is not simply the tougher of
    // the two — it is both.
    const resist: Record<string, number> = {};
    for (const src of [species.resist, bg.resist]) {
      for (const [kind, mult] of Object.entries(src ?? {})) {
        if (typeof mult !== "number") continue;
        resist[kind] = (resist[kind] ?? 1) * mult;
      }
    }

    const a = new Actor({
      id: `a${this.nextId++}`,
      def: this.classId,
      name: "You",
      pos,
      pools: { hp: hpMax, hpMax, stamina: staminaMax, staminaMax, mana: manaMax, manaMax },
      stance: "friendly",
      sprite: species.sprite ?? `pc-${species.id}`,
      isPlayer: true,
      spells: [...new Set([...(species.spells ?? []), ...(bg.spells ?? [])])],
      armour: (species.armour ?? 0) + (bg.armour ?? 0),
      resist,
      stats,
    });
    a.speed = species.speed ?? 100;
    a.baseStats = { ...a.stats };
    a.baseArmour = a.armour;
    a.baseResist = { ...a.resist };
    a.clampPools();
    return a;
  }

  /** Build an actor from a class or enemy definition. */
  private makeActor(defId: string, def: ClassDef | EnemyDef, pos: Pos, isPlayer = false): Actor {
    const hpMax = 100 + (def.pools?.hp ?? 0);
    const staminaMax = 100 + (def.pools?.stamina ?? 0);
    const manaMax = 50 + (def.pools?.mana ?? 0);
    const a = new Actor({
      id: `a${this.nextId++}`,
      def: defId,
      name: isPlayer ? "You" : def.name,
      pos,
      pools: { hp: hpMax, hpMax, stamina: staminaMax, staminaMax, mana: manaMax, manaMax },
      stance: isPlayer ? "friendly" : ((def as EnemyDef).stance ?? "hostile"),
      sprite: def.sprite ?? defId,
      isPlayer,
      spells: def.spells ?? [],
      armour: def.armour ?? 0,
      resist: (def.resist ?? {}) as Record<string, number>,
      stats: def.stats,
    });
    a.speed = (def as EnemyDef).speed ?? 100;

    a.clampPools();
    return a;
  }

  // -------------------------------------------------------------------------
  // Levels
  // -------------------------------------------------------------------------

  private floor(entrance: number, depth: number): Dungeon {
    const key = `${entrance}:${depth}`;
    const had = this.floors.get(key);
    if (had) return had;
    const e = this.continent.entrances[entrance];
    const made = generateDungeon(
      this.seed ^ (entrance * 7919),
      depth,
      this.reg.tiles as Map<string, TileDef>,
      `${e?.name ?? "The Deep"} — floor ${depth}`,
    );
    this.floors.set(key, made);
    return made;
  }

  /**
   * Fill the current level with creatures.
   *
   * Which creatures is decided entirely by the enemy files: each one lists the
   * biomes and the depths it belongs to, and a weight. Nothing here names a
   * single monster, so adding one to a biome is editing that monster's file.
   */
  private populate(): void {
    const level = this.level;
    const rng = this.rng.fork(`populate:${this.place.kind}:${this.place.kind === "dungeon" ? `${this.place.entrance}:${this.place.depth}` : "0"}`);
    const depth = this.place.kind === "dungeon" ? this.place.depth : 0;
    const want = this.place.kind === "overworld" ? 40 : 6 + depth;

    const candidates = [...this.reg.enemies.values()].filter((e) => {
      const min = e.depth?.min ?? 0;
      const max = e.depth?.max ?? 99;
      return depth >= min && depth <= max;
    });
    if (!candidates.length) return;

    for (let tries = 0, made = 0; tries < want * 50 && made < want; tries++) {
      const x = rng.int(level.w), y = rng.int(level.h);
      if (level.solid(x, y)) continue;
      // Never on top of the player, and never close enough to be in your face
      // the instant you arrive.
      if (this.player && distance({ x, y }, this.player.pos) < 8) continue;
      if (actorAt(this.actors, x, y)) continue;

      const here = this.place.kind === "overworld"
        ? this.continent.biome[y * level.w + x]!
        : "dungeon";
      /*
       * Only creatures whose own file lists this biome.
       *
       * The first version fell back to "any creature of the right depth" when
       * nothing fitted the local ground, which quietly undid the whole point of
       * the biome lists — grey rats turned up in the badlands. If nothing
       * belongs here, nothing spawns here, and the tile is simply empty.
       */
      const fit = candidates.filter((e) => !e.biomes?.length || e.biomes.includes(here));
      if (!fit.length) continue;
      const pick = rng.weighted(fit, (e) => e.weight ?? 10);
      if (!pick) continue;

      this.actors.push(this.makeActor(String(pick.id), pick, { x, y }));
      made++;
    }
    this.scatterLoot(rng, depth);
  }

  /**
   * Leave gear lying about.
   *
   * Which gear is decided entirely by the item files: each lists the depths it
   * belongs to and how often it turns up, so making a sword rarer is editing
   * that sword. Deeper floors get more of it and better of it, which is the
   * only reason to go down.
   */
  private scatterLoot(rng: Rng, depth: number): void {
    const level = this.level;
    const key = this.levelKey;
    const pool = [...this.reg.items.values()].filter((i) => {
      if ((i.weight_find ?? 10) <= 0) return false;
      const min = i.depth?.min ?? 0;
      const max = i.depth?.max ?? 99;
      return depth >= min && depth <= max;
    });
    if (!pool.length) return;

    const want = this.place.kind === "overworld" ? 24 : 4 + Math.floor(depth * 1.2);
    for (let tries = 0, made = 0; tries < want * 40 && made < want; tries++) {
      const x = rng.int(level.w), y = rng.int(level.h);
      if (level.solid(x, y)) continue;
      const at = `${key}:${level.idx(x, y)}`;
      if (this.loot.has(at)) continue;
      const pick = rng.weighted(pool, (i) => i.weight_find ?? 10);
      if (!pick) continue;
      this.loot.set(at, [String(pick.id)]);
      made++;
    }
  }

  /** Walk into a dungeon entrance, or take stairs. */
  private useTile(): boolean {
    const t = this.level.at(this.player.pos.x, this.player.pos.y);
    if (!t?.on) return false;

    if (t.on === "dungeon-entrance" && this.place.kind === "overworld") {
      const i = this.continent.entrances.findIndex(
        (e) => e.pos.x === this.player.pos.x && e.pos.y === this.player.pos.y);
      if (i < 0) return false;
      const e = this.continent.entrances[i]!;
      this.enterLevel({ kind: "dungeon", entrance: i, depth: 1 }, this.floor(i, 1).up);
      this.log(`You climb down into ${e.name}.`, "good");
      return true;
    }
    if (t.on === "stairs-down" && this.place.kind === "dungeon") {
      const next = this.place.depth + 1;
      const d = this.floor(this.place.entrance, next);
      this.enterLevel({ kind: "dungeon", entrance: this.place.entrance, depth: next }, d.up);
      this.log(`You descend to floor ${next}.`, "good");
      return true;
    }
    if (t.on === "stairs-up" && this.place.kind === "dungeon") {
      if (this.place.depth <= 1) {
        const e = this.continent.entrances[this.place.entrance];
        this.enterLevel({ kind: "overworld" }, e?.pos ?? this.continent.start);
        this.log("You climb back out into daylight.", "good");
        return true;
      }
      const up = this.place.depth - 1;
      const d = this.floor(this.place.entrance, up);
      this.enterLevel({ kind: "dungeon", entrance: this.place.entrance, depth: up }, d.down);
      this.log(`You climb up to floor ${up}.`, "good");
      return true;
    }
    return false;
  }

  /** Move the player to another level, leaving its creatures behind. */
  private enterLevel(place: Place, at: Pos): void {
    this.place = place;
    this.player.pos = { ...at };
    // Creatures do not follow between levels, which is NetHack's rule and also
    // what makes stairs a real escape when a fight has gone wrong.
    this.actors = [this.player];
    this.populate();
    this.rememberWorth();
    this.refreshFov();
  }

  /** Price everyone currently alive, so awardXp can tell what a death was worth. */
  private rememberWorth(): void {
    this.deadXp.clear();
    for (const a of this.actors) {
      if (a.isPlayer) continue;
      this.deadXp.set(a.id, this.reg.enemies.get(a.def)?.xp ?? 0);
    }
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private get actionCtx(): ActionCtx {
    return {
      level: this.level,
      actors: this.actors,
      rng: this.rng,
      statuses: this.reg.statuses as Map<string, StatusDef>,
      turn: this.turn,
      cooldowns: this.cooldowns,
    };
  }

  private get turnCtx(): TurnContext {
    const self = this;
    return {
      level: this.level,
      actors: this.actors,
      rng: this.rng,
      statuses: this.reg.statuses as Map<string, StatusDef>,
      get turn() { return self.turn; },
      set turn(v: number) { self.turn = v; },
      log: (t, tone) => this.log(t, tone),
    };
  }

  /** Let the world have its turn, then look around again. */
  private finishTurn(result: ActionResult): void {
    if (this.over) return;
    const ai: AiCtx = {
      ...this.actionCtx,
      rng: this.rng,
      player: this.player,
      enemies: this.reg.enemies as Map<string, EnemyDef>,
      abilities: this.reg.abilities as Map<string, AbilityDef>,
      spells: this.reg.spells as Map<string, SpellDef>,
    };
    playerActed(this.turnCtx, result, (actor) => monsterTurn(actor, { ...ai, turn: this.turn }));
    this.awardXp();
    this.refreshFov();
    if (!this.player.alive) {
      this.over = { won: false, reason: "You died." };
      this.log("Your run ends here.", "bad");
    }
  }

  /**
   * Hand out experience for anything that has died, and level up if it is earned.
   *
   * Driven entirely by the `deadXp` ledger: anything in it that is no longer
   * alive died since the last check, whatever killed it. That matters because
   * nothing here can hook "the kill" — a creature can die to a punch, to
   * burning three turns later, or to poison on somebody else's turn.
   *
   * The first version snapshotted who was alive at the top of `finishTurn`,
   * which looked right and was not: an ability resolves BEFORE finishTurn is
   * called, so the thing you had just killed was already dead by the time the
   * snapshot was taken, and punching something to death earned nothing.
   */
  private awardXp(): void {
    let gained = 0;
    const alive = new Set(this.actors.filter((a) => a.alive).map((a) => a.id));
    for (const [id, worth] of this.deadXp) {
      if (!alive.has(id)) gained += worth;
    }
    this.rememberWorth();
    if (gained <= 0) return;

    this.xp += gained;
    const now = levelForXp(this.xp);
    while (this.playerLevel < now) {
      this.playerLevel++;
      this.player.pools.hpMax += PER_LEVEL.hpMax;
      this.player.pools.hp += PER_LEVEL.hpMax;
      this.player.pools.staminaMax += PER_LEVEL.staminaMax;
      this.player.pools.stamina += PER_LEVEL.staminaMax;
      this.player.pools.manaMax += PER_LEVEL.manaMax;
      this.player.pools.mana += PER_LEVEL.manaMax;
      this.player.clampPools();
      this.log(`You reach level ${this.playerLevel}.`, "good");
      // The roll is forked by level, so it is the same five every time for a
      // given seed — the choice is a decision, not something to reroll.
      this.pendingChoices = rollChoices(
        this.playerLevel,
        this.player.spells,
        this.reg.spells as Map<string, SpellDef>,
        this.reg.upgrades as Map<string, UpgradeDef>,
        this.rng.fork(`level:${this.playerLevel}`),
      );
    }
  }

  /** Take one of the five. */
  chooseUpgrade(index: number): boolean {
    const offered = this.pendingChoices;
    if (!offered) return false;
    const pick = offered[index];
    if (!pick) return false;
    this.log(applyChoice(this.player, pick, this.reg.upgrades as Map<string, UpgradeDef>), "good");
    this.pendingChoices = null;
    return true;
  }

  /** Level, and how far into the next one. */
  get progress() {
    return progressOf(this.xp);
  }

  /**
   * Recompute what the gear is worth and put it on the player.
   *
   * Called after anything touches the pack or the worn map. Totals are built
   * from scratch every time rather than added and subtracted as things go on
   * and off, which is the only way to be sure taking a sword off cannot leave
   * part of it behind.
   */
  refreshGear(): void {
    const load = loadoutOf(
      this.worn,
      this.reg.items as Map<string, ItemDef>,
      this.reg.enchantments as Map<string, EnchantmentDef>,
    );
    applyLoadout(this.player, load);
  }

  /** The weapon in hand, or bare hands. */
  get weaponAbility(): AbilityDef {
    const load = loadoutOf(
      this.worn,
      this.reg.items as Map<string, ItemDef>,
      this.reg.enchantments as Map<string, EnchantmentDef>,
    );
    const punch = this.reg.abilities.get("punch")!;
    if (!load.weapon) return punch;
    /*
     * A wielded weapon becomes the attack you make by walking into things.
     *
     * Built here rather than stored as a content file, because it is the
     * COMBINATION of a weapon and the bare-handed attack it replaces — the
     * stamina cost and the reach stay the hand's, only the damage and the kind
     * come from the steel.
     */
    return {
      ...punch,
      id: `weapon:${load.weapon.name}`,
      name: load.weapon.name,
      damage: load.weapon.damage,
      kind: load.weapon.kind,
      applies: load.applies.length ? load.applies : undefined,
      say: "{caster} strike{s} {target} with the " + load.weapon.name.toLowerCase() + ".",
    };
  }

  /** Put something on. */
  wear(itemId: string, slot?: Slot): void {
    const out = equip(this.pack, this.worn, itemId, this.reg.items as Map<string, ItemDef>, slot);
    this.log(out.message, out.ok ? "good" : "warn");
    if (out.ok) this.refreshGear();
  }

  /** Take something off. */
  remove(slot: Slot): void {
    const out = unequip(this.pack, this.worn, slot, this.reg.items as Map<string, ItemDef>);
    this.log(out.message, out.ok ? "plain" : "warn");
    if (out.ok) this.refreshGear();
  }

  /** Drink, read, or wave the thing. */
  use(itemId: string): void {
    if (this.over || this.pendingChoices) return;
    const item = this.reg.items.get(itemId);
    if (!item?.casts) { this.log("Nothing happens.", "warn"); return; }
    const spell = this.reg.spells.get(item.casts);
    if (!spell) { this.log("Nothing happens.", "warn"); return; }

    const shape = spell.target ?? "actor";
    const victim = shape === "self" ? this.player : this.nearestHostile(spell.range ?? 1);
    if (!victim) { this.log("There is nothing to use it on.", "warn"); return; }

    // An item's spell is free: the charge IS the cost.
    const saved = this.player.pools.mana;
    this.player.pools.mana = Math.max(saved, spell.mana);
    const result = castSpell(this.actionCtx, this.player, spell, victim);
    this.player.pools.mana = saved;

    if (!result.tookTurn) { for (const m of result.messages ?? []) this.log(m.text, m.tone); return; }
    const at = this.pack.indexOf(itemId);
    if (at >= 0) this.pack.splice(at, 1);
    this.log(`You use the ${item.name.toLowerCase()}.`, "magic");
    this.finishTurn(result);
  }

  /** The key for the level the player is on, for the loot map. */
  private get levelKey(): string {
    return this.place.kind === "overworld" ? "o" : `d${this.place.entrance}:${this.place.depth}`;
  }

  /** What is lying on a tile. */
  lootAt(x: number, y: number): string[] {
    return this.loot.get(`${this.levelKey}:${this.level.idx(x, y)}`) ?? [];
  }

  /** Pick everything up off the tile you are standing on. */
  pickUp(): void {
    if (this.over || this.pendingChoices) return;
    const key = `${this.levelKey}:${this.level.idx(this.player.pos.x, this.player.pos.y)}`;
    const here = this.loot.get(key);
    if (!here?.length) { this.log("There is nothing here.", "warn"); return; }
    for (const id of here) {
      this.pack.push(id);
      this.log(`You pick up ${this.reg.items.get(id)?.name ?? id}.`, "good");
    }
    this.loot.delete(key);
    this.finishTurn({ tookTurn: true });
  }

  /** Drop something where you stand. */
  drop(itemId: string): void {
    const at = this.pack.indexOf(itemId);
    if (at < 0) return;
    this.pack.splice(at, 1);
    const key = `${this.levelKey}:${this.level.idx(this.player.pos.x, this.player.pos.y)}`;
    this.loot.set(key, [...(this.loot.get(key) ?? []), itemId]);
    this.log(`You drop ${this.reg.items.get(itemId)?.name ?? itemId}.`, "plain");
  }

  refreshFov(): void {
    computeFov(this.level, this.player.pos, this.sight);
  }

  /** Walk, or attack whatever is in the way. */
  move(dx: number, dy: number): void {
    if (this.over || this.pendingChoices) return;
    // Whatever is in your hand, or your fist if it is empty.
    const res = moveOrAttack(this.actionCtx, this.player, dx, dy, this.weaponAbility);
    // Stepping onto stairs or a dungeon mouth takes you through them at once,
    // so the map never needs a separate "use" key for the common case.
    if (res.tookTurn) {
      for (const m of res.messages ?? []) this.log(m.text, m.tone);
      if (this.useTile()) { this.finishTurn({ tookTurn: true }); return; }
      this.finishTurn({ tookTurn: true });
      return;
    }
    this.finishTurn(res);
  }

  /** Stand still for a turn. */
  rest(): void {
    if (this.over || this.pendingChoices) return;
    this.finishTurn(wait());
  }

  /** Use an ability on an adjacent creature, picking the nearest hostile. */
  ability(id: string, target?: Actor): void {
    if (this.over || this.pendingChoices) return;
    const def = this.reg.abilities.get(id);
    if (!def) { this.log(`There is no ability "${id}".`, "warn"); return; }
    const victim = target ?? this.nearestHostile(def.range ?? 1);
    if (!victim) { this.log("Nothing within reach.", "warn"); return; }
    this.finishTurn(useAbility(this.actionCtx, this.player, def, victim));
  }

  /** Cast one of the player's spells at the nearest hostile it can reach. */
  cast(id: string, target?: Actor): void {
    if (this.over || this.pendingChoices) return;
    const def = this.reg.spells.get(id);
    if (!def) { this.log(`There is no spell "${id}".`, "warn"); return; }
    if (!this.player.spells.includes(id)) { this.log(`You do not know ${def.name}.`, "warn"); return; }
    const shape = def.target ?? "actor";
    const victim = shape === "self" ? this.player : (target ?? this.nearestHostile(def.range ?? 1));
    if (!victim) { this.log("Nothing in range to aim at.", "warn"); return; }
    this.finishTurn(castSpell(this.actionCtx, this.player, def, victim));
  }

  /**
   * The closest hostile you can see within a range.
   *
   * Auto-targeting rather than a cursor, because at this scale the nearest
   * enemy is what you meant well over nine times in ten. An explicit aim mode
   * is the obvious next thing to add.
   */
  nearestHostile(range: number): Actor | undefined {
    let best: Actor | undefined;
    let bd = Infinity;
    for (const a of this.actors) {
      if (!a.alive || a.isPlayer || a.stance !== "hostile") continue;
      const d = distance(a.pos, this.player.pos);
      if (d > range) continue;
      if (!this.level.visible[this.level.idx(a.pos.x, a.pos.y)]) continue;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** What is standing on a tile, for the look command and for the renderer. */
  actorAt(x: number, y: number): Actor | undefined {
    return actorAt(this.actors, x, y);
  }

  /** A one-line description of where you are. */
  get whereAmI(): string {
    if (this.place.kind === "overworld") {
      const b = this.continent.biome[this.player.pos.y * this.continent.level.w + this.player.pos.x];
      return `${this.continent.level.name} — ${b ?? "nowhere"}`;
    }
    return this.level.name;
  }
}
