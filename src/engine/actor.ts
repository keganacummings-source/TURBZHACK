/**
 * Actors: the player, enemies, anything that takes a turn.
 *
 * An actor is deliberately PLAIN DATA plus a few small methods. Everything that
 * makes one actor different from another — its stats, its sprite, what it does
 * on its turn — comes from a content file (content/enemies/*.json), not from a
 * subclass. That is the whole point of the modding design: adding a new enemy
 * must never mean touching the engine.
 */
import type { ActiveStatus, Pools, Pos, Stance } from "./types.ts";
import { absoluteAttributes, derive, newAttributes, withAttributes, type Attributes } from "./attributes.ts";

/** Base stats every actor starts from, before its definition adjusts them. */
export const BASE_POOLS: Pools = {
  hp: 100, hpMax: 100,
  stamina: 100, staminaMax: 100,
  mana: 50, manaMax: 50,
};

/**
 * Stamina returned at the end of every turn, to everyone.
 *
 * Lowered from 25 so that weapons costing under 10 stamina per swing can drain
 * the pool over a sustained fight. At 25 anything lighter than a mace had a
 * zero net cost and stamina was not a real resource. At 10, daggers and staves
 * regenerate faster than they spend (no drain on a quick fight), swords sit just
 * above the line and drain slowly, and heavy weapons drain fast enough that
 * resting a turn mid-fight is a genuine decision.
 */
export const STAMINA_PER_TURN = 10;

/**
 * Turns an actor must go without being hurt before health starts coming back.
 *
 * This is what stops a fight being winnable by walking in circles: disengaging
 * costs ten clean turns before the first point of health returns.
 */
export const REGEN_DELAY_TURNS = 10;

/** Health returned per turn once the delay has passed. */
export const HP_PER_TURN = 2;

/**
 * The combat stats, and what they start at.
 *
 * These are the numbers a level-up can raise, so they live beside the pools
 * rather than inside any one content file.
 *
 *   might    — flat damage added to every ABILITY (punch, kick, a claw)
 *   focus    — flat damage added to every SPELL
 *   accuracy — chance to hit, as a percentage, before the target's evasion
 *   evasion  — subtracted from an attacker's accuracy
 *
 * Accuracy starts at 85 rather than 100 because a system where you always hit
 * has no room to reward raising it, and NetHack's misses are part of its
 * texture. The floor and ceiling in `hitChance` stop either end running away.
 */
export const BASE_STATS = { might: 0, focus: 0, accuracy: 85, evasion: 0 } as const;
export type CombatStats = { might: number; focus: number; accuracy: number; evasion: number };

export type ActorInit = {
  id: string;
  /** Which content definition this actor is an instance of. */
  def: string;
  name: string;
  pos: Pos;
  pools?: Partial<Pools>;
  stance?: Stance;
  /** Sprite key, resolved against the atlas. */
  sprite?: string;
  isPlayer?: boolean;
  /** Spell ids this actor may cast. */
  spells?: string[];
  /** Enchantment ids currently on it. */
  enchantments?: string[];
  /** Flat damage reduction, before resistances. */
  armour?: number;
  /** Multipliers per damage kind: 0 is immune, 0.5 is halved, 2 is doubled. */
  resist?: Record<string, number>;
  /** Combat stats, merged over BASE_STATS. */
  stats?: Partial<CombatStats>;
  /** The six attributes. Anything left out stays at the average of 10. */
  attributes?: Partial<Attributes>;
  /** Anything the definition or a script wants to hang on the actor. */
  data?: Record<string, unknown>;
};

export class Actor {
  readonly id: string;
  readonly def: string;
  name: string;
  pos: Pos;
  pools: Pools;
  stance: Stance;
  sprite: string;
  readonly isPlayer: boolean;
  spells: string[];
  enchantments: string[];
  armour: number;
  resist: Record<string, number>;
  stats: CombatStats;
  /*
   * What this actor is WITHOUT its gear.
   *
   * `stats`, `armour` and `resist` are always base plus whatever is worn, and
   * equipment.ts recomputes them from scratch on every change. Keeping the
   * base separately is what makes that possible: without it there is no way to
   * take a bonus off again except by remembering to subtract exactly what was
   * added, which is the bug every equipment system eventually has.
   */
  baseStats: CombatStats;
  baseArmour: number;
  baseResist: Record<string, number>;
  /**
   * The six attributes, and the same without gear.
   *
   * Kept in the same base-and-total shape as the combat stats, and for the same
   * reason: a ring of might raises Strength while it is worn, and the only way
   * to take that off again reliably is to recompute the total from a base that
   * never changed.
   */
  attributes: Attributes;
  baseAttributes: Attributes;
  statuses: ActiveStatus[] = [];
  data: Record<string, unknown>;

  /** False once killed. Dead actors are kept for one turn so the log reads right. */
  alive = true;
  /** Turns since this actor last lost health, for the regen delay. */
  turnsSinceHurt = 0;
  /**
   * Energy, for the turn scheduler.
   *
   * An actor acts when this reaches 0 or more. Speed adds to it each tick, so a
   * fast creature acts twice while a slow one acts once, without the scheduler
   * knowing anything about what any of them are.
   */
  energy = 0;
  speed = 100;

  constructor(init: ActorInit) {
    this.id = init.id;
    this.def = init.def;
    this.name = init.name;
    this.pos = { ...init.pos };
    this.pools = { ...BASE_POOLS, ...init.pools };
    this.stance = init.stance ?? "hostile";
    this.sprite = init.sprite ?? init.def;
    this.isPlayer = !!init.isPlayer;
    this.spells = init.spells ? [...init.spells] : [];
    this.enchantments = init.enchantments ? [...init.enchantments] : [];
    this.armour = init.armour ?? 0;
    this.resist = { ...(init.resist ?? {}) };
    this.stats = { ...BASE_STATS, ...(init.stats ?? {}) };
    this.baseStats = { ...this.stats };
    this.baseArmour = this.armour;
    this.baseResist = { ...this.resist };
    this.attributes = withAttributes(newAttributes(), init.attributes);
    this.baseAttributes = { ...this.attributes };
    this.data = { ...(init.data ?? {}) };
  }

  /** Snapshot for a save file. */
  toSave() {
    return {
      id: this.id, def: this.def, name: this.name, pos: { ...this.pos },
      pools: { ...this.pools }, stance: this.stance, sprite: this.sprite,
      isPlayer: this.isPlayer, spells: [...this.spells],
      enchantments: [...this.enchantments],
      armour: this.armour, resist: { ...this.resist }, stats: { ...this.stats },
      baseStats: { ...this.baseStats }, baseArmour: this.baseArmour,
      baseResist: { ...this.baseResist },
      attributes: { ...this.attributes }, baseAttributes: { ...this.baseAttributes },
      statuses: this.statuses.map((s) => ({ ...s })),
      data: { ...this.data },
      alive: this.alive, turnsSinceHurt: this.turnsSinceHurt,
      energy: this.energy, speed: this.speed,
    };
  }

  /**
   * Rebuild one from a snapshot.
   *
   * The derived fields are assigned AFTER construction rather than passed in,
   * because the constructor computes `baseStats` from `stats` — correct when a
   * creature is born, wrong when it is being restored, since by then the two
   * have diverged by whatever it is wearing.
   */
  static fromSave(save: ActorSave): Actor {
    const a = new Actor({
      id: save.id, def: save.def, name: save.name, pos: save.pos,
      pools: save.pools, stance: save.stance, sprite: save.sprite,
      isPlayer: save.isPlayer, spells: save.spells,
      enchantments: save.enchantments, armour: save.armour,
      resist: save.resist, stats: save.stats, data: save.data,
    });
    a.pools = { ...save.pools };
    a.baseStats = { ...save.baseStats };
    a.baseArmour = save.baseArmour;
    a.baseResist = { ...save.baseResist };
    /*
     * A save holds finished values, not modifiers.
     *
     * Passing them through `withAttributes` added them to the base of ten and
     * every attribute came back doubled — the same mistake as in character
     * creation, and just as invisible. Saves written before attributes existed
     * have none at all, and fall back to the average rather than to zero, which
     * would leave a character unable to lift anything.
     */
    a.attributes = absoluteAttributes(save.attributes);
    a.baseAttributes = absoluteAttributes(save.baseAttributes ?? save.attributes);
    a.statuses = save.statuses.map((s) => ({ ...s }));
    a.alive = save.alive;
    a.turnsSinceHurt = save.turnsSinceHurt;
    a.energy = save.energy;
    a.speed = save.speed;
    return a;
  }

  /** Everything the attributes produce, recomputed on demand. */
  get derived() {
    return derive(this.attributes);
  }

  /** Clamp every pool into range. Called after anything touches them. */
  clampPools(): void {
    const p = this.pools;
    p.hpMax = Math.max(1, Math.round(p.hpMax));
    p.staminaMax = Math.max(0, Math.round(p.staminaMax));
    p.manaMax = Math.max(0, Math.round(p.manaMax));
    p.hp = Math.max(0, Math.min(p.hpMax, Math.round(p.hp)));
    p.stamina = Math.max(0, Math.min(p.staminaMax, Math.round(p.stamina)));
    p.mana = Math.max(0, Math.min(p.manaMax, Math.round(p.mana)));
  }

  /** Does this actor have the named status on it? */
  hasStatus(id: string): boolean {
    return this.statuses.some((s) => s.id === id && s.turns > 0);
  }

  status(id: string): ActiveStatus | undefined {
    return this.statuses.find((s) => s.id === id && s.turns > 0);
  }

  /**
   * Can this actor act at all this turn?
   *
   * Frozen is the reason this exists: a frozen actor is skipped entirely rather
   * than acting badly, and the thaw roll happens in the status tick.
   */
  get canAct(): boolean {
    return this.alive && !this.statuses.some((s) => s.turns > 0 && s.id === "frozen");
  }

  /** Spend stamina if there is enough. Returns false and spends nothing if not. */
  spendStamina(cost: number): boolean {
    if (cost <= 0) return true;
    if (this.pools.stamina < cost) return false;
    this.pools.stamina -= cost;
    return true;
  }

  /** Spend mana if there is enough. Returns false and spends nothing if not. */
  spendMana(cost: number): boolean {
    if (cost <= 0) return true;
    if (this.pools.mana < cost) return false;
    this.pools.mana -= cost;
    return true;
  }

  /**
   * The end of this actor's turn: stamina back, and health if it has been left
   * alone long enough.
   *
   * Statuses are NOT ticked here — they are ticked by the turn system, which
   * has the Rng and the message log that a status needs.
   */
  endTurnRecovery(): void {
    if (!this.alive) return;
    this.turnsSinceHurt++;
    this.pools.stamina = Math.min(this.pools.staminaMax, this.pools.stamina + STAMINA_PER_TURN);
    if (this.turnsSinceHurt > REGEN_DELAY_TURNS) {
      this.pools.hp = Math.min(this.pools.hpMax, this.pools.hp + HP_PER_TURN);
    }
    this.clampPools();
  }

  /** Took damage: health down, and the regen clock back to zero. */
  hurt(amount: number): number {
    if (amount <= 0) return 0;
    const before = this.pools.hp;
    this.pools.hp = Math.max(0, this.pools.hp - Math.round(amount));
    this.turnsSinceHurt = 0;
    if (this.pools.hp <= 0) this.alive = false;
    return before - this.pools.hp;
  }

  heal(amount: number): number {
    if (amount <= 0 || !this.alive) return 0;
    const before = this.pools.hp;
    this.pools.hp = Math.min(this.pools.hpMax, this.pools.hp + Math.round(amount));
    return this.pools.hp - before;
  }
}

/**
 * An actor, written down.
 *
 * Everything on an `Actor` is plain data — no references to other actors, no
 * live level, no closures — so a save is the fields themselves rather than a
 * rebuilt description. That is deliberate: a save that re-derived an actor from
 * its content definition would quietly undo every level-up, enchantment and
 * wound, because those live only on the instance.
 */
export type ActorSave = ReturnType<Actor["toSave"]>;
