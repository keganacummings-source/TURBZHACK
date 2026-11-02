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
import type { AbilityDef, ClassDef, EnemyDef, SpellDef, TileDef } from "./content/schema.ts";
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

  private nextId = 1;

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
    this.messages.push({ text, tone, turn: this.turn });
    // The log is read, not archived; keeping the last few hundred lines is
    // plenty and stops a long run growing without limit.
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  /** Begin a run as one of the classes. */
  start(classId: string): void {
    const def = this.reg.classes.get(classId);
    if (!def) throw new Error(`no class "${classId}" in content/classes/`);

    this.player = this.makeActor(classId, def, this.continent.start, true);
    /*
     * It is your turn when the game begins.
     *
     * Everyone starts on zero energy and gains their speed each tick. Without
     * this line the player starts a full action in debt, so their very first
     * command ticked the world twice and every monster got a free turn before
     * the player had done anything.
     */
    this.player.energy = ENERGY_PER_ACTION;
    this.actors = [this.player];
    this.place = { kind: "overworld" };
    this.populate();
    this.refreshFov();

    this.log(`You wake in ${this.continent.level.name}. Seed ${this.seedWord}.`, "good");
    this.log(`${def.name}: ${def.about ?? ""}`, "plain");
    this.log("Move with the arrow keys or hjklyubn. Walk into something to hit it. ? for help.", "plain");
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
    });
    a.speed = (def as EnemyDef).speed ?? 100;

    // Starting gear is applied as flat bonuses: this game has no inventory
    // screen yet, and an item you cannot take off is still an item that counts.
    for (const itemId of (def as ClassDef).items ?? []) {
      const item = this.reg.items.get(itemId);
      if (item?.armour) a.armour += item.armour;
    }
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
    this.refreshFov();
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private get actionCtx(): ActionCtx {
    return {
      level: this.level,
      actors: this.actors,
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
    this.refreshFov();
    if (!this.player.alive) {
      this.over = { won: false, reason: "You died." };
      this.log("Your run ends here.", "bad");
    }
  }

  refreshFov(): void {
    computeFov(this.level, this.player.pos, this.sight);
  }

  /** Walk, or attack whatever is in the way. */
  move(dx: number, dy: number): void {
    if (this.over) return;
    const punch = this.reg.abilities.get("punch");
    const res = moveOrAttack(this.actionCtx, this.player, dx, dy, punch);
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
    if (this.over) return;
    this.finishTurn(wait());
  }

  /** Use an ability on an adjacent creature, picking the nearest hostile. */
  ability(id: string, target?: Actor): void {
    if (this.over) return;
    const def = this.reg.abilities.get(id);
    if (!def) { this.log(`There is no ability "${id}".`, "warn"); return; }
    const victim = target ?? this.nearestHostile(def.range ?? 1);
    if (!victim) { this.log("Nothing within reach.", "warn"); return; }
    this.finishTurn(useAbility(this.actionCtx, this.player, def, victim));
  }

  /** Cast one of the player's spells at the nearest hostile it can reach. */
  cast(id: string, target?: Actor): void {
    if (this.over) return;
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
