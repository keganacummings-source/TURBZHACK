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

/** Base stats every actor starts from, before its definition adjusts them. */
export const BASE_POOLS: Pools = {
  hp: 100, hpMax: 100,
  stamina: 100, staminaMax: 100,
  mana: 50, manaMax: 50,
};

/** Stamina returned at the end of every turn, to everyone. */
export const STAMINA_PER_TURN = 25;

/**
 * Turns an actor must go without being hurt before health starts coming back.
 *
 * This is what stops a fight being winnable by walking in circles: disengaging
 * costs ten clean turns before the first point of health returns.
 */
export const REGEN_DELAY_TURNS = 10;

/** Health returned per turn once the delay has passed. */
export const HP_PER_TURN = 2;

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
    this.data = { ...(init.data ?? {}) };
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
