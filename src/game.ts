/**
 * The game: one run, from the class you pick to the moment you die.
 *
 * This is the only file that knows about ALL the pieces at once — content,
 * world, actors, turns — and its job is to keep them agreeing with each other.
 * Everything it does is deliberately boring plumbing, because every interesting
 * decision belongs either in the engine (rules) or in a content file (things).
 */
import { Actor, type ActorSave } from "./engine/actor.ts";
import { Rng, seedFrom, seedName } from "./engine/rng.ts";
import { computeFov, distance, type Level } from "./engine/grid.ts";
import { findPath } from "./engine/path.ts";
import { newMarket, quote, stall, trade, type Market, type Quote } from "./engine/market.ts";
import { makeQuest, isDone, ordinal, progressLine, type ActiveQuest } from "./engine/quests.ts";
import { TRADE } from "./world/economy.ts";
import { ATTRIBUTES, ATTRIBUTE_BASE, POINTS_PER_LEVEL, clampAttribute, type AttributeId } from "./engine/attributes.ts";
import {
  WEAPON_CLASS, accuracyWith, classOf, damageWith, itemValue, skillFor, swingCost, weaponStats,
  type ItemInstance,
} from "./engine/weapons.ts";
import { monsterTurn, type AiCtx } from "./engine/ai.ts";
import { castSpell, moveOrAttack, useAbility, wait, actorAt, type ActionCtx } from "./engine/actions.ts";
import { ENERGY_PER_ACTION, playerActed, type TurnContext } from "./engine/turns.ts";
import type { StatusDef } from "./engine/status.ts";
import type { ActionResult, Message, Pos } from "./engine/types.ts";
import type { Registry } from "./content/registry.ts";
import type { AbilityDef, ClassDef, EnemyDef, NpcDef, QuestDef, SpeciesDef, SpellDef, TileDef, UpgradeDef } from "./content/schema.ts";
import {
  applyChoice, isMilestone, levelForXp, newPerks, rollChoices, xpForLevel,
  PER_LEVEL, type Choice, type Perks,
} from "./engine/progress.ts";
import {
  applyLoadout, equip, isWearable, loadoutOf, unequip, SLOTS, type Slot, type Worn,
} from "./engine/equipment.ts";
import type { EnchantmentDef, ItemDef } from "./content/schema.ts";
import { BIOME_BY_ID, generateContinent, placeLairs, REGION_BANDS, type Continent, type Village } from "./world/continent.ts";
import { DUNGEON_FLOORS, generateDungeon, type Dungeon } from "./world/dungeon.ts";
import { SAVE_VERSION, decodeRuns, encodeRuns, type SaveFile } from "./engine/save.ts";

/** How far you can see. Dungeons are dark; outdoors you can see across a field. */
export const SIGHT_DUNGEON = 8;
export const SIGHT_OUTDOORS = 14;

/** Where the player is: the overworld, or a floor of a named dungeon. */
export type Place =
  | { kind: "overworld" }
  | { kind: "dungeon"; entrance: number; depth: number };

/** How many companions you can keep. More than this and nobody can tell them apart. */
export const PARTY_LIMIT = 3;

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

  /**
   * One reroll per level-up.
   *
   * A roll of five things none of which suit the character you are building is a
   * level that happened to you rather than one you spent. One reroll makes the
   * roll a hand rather than a verdict, and only one keeps it a decision: with
   * unlimited rerolls everyone would simply fish for the same best option every
   * time and the roll would stop mattering at all.
   */
  rerollsLeft = 0;

  /**
   * Whether the pending choice is a milestone one.
   *
   * Kept beside the choices so the UI can say so without re-deriving it from a
   * level number that may already have moved on.
   */
  pendingMilestone = false;

  /**
   * What levelling has changed outside combat.
   *
   * Separate from the player's stats because equipment recomputes those from
   * scratch whenever anything is worn — a perk stored there would be wiped by
   * putting a hat on.
   */
  perks: Perks = newPerks();

  /** Talents already taken, so a milestone never offers the same one twice. */
  talentsTaken: string[] = [];

  /**
   * Attribute points earned and not yet spent.
   *
   * Kept as a bank rather than forced at the moment of levelling, so a level-up
   * is one decision instead of three and the points can be saved towards a
   * threshold — several items ask for 13 Strength, and being able to aim at that
   * is the sort of planning the attribute system exists to allow.
   */
  attributePoints = 0;

  /** Item ids in the pack, and what is worn. */
  pack: string[] = [];
  worn: Worn = {};
  /** Loot lying on the ground, keyed `levelKey:tileIndex`. */
  loot = new Map<string, string[]>();

  /** Actor ids following you. */
  party: string[] = [];

  // --- money, markets, standing, quests -----------------------------------

  /**
   * Coin.
   *
   * One currency, because two is a spreadsheet. It comes from selling, from
   * quests, and from what the dead were carrying.
   */
  coin = 0;

  /** A market per village, by index into `continent.villages`. */
  markets = new Map<number, Market>();

  /** How well each village thinks of you, by index. */
  standing = new Map<number, number>();

  /** Quests taken and not yet handed in, plus the ones that are done. */
  quests: ActiveQuest[] = [];

  /** Quest ids already handed in, so the same errand is not offered twice. */
  questsDone: string[] = [];

  /** The deepest floor reached in each dungeon, for delve quests. */
  deepestIn = new Map<number, number>();

  /** World bosses already dealt with, so a lair stays empty once cleared. */
  bossesKilled = new Set<string>();

  private nextId = 1;
  /** What each living creature is worth, so a death can be priced after the fact. */
  private deadXp = new Map<string, number>();

  constructor(reg: Registry, seed: number | string = Date.now()) {
    this.reg = reg;
    this.seed = typeof seed === "string" ? seedFrom(seed) : (seed >>> 0 || 1);
    this.rng = new Rng(this.seed);
    this.continent = generateContinent(this.seed, reg.tiles as Map<string, TileDef>);
    /*
     * Bosses get their lairs when the world is built, not when you arrive.
     *
     * This runs in the constructor so a loaded save gets the same lairs as the
     * run that wrote it without the save having to store them: same seed, same
     * bosses, same places. It is also why it uses its own forked stream —
     * adding or removing a boss must not shift every other random draw in the
     * game.
     */
    placeLairs(
      this.continent,
      [...reg.enemies.values()]
        .filter((e) => e.boss)
        .map((e) => ({ id: String(e.id), biomes: e.biomes, region: e.region })),
      this.rng.fork("lairs"),
    );
  }

  get seedWord(): string {
    return seedName(this.seed);
  }

  /**
   * What to tell a new player about moving.
   *
   * The UI replaces this before `start`, because only the UI knows which keys
   * are actually bound; the default is here so a run begun from a test or the
   * console still says something true.
   */
  movementHint = "Move with the numpad — 1 through 9, with 5 to wait. Right-click anything for what you can do to it.";

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
      if (isWearable(item?.slot)) {
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
    this.log(this.movementHint, "plain");
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
    // Species and background no longer carry raw pool modifiers — Endurance,
    // Strength and Wits do — so these three are the plain 100/100/50 unless a
    // mod puts a `pools` block back, which still works.

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

    /*
     * Species and background both shift the attributes, and they add.
     *
     * What goes in here is the DIFFERENCE from average, not the final value:
     * the Actor constructor applies these on top of a base of 10. Passing the
     * finished number instead doubled every attribute, which turned a Conjurer's
     * 80 health into 134 and was invisible on the character sheet because 20
     * Strength looks like a perfectly plausible number.
     */
    const attributes: Record<string, number> = {};
    for (const src of [species.attributes, bg.attributes]) {
      for (const [key, value] of Object.entries(src ?? {})) {
        if (typeof value !== "number") continue;
        attributes[key] = (attributes[key] ?? 0) + value;
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
      attributes: attributes as never,
    });
    a.speed = species.speed ?? 100;
    a.baseStats = { ...a.stats };
    a.baseArmour = a.armour;
    a.baseResist = { ...a.resist };
    /*
     * Record the pool bases, so attributes can move the maximums later.
     *
     * `applyLoadout` reconciles each pool against its base plus whatever
     * Endurance and Wits are currently worth. Without a recorded base it has no
     * way to tell a bonus from the pool itself and leaves the maximums alone —
     * which is correct for a goblin and wrong for the player, who will be
     * spending attribute points all run.
     */
    a.data["poolHp"] = hpMax;
    a.data["poolStamina"] = staminaMax;
    a.data["poolMana"] = manaMax;
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
    /*
     * How dangerous this floor is, which is not the same as how deep it is.
     *
     * Every dungeon is ten floors, so the floor number alone would make a
     * dungeon at the edge of the map exactly as easy on floor 1 as the one
     * outside your door. The entrance carries a tier set by how far out it is,
     * and the two add: a far dungeon is already bad at the top, and floor 10 of
     * it is the worst thing in the game.
     */
    const depth = this.place.kind === "dungeon" ? this.dangerOf(this.place) : 0;
    const floorNumber = this.place.kind === "dungeon" ? this.place.depth : 0;
    const want = this.place.kind === "overworld" ? 40 : 6 + floorNumber;

    const candidates = [...this.reg.enemies.values()].filter((e) => {
      // Bosses are placed in their lairs, never scattered by this pass.
      if (e.boss) return false;
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
       * How far out this tile is, 0-5. In a dungeon the depth stands in for it,
       * so a creature written as "band 3-5" is also found deep underground
       * without needing a second table.
       */
      const band = this.place.kind === "overworld"
        ? this.continent.region[y * level.w + x]!
        : Math.min(REGION_BANDS, Math.ceil(depth / 2));
      /*
       * Only creatures whose own file lists this biome.
       *
       * The first version fell back to "any creature of the right depth" when
       * nothing fitted the local ground, which quietly undid the whole point of
       * the biome lists — grey rats turned up in the badlands. If nothing
       * belongs here, nothing spawns here, and the tile is simply empty.
       */
      const fit = candidates.filter((e) => {
        if (e.biomes?.length && !e.biomes.includes(here)) return false;
        if ((e.region?.min ?? 0) > band) return false;
        if ((e.region?.max ?? REGION_BANDS) < band) return false;
        return true;
      });
      if (!fit.length) continue;
      const pick = rng.weighted(fit, (e) => e.weight ?? 10);
      if (!pick) continue;

      this.actors.push(this.makeActor(String(pick.id), pick, { x, y }));
      made++;
    }
    if (this.place.kind === "overworld") { this.placeBosses(); this.placeVillagers(); }
    else this.placeKeeper(floorNumber);
    this.scatterLoot(rng, depth);
  }

  /**
   * Put the villagers in their villages.
   *
   * One actor per NPC role that suits the village's trade, each with a name of
   * its own, standing on the paving. They are real actors rather than a menu
   * attached to the tile, so that right-clicking one works exactly like
   * right-clicking anything else — and so that they can be seen, walked up to,
   * and in principle killed, which is a decision the world should allow even if
   * it is a bad one.
   */
  private placeVillagers(): void {
    const rng = this.rng.fork("villagers");
    this.continent.villages.forEach((village, index) => {
      // Already standing there from an earlier visit.
      if (this.villagersOf(index).length) return;

      const roles = [...this.reg.npcs.values()].filter((npc) => {
        if (npc.trades?.length && !npc.trades.includes(village.trade)) return false;
        return true;
      });

      // A fixed stream per village, so the same seed always has the same people
      // in the same place with the same names.
      const own = rng.fork(`village:${index}`);
      let slot = 0;
      for (const npc of roles) {
        if ((npc.chance ?? 1) < 1 && own.next() > (npc.chance ?? 1)) continue;
        const spot = this.spotInVillage(village, slot++);
        if (!spot) continue;
        const a = new Actor({
          id: `a${this.nextId++}`,
          def: `npc:${npc.id}`,
          name: `${villagerName(own)} the ${npc.name ?? npc.role}`,
          pos: spot,
          stance: "neutral",
          sprite: npc.sprite ?? "pc-human",
        });
        a.data["npc"] = String(npc.id);
        a.data["village"] = index;
        // Villagers do not wander and do not fight. A shopkeeper who walks off
        // mid-transaction is a bug report, not a feature.
        a.speed = 0;
        this.actors.push(a);
      }
    });
  }

  /** An open square inside a village, for the nth villager. */
  private spotInVillage(village: Village, n: number): Pos | null {
    const ring: [number, number][] = [
      [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, 0], [1, 0], [0, -1], [0, 1], [-3, 1], [3, -1],
    ];
    for (let i = 0; i < ring.length; i++) {
      const [dx, dy] = ring[(n + i) % ring.length]!;
      const x = village.pos.x + dx, y = village.pos.y + dy;
      if (!this.level.inBounds(x, y)) continue;
      if (this.level.solid(x, y)) continue;
      if (this.actorAt(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  // --- quests --------------------------------------------------------------

  /**
   * What this villager has to offer.
   *
   * Built from the world around the village rather than from a fixed list, and
   * cached by id so that asking twice shows the same errand — being offered a
   * different quest every time you reopen a conversation would make the whole
   * thing feel like a slot machine.
   */
  questsFrom(who: Actor): ActiveQuest[] {
    const npcId = String(who.data["npc"] ?? "");
    const index = who.data["village"] as number | undefined;
    const npc = this.reg.npcs.get(npcId);
    if (!npc || index === undefined) return [];

    const out: ActiveQuest[] = [];
    for (const templateId of npc.quests ?? []) {
      const template = this.reg.quests.get(templateId);
      if (!template) continue;
      const made = makeQuest(
        template, this.questWorld(index), index, who.name,
        this.rng.fork(`quest:${index}:${templateId}`),
      );
      if (!made) continue;
      if (this.questsDone.includes(made.id)) continue;
      if (this.quests.some((q) => q.id === made.id)) continue;
      out.push(made);
    }
    return out;
  }

  /** What the world around a village can supply a quest with. */
  private questWorld(index: number) {
    const village = this.continent.villages[index];
    if (!village) {
      return { localEnemies: [], bosses: [], wanted: [], elsewhere: [], dungeons: [], band: 0 };
    }
    const W = this.continent.level.w;
    const here = this.continent.biome[village.pos.y * W + village.pos.x] ?? "";
    const band = this.continent.region[village.pos.y * W + village.pos.x] ?? 0;

    const localEnemies = [...this.reg.enemies.values()].filter((e) => {
      if (e.boss) return false;
      if (e.biomes?.length && !e.biomes.includes(here) && !e.biomes.includes("dungeon")) return false;
      if ((e.region?.min ?? 0) > band + 1) return false;
      if ((e.region?.max ?? 5) < band) return false;
      return true;
    });

    const bosses = this.continent.lairs
      .filter((l) => !this.bossesKilled.has(l.enemy))
      .map((l) => ({
        def: this.reg.enemies.get(l.enemy)!,
        where: this.biomeName(this.continent.biome[l.pos.y * W + l.pos.x] ?? ""),
      }))
      .filter((b) => !!b.def);

    const wanted = (TRADE[village.trade].wants ?? [])
      .map((id) => this.reg.items.get(id))
      .filter((d): d is ItemDef => !!d);

    const elsewhere = this.continent.villages
      .map((v, i) => ({ index: i, name: v.name }))
      .filter((v) => v.index !== index);

    const dungeons = this.continent.entrances
      .map((e, i) => ({ index: i, name: e.name, d: Math.hypot(e.pos.x - village.pos.x, e.pos.y - village.pos.y) }))
      .filter((e) => e.d < 90)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ index: i, name }) => ({ index: i, name }));

    return { localEnemies, bosses, wanted, elsewhere, dungeons, band };
  }

  /** Take a quest. */
  acceptQuest(q: ActiveQuest): boolean {
    if (this.quests.some((x) => x.id === q.id)) return false;
    this.quests.push({ ...q });
    this.log(`Taken: ${q.ask}`, "good");
    return true;
  }

  /** Give up on one. The standing cost is the point of being able to. */
  abandonQuest(id: string): void {
    const at = this.quests.findIndex((q) => q.id === id);
    if (at < 0) return;
    const [dropped] = this.quests.splice(at, 1);
    if (dropped) {
      this.standing.set(dropped.village, (this.standing.get(dropped.village) ?? 0) - 1);
      this.log(`You give up on: ${dropped.ask}`, "warn");
    }
  }

  /** Hand in everything this villager's village is owed. */
  handIn(who: Actor): number {
    const index = who.data["village"] as number | undefined;
    if (index === undefined) return 0;
    let paid = 0;

    for (const q of [...this.quests]) {
      if (q.village !== index || !isDone(q)) continue;
      this.quests.splice(this.quests.indexOf(q), 1);
      this.questsDone.push(q.id);

      // A gather quest actually takes the goods. The others are already spent.
      if (q.kind === "gather") {
        for (let n = 0; n < q.need; n++) {
          const at = this.pack.indexOf(q.target);
          if (at >= 0) this.pack.splice(at, 1);
        }
      }

      this.coin += q.pay;
      this.standing.set(index, (this.standing.get(index) ?? 0) + q.standing);
      paid += q.pay;

      const template = this.reg.quests.get(q.def);
      const thanks = template?.thanks?.length
        ? template.thanks[this.rng.fork(`thanks:${q.id}`).int(template.thanks.length)]
        : "That is settled.";
      this.log(`${who.name}: "${(thanks ?? "")
        .replace(/\{count\}/g, String(q.need))
        .replace(/\{nth\}/g, ordinal(q.need))}"`, "good");
      this.log(`You are paid ${q.pay} coin.`, "good");

      if (q.reward) {
        this.pack.push(q.reward);
        this.log(`You are given ${this.reg.items.get(q.reward)?.name ?? q.reward}.`, "good");
      }
    }
    return paid;
  }

  /**
   * Tell the quests something happened.
   *
   * Everything that could advance a quest goes through here rather than each
   * system knowing about quests: killing, gathering, arriving somewhere,
   * descending. One function means a new quest kind is a change in one place,
   * and means no system can advance a quest it does not understand.
   */
  private noteProgress(kind: ActiveQuest["kind"], target: string, by = 1): void {
    for (const q of this.quests) {
      if (q.kind !== kind || q.target !== target) continue;
      if (isDone(q)) continue;
      q.done = kind === "delve" ? Math.max(q.done, by) : Math.min(q.need, q.done + by);
      if (isDone(q)) this.log(`Done: ${q.ask} — take it back.`, "good");
    }
  }

  /** How far along every quest is, for the log screen. */
  questLines(): { quest: ActiveQuest; where: string; progress: string; done: boolean }[] {
    return this.quests.map((q) => ({
      quest: q,
      where: this.continent.villages[q.village]?.name ?? "somewhere",
      progress: progressLine(q, (id) =>
        this.reg.enemies.get(id)?.name ?? this.reg.items.get(id)?.name
        ?? this.continent.villages[Number(id)]?.name ?? id),
      done: isDone(q),
    }));
  }

  /**
   * The thing at the bottom of a dungeon.
   *
   * Every dungeon is ten floors and then its keeper, which is what turns a
   * delve into something with an end. Which creature it is depends on the
   * entrance, not on chance, so the same dungeon on the same seed always has the
   * same thing waiting — and the wiki can say what, once you have been told.
   *
   * It is placed on the up-staircase's far side rather than anywhere: a keeper
   * you can be ambushed by before you have found the room is not a boss fight,
   * it is an accident.
   */
  private placeKeeper(depth: number): void {
    if (this.place.kind !== "dungeon") return;
    if (depth < DUNGEON_FLOORS) return;
    const key = `keeper:${this.place.entrance}`;
    if (this.bossesKilled.has(key)) return;

    // Drawn from the hardest creatures in the game, by what they are worth, so
    // a keeper is always something that would be a bad surprise anywhere else.
    const pool = [...this.reg.enemies.values()]
      .filter((e) => !e.boss && (e.xp ?? 0) >= 150)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!pool.length) return;

    const rng = this.rng.fork(`keeper:${this.place.entrance}`);
    const def = pool[rng.int(pool.length)]!;
    const floor = this.floor(this.place.entrance, depth);
    const spot = this.farthestOpenFrom(floor.up);
    if (!spot) return;

    const keeper = this.makeActor(String(def.id), def, spot);
    const dungeon = this.continent.entrances[this.place.entrance];
    keeper.name = `${def.name ?? def.id}, Keeper of ${dungeon?.name ?? "the Deep"}`;
    // A keeper is a bigger version of its kind, not a different creature: it
    // has to be worth ten floors of walking.
    keeper.pools.hpMax = Math.round(keeper.pools.hpMax * 2.5);
    keeper.pools.hp = keeper.pools.hpMax;
    keeper.armour += 4;
    keeper.stats.accuracy += 5;
    keeper.data["keeper"] = key;
    this.actors.push(keeper);
    this.log(`Something very large is awake down here.`, "bad");
  }

  /**
   * The difficulty of a dungeon floor: its entrance's tier plus how deep you are.
   *
   * Clamped to 12 because that is the top of the bands the bestiary is written
   * in; past that there would be nothing new to meet, only the same things with
   * no upper limit to draw from.
   */
  dangerOf(place: Extract<Place, { kind: "dungeon" }>): number {
    const tier = this.continent.entrances[place.entrance]?.depth ?? 1;
    return Math.min(12, tier + place.depth - 1);
  }

  /** The open tile furthest from a point, for putting something at the far end. */
  private farthestOpenFrom(from: Pos): Pos | null {
    const level = this.level;
    let best: Pos | null = null;
    let bestD = -1;
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        if (level.solid(x, y)) continue;
        if (actorAt(this.actors, x, y)) continue;
        const d = Math.hypot(x - from.x, y - from.y);
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  /**
   * Put the world bosses in their lairs.
   *
   * `bossesKilled` is what makes a kill stick: the lair is a property of the
   * seed, so without it the boss would be waiting again every time you left the
   * overworld and came back.
   */
  private placeBosses(): void {
    for (const lair of this.continent.lairs) {
      if (this.bossesKilled.has(lair.enemy)) continue;
      const def = this.reg.enemies.get(lair.enemy);
      if (!def) continue;
      if (actorAt(this.actors, lair.pos.x, lair.pos.y)) continue;
      const boss = this.makeActor(lair.enemy, def, lair.pos);
      boss.name = def.title ?? def.name ?? lair.enemy;
      this.actors.push(boss);
    }
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
      /*
       * Named items are never scattered, and neither are materials.
       *
       * A unique found lying in a field is not a named item, it is an item with
       * a name — the whole point is that something had to be killed for it. And
       * ore on the ground would undercut mining, which is where ore is supposed
       * to come from.
       */
      if (i.unique) return false;
      if (i.slot === "material") return false;
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
      const was = this.deepestIn.get(this.place.entrance) ?? 0;
      if (next > was) this.deepestIn.set(this.place.entrance, next);
      this.noteProgress("delve", String(this.place.entrance), next);
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
  /**
   * Notice that you have arrived somewhere, for delivery quests.
   *
   * Called after every move rather than being hooked into the village tiles,
   * because a delivery should complete when you WALK INTO the village, not when
   * you happen to step on one particular square of it.
   */
  private noteArrival(): void {
    if (this.place.kind !== "overworld") return;
    const here = this.villageHere;
    if (!here) return;
    this.noteProgress("deliver", String(here.index));
  }

  private enterLevel(place: Place, at: Pos): void {
    this.place = place;
    this.player.pos = { ...at };
    // Creatures do not follow between levels, which is NetHack's rule and also
    // what makes stairs a real escape when a fight has gone wrong — except the
    // ones that chose to come with you.
    const companions = this.bringCompanions(this.actors);
    this.actors = [this.player, ...companions];
    for (const c of companions) c.pos = { ...at };
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
  /**
   * What the newly dead left behind.
   *
   * Walked over the actor list rather than the experience ledger, because a
   * drop needs two things the ledger does not carry: which creature it was, and
   * where it fell. `looted` on the actor is what stops a corpse being emptied
   * twice — a dead actor is kept around for a turn so the log reads right, so
   * this runs over it more than once.
   *
   * Each entry is rolled on its own, so a table is a list of independent
   * chances rather than a pick-one: a boss can leave its whole hoard or none of
   * it, and the wiki can state a real percentage per item.
   */
  private dropLoot(): void {
    for (const a of this.actors) {
      if (a.alive || a.isPlayer || a.data["looted"]) continue;
      a.data["looted"] = true;
      const def = this.reg.enemies.get(a.def);

      /*
       * A kill is quest progress, and it is also money.
       *
       * Both go through here rather than through the combat code, because this
       * is the one place that runs exactly once per corpse — the combat code
       * runs once per blow, and a bounty that counted blows would be finished by
       * hitting one goblin eight times.
       */
      this.noteProgress("bounty", a.def);
      if (def?.boss) this.noteProgress("slay", a.def);
      const purse = Math.round((def?.xp ?? 0) * 0.5);
      if (purse > 0) {
        this.coin += purse;
        if (purse >= 40) this.log(`You find ${purse} coin on it.`, "good");
      }
      const table = def?.drops ?? [];
      if (!table.length) continue;

      // Forked per corpse, so what a creature drops cannot be rerolled by
      // reloading and killing it in a different order.
      const rng = this.rng.fork(`drop:${a.id}`);
      const got: string[] = [];
      for (const entry of table) {
        if (rng.next() >= entry.chance) continue;
        if (!this.reg.items.has(entry.item)) continue;
        got.push(entry.item);
      }
      if (!got.length) continue;

      const key = `${this.levelKey}:${this.level.idx(a.pos.x, a.pos.y)}`;
      const pile = this.loot.get(key) ?? [];
      pile.push(...got);
      this.loot.set(key, pile);

      const names = got.map((id) => this.reg.items.get(id)?.name ?? id);
      if (def?.boss) this.log(`${a.name} falls, leaving ${names.join(" and ")}.`, "good");
      else this.log(`It drops ${names.join(" and ")}.`, "good");
    }

    // A boss stays dead: its lair is part of the seed, so without this it would
    // be waiting again the next time you came back to the overworld.
    for (const a of this.actors) {
      if (a.alive || a.isPlayer) continue;
      if (this.reg.enemies.get(a.def)?.boss) this.bossesKilled.add(a.def);
      const keeper = a.data["keeper"];
      if (typeof keeper === "string") {
        this.bossesKilled.add(keeper);
        this.log("The dungeon is quiet. Whatever held it is gone.", "good");
      }
    }
  }

  private awardXp(): void {
    this.dropLoot();
    let gained = 0;
    const alive = new Set(this.actors.filter((a) => a.alive).map((a) => a.id));
    for (const [id, worth] of this.deadXp) {
      if (!alive.has(id)) gained += worth;
    }
    this.rememberWorth();
    this.xp += gained;
    this.checkLevel();
  }

  /**
   * Spend any experience that has earned a level.
   *
   * Split out from `awardXp` because it used to return early when no creature
   * had died this turn, which meant experience arriving from anywhere else —
   * the console, a test, a script, anything a mod might do — raised the number
   * on the HUD and never levelled anybody up. Two of the tests were quietly
   * skipping themselves because of it.
   *
   * Safe to call every turn: when nothing has changed the loop does not run.
   */
  private checkLevel(): void {
    const now = levelForXp(this.xp);
    while (this.playerLevel < now) {
      /*
       * One level at a time, and stop at an unspent choice.
       *
       * Earning several levels in one kill used to run this loop straight
       * through, and each pass overwrote the last one's `pendingChoices` — so
       * four of the five choices were silently thrown away and the player got
       * one. `chooseUpgrade` calls back in here, so the levels arrive in order
       * with a decision each.
       */
      if (this.pendingChoices) return;
      this.playerLevel++;
      this.raisePoolBase("hp", PER_LEVEL.hpMax);
      this.raisePoolBase("stamina", PER_LEVEL.staminaMax);
      this.raisePoolBase("mana", PER_LEVEL.manaMax);
      this.player.clampPools();
      this.log(`You reach level ${this.playerLevel}.`, "good");
      this.attributePoints += POINTS_PER_LEVEL;
      this.pendingMilestone = isMilestone(this.playerLevel);
      this.rerollsLeft = 1;
      this.pendingChoices = this.rollFor(this.playerLevel, 0);
      if (this.pendingMilestone) this.log("A milestone. These are the big ones.", "good");
    }
  }

  /** Take one of the five. */
  chooseUpgrade(index: number): boolean {
    const offered = this.pendingChoices;
    if (!offered) return false;
    const pick = offered[index];
    if (!pick) return false;
    this.log(
      applyChoice(this.player, pick, this.reg.upgrades as Map<string, UpgradeDef>, this.perks),
      "good");
    // A talent is once only, so remember it: the next milestone must not offer
    // Beastfriend again to someone who already has it.
    if (pick.kind === "upgrade" && this.reg.upgrades.get(pick.id)?.talent) {
      this.talentsTaken.push(pick.id);
    }
    this.pendingChoices = null;
    this.pendingMilestone = false;
    this.rerollsLeft = 0;
    // Perks can change the player's body, so re-apply what is worn on top of
    // the new baseline rather than leaving the two out of step.
    this.refreshGear();
    // There may be another level waiting behind this one.
    this.checkLevel();
    return true;
  }

  /**
   * The roll for a level. `attempt` is how many rerolls have been spent.
   *
   * Forked by level AND attempt, so the first roll of a level is the same every
   * time you reach it — which is what stops the roll being save-scummed — while a
   * reroll is genuinely a different hand rather than the same one again.
   */
  private rollFor(level: number, attempt: number): Choice[] {
    // A milestone excludes the talents already taken; an ordinary level
    // excludes the spells already known. Both go through `known`.
    const known = isMilestone(level) ? this.talentsTaken : this.player.spells;
    return rollChoices(
      level,
      known,
      this.reg.spells as Map<string, SpellDef>,
      this.reg.upgrades as Map<string, UpgradeDef>,
      this.rng.fork(`level:${level}:${attempt}`),
    );
  }

  /**
   * Raise a pool's recorded base, and the pool with it.
   *
   * The base has to move as well as the pool. Equipment recomputes every
   * maximum from `base + whatever the attributes are worth`, so a level-up that
   * only touched `pools.hpMax` had its gains silently wiped the next time
   * anything was worn or an attribute was raised — which showed up as a point of
   * Endurance appearing to give no health at all, because it was replacing the
   * level's six rather than adding to it.
   */
  private raisePoolBase(which: "hp" | "stamina" | "mana", by: number): void {
    const key = which === "hp" ? "poolHp" : which === "stamina" ? "poolStamina" : "poolMana";
    const maxKey = which === "hp" ? "hpMax" : which === "stamina" ? "staminaMax" : "manaMax";
    this.player.data[key] = ((this.player.data[key] as number) ?? this.player.pools[maxKey]) + by;
    this.player.pools[maxKey] += by;
    this.player.pools[which] += by;
  }

  /**
   * Put a banked point into an attribute.
   *
   * Does not cost a turn and cannot be undone. Irreversible because the whole
   * value of a character build is that it was chosen: a respec button turns six
   * attributes into one slider that is always set to whatever the current fight
   * wants.
   */
  raiseAttribute(which: AttributeId): boolean {
    if (this.attributePoints <= 0) return false;
    const now = this.player.baseAttributes[which];
    const next = clampAttribute(now + 1);
    if (next === now) {
      this.log(`Your ${which} is as high as it goes.`, "warn");
      return false;
    }
    this.attributePoints--;
    this.player.baseAttributes[which] = next;
    // Re-derive everything: pools, evasion, speed and the weapon numbers all
    // hang off this.
    this.refreshGear();
    this.log(`${which.charAt(0).toUpperCase()}${which.slice(1)} is now ${next}.`, "good");
    return true;
  }

  /** Spend the reroll. False when there is none left or nothing is pending. */
  reroll(): boolean {
    if (!this.pendingChoices || this.rerollsLeft <= 0) return false;
    this.rerollsLeft--;
    this.pendingChoices = this.rollFor(this.playerLevel, 1);
    this.log("You think again.", "plain");
    return true;
  }

  /**
   * Level, and how far into the next one.
   *
   * Reported from `playerLevel` rather than from the experience total, because
   * the two come apart whenever levels are queued: with five levels earned and
   * one spent, the raw total says 6 and the character is still a 2. The screen
   * that says "Level 6" while handing out level 2's choice is lying, and with a
   * debug-sized pile of experience it said "Level 99".
   */
  get progress(): { level: number; into: number; need: number } {
    const base = xpForLevel(this.playerLevel);
    const next = xpForLevel(this.playerLevel + 1);
    return {
      level: this.playerLevel,
      into: Math.max(0, Math.min(next - base, this.xp - base)),
      need: Math.max(1, next - base),
    };
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
    const held = this.worn.weapon ? this.reg.items.get(this.worn.weapon) : undefined;
    if (!held || !load.weapon) {
      /*
       * Bare hands are still a weapon class, so Agility and unarmed practice
       * both count. Without this, punching was the one attack in the game that
       * ignored the entire weapon system.
       */
      const fists = weaponStats({ id: "punch", name: "Punch", damage: punch.damage } as ItemDef);
      return {
        ...punch,
        damage: damageWith(fists, this.player.attributes, this.skillIn("unarmed")),
        range: 1,
        cost: 1,
      };
    }

    /*
     * A wielded weapon becomes the attack you make by walking into things.
     *
     * Built here rather than stored as a content file, because it is the
     * COMBINATION of a weapon, the hand that swings it and the practice behind
     * it: the stamina cost stays the hand's, while the damage, the reach, the
     * accuracy and the time it takes all come from the steel and the arm.
     */
    const stats = weaponStats(held, this.instanceOf(this.worn.weapon!));
    const skill = this.skillIn(stats.class);
    return {
      ...punch,
      id: `weapon:${stats.class}`,
      name: stats.name,
      damage: damageWith(stats, this.player.attributes, skill),
      kind: load.weapon.kind,
      range: stats.reach,
      cost: swingCost(stats, this.player.attributes),
      applies: load.applies.length ? load.applies : undefined,
      say: "{caster} strike{s} {target} with the " + stats.name.toLowerCase() + ".",
    };
  }

  /**
   * Weapon practice, per class.
   *
   * One skill per class rather than one for all melee, so that picking up an axe
   * after fifty levels of swordplay genuinely means starting again. That is the
   * thing that makes a weapon choice a commitment instead of an inventory sort.
   */
  weaponSkills: Record<string, number> = {};

  skillIn(cls: string): number {
    return this.weaponSkills[cls] ?? 0;
  }

  /**
   * Any skill by its full id, whichever table it lives in.
   *
   * Weapon practice, trades and crafts are three separate records because they
   * are advanced by three different things, but a trainer does not care which —
   * so this is the one lookup that sees all of them.
   */
  skillLevel(skill: string): number {
    if (skill.startsWith("weapon-")) return this.skillIn(skill.slice(7));
    if (skill in this.skills) return this.skills[skill as keyof typeof this.skills];
    if (skill in this.crafts) return this.crafts[skill as keyof typeof this.crafts];
    if (skill === "taming") return this.tameSkill;
    return 0;
  }

  /** Practice at talking creatures round. Raised by trying, and by training. */
  tameSkill = 0;

  /**
   * Pay somebody to teach you something.
   *
   * The price rises with what you already have, so training is a way to start a
   * weapon rather than a way to finish one: the last points always have to be
   * earned by using it. Otherwise coin would substitute for play entirely, and
   * the trade economy would quietly become the whole game.
   */
  train(skill: string, price: number): boolean {
    if (this.coin < price) { this.log("You cannot afford that.", "warn"); return false; }
    this.coin -= price;
    if (skill.startsWith("weapon-")) {
      const cls = skill.slice(7);
      this.weaponSkills[cls] = (this.weaponSkills[cls] ?? 0) + 1;
    } else if (skill in this.skills) {
      this.skills[skill as keyof typeof this.skills]++;
    } else if (skill in this.crafts) {
      this.crafts[skill as keyof typeof this.crafts]++;
    } else if (skill === "taming") {
      this.tameSkill++;
    } else {
      // Refund rather than silently pocket the coin: a skill the game does not
      // have is a content bug, and the player should not pay for it.
      this.coin += price;
      this.log(`Nobody here knows anything about ${skill}.`, "warn");
      return false;
    }
    this.log(`You practise. Your ${skill.replace("weapon-", "")} is now ${this.skillLevel(skill)}.`, "good");
    this.finishTurn({ tookTurn: true });
    return true;
  }

  /**
   * Instance data for a specific item in the pack or worn.
   *
   * Two Iron Axes are the same content file and may not be the same object: one
   * of them might be masterwork. This is where that difference lives, keyed by
   * the item id — which means one entry per KIND of item rather than per copy,
   * and so an item with instance data does not stack.
   */
  instances = new Map<string, ItemInstance>();

  instanceOf(itemId: string): ItemInstance | undefined {
    return this.instances.get(itemId);
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
      this.noteProgress("gather", id);
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

  /**
   * Write the run down.
   *
   * Only what the player changed; the world comes back out of the seed. See
   * src/engine/save.ts for why.
   */
  toSave(): SaveFile {
    const explored: [string, number[]][] = [["o", encodeRuns(this.continent.level.known)]];
    for (const [key, floor] of this.floors) explored.push([`d${key}`, encodeRuns(floor.level.known)]);

    const species = this.reg.species.get(this.speciesId)?.name ?? this.speciesId;
    const bg = this.reg.classes.get(this.classId)?.name ?? this.classId;

    return {
      version: SAVE_VERSION,
      at: Date.now(),
      label: `${species} ${bg}, level ${this.playerLevel} — ${this.level.name}`,
      seed: this.seed,
      speciesId: this.speciesId,
      classId: this.classId,
      place: this.place,
      turn: this.turn,
      xp: this.xp,
      playerLevel: this.playerLevel,
      pack: [...this.pack],
      worn: { ...this.worn },
      loot: [...this.loot].map(([k, v]) => [k, [...v]] as [string, string[]]),
      cooldowns: [...this.cooldowns],
      deadXp: [...this.deadXp],
      bossesKilled: [...this.bossesKilled],
      perks: { ...this.perks },
      talentsTaken: [...this.talentsTaken],
      attributePoints: this.attributePoints,
      weaponSkills: { ...this.weaponSkills },
      coin: this.coin,
      tameSkill: this.tameSkill,
      markets: [...this.markets].map(([k, m]) => [k, { ...m, stock: { ...m.stock } }] as [number, Market]),
      standing: [...this.standing],
      quests: this.quests.map((q) => ({ ...q })),
      questsDone: [...this.questsDone],
      deepestIn: [...this.deepestIn],
      instances: [...this.instances].map(([k, v]) => [k, { ...v }] as [string, ItemInstance]),
      party: [...this.party],
      skills: { ...this.skills },
      crafts: { ...this.crafts },
      actors: this.actors.map((a) => a.toSave()),
      nextId: this.nextId,
      messages: this.messages.slice(-60),
      over: this.over,
      explored,
    };
  }

  /**
   * Put a saved run back.
   *
   * Call this on a game constructed with the save's own seed — `loadGame`
   * below does that — so the continent is already the right one and only the
   * mutable state has to be laid over it. Any dungeon floor mentioned by the
   * save is regenerated here rather than lazily, so that its explored map has
   * something to be written onto.
   */
  restore(save: SaveFile): void {
    this.speciesId = save.speciesId;
    this.classId = save.classId;
    this.place = save.place as Place;
    this.turn = save.turn;
    this.xp = save.xp;
    this.playerLevel = save.playerLevel;
    this.pack = [...save.pack];
    this.worn = { ...save.worn } as Worn;
    this.loot = new Map(save.loot.map(([k, v]) => [k, [...v]]));
    this.cooldowns = new Map(save.cooldowns);
    this.deadXp = new Map(save.deadXp);
    this.bossesKilled = new Set(save.bossesKilled ?? []);
    // Everything below may be absent in a file written before it existed, so
    // each falls back to a fresh value rather than leaving the field undefined.
    this.perks = { ...newPerks(), ...(save.perks ?? {}) };
    this.talentsTaken = [...(save.talentsTaken ?? [])];
    this.attributePoints = save.attributePoints ?? 0;
    this.weaponSkills = { ...(save.weaponSkills ?? {}) };
    this.coin = save.coin ?? 0;
    this.tameSkill = save.tameSkill ?? 0;
    this.markets = new Map((save.markets ?? []) as [number, Market][]);
    this.standing = new Map((save.standing ?? []) as [number, number][]);
    this.quests = (save.quests ?? []) as ActiveQuest[];
    this.questsDone = [...(save.questsDone ?? [])];
    this.deepestIn = new Map((save.deepestIn ?? []) as [number, number][]);
    this.instances = new Map((save.instances ?? []) as [string, ItemInstance][]);
    this.party = [...(save.party ?? [])];
    if (save.skills) this.skills = { ...this.skills, ...save.skills };
    if (save.crafts) this.crafts = { ...this.crafts, ...save.crafts };
    this.nextId = save.nextId;
    this.messages = save.messages as Message[];
    this.over = save.over as Game["over"];

    this.actors = (save.actors as ActorSave[]).map((a) => Actor.fromSave(a));
    const player = this.actors.find((a) => a.isPlayer);
    if (!player) throw new Error("this save has no player in it");
    this.player = player;

    for (const [key, runs] of save.explored) {
      // "o" is the overworld; "d<entrance>:<depth>" is a dungeon floor, which
      // has to be generated before there is a map to mark as explored.
      const level = key === "o"
        ? this.continent.level
        : (() => {
            const [entrance, depth] = key.slice(1).split(":").map(Number);
            return this.floor(entrance ?? 0, depth ?? 1).level;
          })();
      level.known.set(decodeRuns(runs, level.known.length));
    }

    this.refreshFov();
  }

  refreshFov(): void {
    computeFov(this.level, this.player.pos, this.sight);
  }

  /** Walk, or attack whatever is in the way. */
  move(dx: number, dy: number): void {
    if (this.over || this.pendingChoices) return;
    // Whatever is in your hand, or your fist if it is empty.
    const attack = this.weaponAbility;
    const res = moveOrAttack(this.actionCtx, this.player, dx, dy, attack);
    if (res.tookTurn) this.noteArrival();
    // Walking into something is a swing, so it counts as practice too.
    if (res.tookTurn && this.actorAt(this.player.pos.x + dx, this.player.pos.y + dy)) {
      this.practise(this.heldClass);
    }
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
  /**
   * Practice: swinging a weapon makes you better with that weapon.
   *
   * Only on a real swing at a real target, and only for the player — a goblin
   * does not need a skill table. The curve is deliberately slow and uncapped
   * rather than fast and capped, because the point is that a weapon you have
   * used all run is better in your hands than a better weapon you just picked
   * up, and that has to stay true at level 30.
   */
  private practise(cls: string): void {
    this.weaponSkills[cls] = (this.weaponSkills[cls] ?? 0) + 1;
    const skill = this.weaponSkills[cls]!;
    // Milestones are worth saying out loud; every single swing is not.
    if (skill % 25 === 0) {
      this.log(`Your ${WEAPON_CLASS[cls as keyof typeof WEAPON_CLASS]?.name.toLowerCase() ?? cls} work is improving.`, "good");
    }
  }

  /** The class of whatever is in hand, for practice and for the sheet. */
  get heldClass(): string {
    const held = this.worn.weapon ? this.reg.items.get(this.worn.weapon) : undefined;
    return held ? classOf(held) : "unarmed";
  }

  ability(id: string, target?: Actor): void {
    if (this.over || this.pendingChoices) return;
    const def = this.reg.abilities.get(id);
    if (!def) { this.log(`There is no ability "${id}".`, "warn"); return; }
    /*
     * Punching with a weapon in hand swings the weapon.
     *
     * "punch" is what the keyboard and the right-click menu both send for a
     * plain attack, so this is where a held weapon takes over — otherwise a
     * character with a masterwork blade would attack for 5 damage because they
     * pressed the attack key.
     */
    const use = id === "punch" ? this.weaponAbility : def;
    const victim = target ?? this.nearestHostile(use.range ?? 1);
    if (!victim) { this.log("Nothing within reach.", "warn"); return; }
    const result = useAbility(this.actionCtx, this.player, use, victim);
    if (result.tookTurn && id === "punch") this.practise(this.heldClass);
    this.finishTurn(result);
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


  // --- gathering ----------------------------------------------------------

  /**
   * Work in progress on a tile, so a four-turn dig is four turns.
   *
   * Keyed by level and tile, not by the player, so walking away and coming back
   * resumes rather than restarting — and so two different seams each remember
   * their own progress.
   */
  private digging = new Map<string, number>();

  /** Skill in each trade, which is what makes the work faster and luckier. */
  skills: Record<"mining" | "woodcutting" | "foraging", number> = {
    mining: 0, woodcutting: 0, foraging: 0,
  };

  /** Can anything be got out of this tile? */
  harvestable(x: number, y: number): boolean {
    return !!this.level.at(x, y)?.id && !!this.reg.tiles.get(this.level.at(x, y)!.id)?.harvest;
  }

  /** The verb for the menu: "Mine the ore vein", "Fell the tree". */
  harvestLabel(x: number, y: number): string {
    const tile = this.level.at(x, y);
    const h = tile && this.reg.tiles.get(tile.id)?.harvest;
    if (!h || !tile) return "";
    const verb = h.skill === "mining" ? "Mine" : h.skill === "woodcutting" ? "Fell" : "Gather";
    const tool = h.tool ? this.reg.items.get(h.tool)?.name : undefined;
    const have = h.tool ? this.hasTool(h.tool) : true;
    return `${verb} the ${tile.name.toLowerCase()}${have || !tool ? "" : ` (slow without a ${tool.toLowerCase()})`}`;
  }

  /** Is the right tool to hand — worn or in the pack? */
  private hasTool(itemId: string): boolean {
    if (Object.values(this.worn).includes(itemId)) return true;
    return this.pack.includes(itemId);
  }

  /**
   * One turn of work on a tile.
   *
   * Returns once the tile is used up. Each call is a full turn — the world moves
   * while you are busy, which is the point: mining in the open is a decision,
   * not a free action, and something can walk up behind you while you do it.
   */
  harvest(x: number, y: number): void {
    if (this.over || this.pendingChoices) return;
    const tile = this.level.at(x, y);
    const h = tile && this.reg.tiles.get(tile.id)?.harvest;
    if (!h || !tile) { this.log("There is nothing to take from there.", "warn"); return; }
    if (distance({ x, y }, this.player.pos) > 1.5) { this.log("That is out of reach.", "warn"); return; }

    const withTool = h.tool ? this.hasTool(h.tool) : true;
    const key = `${this.levelKey}:${this.level.idx(x, y)}`;
    // Skill and the right tool both shorten the job; bare hands double it.
    const skill = this.skills[h.skill];
    const need = Math.max(1, Math.round(
      (h.turns ?? 2) * (withTool ? 1 : 2) - Math.floor(skill / 4) + this.perks.gatherSpeed));
    const done = (this.digging.get(key) ?? 0) + 1;

    if (done < need) {
      this.digging.set(key, done);
      this.log(`You work at the ${tile.name.toLowerCase()}. (${done}/${need})`, "plain");
      this.finishTurn({ tookTurn: true });
      return;
    }

    this.digging.delete(key);
    const rng = this.rng.fork(`harvest:${key}:${this.turn}`);
    const got: string[] = [];
    for (const y2 of h.yields) {
      // Skill improves the odds on the rarer entries without ever exceeding
      // certainty, so a maxed trade finds gemstones often but not always.
      const chance = Math.min(1, y2.chance * (1 + skill / 50 + this.perks.gatherLuck));
      if (rng.next() >= chance) continue;
      for (let n = 0; n < (y2.amount ?? 1); n++) got.push(y2.item);
    }
    for (const id of got) {
      this.pack.push(id);
      this.noteProgress("gather", id);
    }

    // What it leaves: whatever its file says, or else the ground it stood on.
    const becomes = h.becomes;
    const i = this.level.idx(x, y);
    if (becomes) {
      const def = this.reg.tiles.get(becomes);
      if (def) {
        const kind = this.level.kindIndex({
          id: becomes, name: def.name ?? becomes, solid: def.solid ?? false,
          opaque: def.opaque ?? false, sprite: def.sprite ?? becomes, cost: def.cost, on: def.on,
        });
        this.level.set(x, y, kind, kind);
      }
    } else {
      this.level.set(x, y, this.level.floor[i]!, this.level.floor[i]!);
    }

    this.skills[h.skill]++;
    const names = got.length
      ? got.map((id) => this.reg.items.get(id)?.name ?? id).join(", ")
      : "nothing worth keeping";
    this.log(`The ${tile.name.toLowerCase()} gives up ${names}.`, got.length ? "good" : "warn");
    this.refreshFov();
    this.finishTurn({ tookTurn: true });
  }

  // --- crafting -----------------------------------------------------------

  /** Skill in each trade. Crafting trains it; skill shortens the work. */
  crafts: Record<"smithing" | "cooking" | "alchemy" | "woodwork", number> = {
    smithing: 0, cooking: 0, alchemy: 0, woodwork: 0,
  };

  /**
   * Which stations are within arm's reach, including the one you are on.
   *
   * Reach rather than "standing on", because a forge is solid: you cannot stand
   * on an anvil, so requiring it would mean no recipe was ever available.
   */
  get stationsInReach(): Set<string> {
    const found = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.level.at(this.player.pos.x + dx, this.player.pos.y + dy);
        const station = t && this.reg.tiles.get(t.id)?.station;
        if (station) found.add(station);
      }
    }
    return found;
  }

  /** How many of an item are in the pack. */
  countOf(itemId: string): number {
    return this.pack.filter((i) => i === itemId).length;
  }

  /** Everything you could make right now, and why you cannot make the rest. */
  recipesHere(): { id: string; name: string; can: boolean; why: string; craft: string; station: string }[] {
    const stations = this.stationsInReach;
    return [...this.reg.recipes.values()].map((r) => {
      const id = String(r.id);
      const short: string[] = [];
      for (const n of r.needs ?? []) {
        const have = this.countOf(n.item);
        const want = n.amount ?? 1;
        if (have < want) short.push(`${want - have}× ${this.reg.items.get(n.item)?.name ?? n.item}`);
      }
      const hasStation = stations.has(r.station);
      return {
        id, name: r.name ?? id, craft: r.craft, station: r.station,
        can: hasStation && !short.length,
        why: !hasStation ? `needs a ${r.station}` : short.length ? `short ${short.join(", ")}` : "ready",
      };
    });
  }

  /**
   * Make something.
   *
   * Materials come out of the pack before the result goes in, so a failed
   * precondition cannot leave you having paid for nothing. Each craft takes its
   * turns in one go rather than one per call — you are standing at a forge, not
   * holding off a wolf — but the world does still move, so a camp is not a safe
   * room.
   */
  craft(recipeId: string): void {
    if (this.over || this.pendingChoices) return;
    const r = this.reg.recipes.get(recipeId);
    if (!r) { this.log("You do not know that one.", "warn"); return; }
    if (!this.stationsInReach.has(r.station)) {
      this.log(`You need to be at a ${r.station} for that.`, "warn");
      return;
    }
    for (const n of r.needs ?? []) {
      if (this.countOf(n.item) < (n.amount ?? 1)) {
        this.log(`Not enough ${this.reg.items.get(n.item)?.name ?? n.item}.`, "warn");
        return;
      }
    }

    for (const n of r.needs ?? []) {
      for (let k = 0; k < (n.amount ?? 1); k++) this.pack.splice(this.pack.indexOf(n.item), 1);
    }
    const madeCount = r.makes.amount ?? 1;
    for (let k = 0; k < madeCount; k++) {
      this.pack.push(r.makes.item);
      // Making the thing counts: an order for ten ingots does not care whether
      // you dug them up or smelted them.
      this.noteProgress("gather", r.makes.item);
    }
    this.crafts[r.craft]++;

    const name = this.reg.items.get(r.makes.item)?.name ?? r.makes.item;
    this.log(`You make ${madeCount > 1 ? `${madeCount} × ${name}` : name}.`, "good");

    // Skill shortens the job, to a floor of one turn.
    const turns = Math.max(1,
      (r.turns ?? 2) - Math.floor(this.crafts[r.craft] / 5) + this.perks.craftSpeed);
    for (let t = 0; t < turns; t++) {
      if (this.over) break;
      this.finishTurn({ tookTurn: true });
    }
  }

  // --- taming and followers -----------------------------------------------

  /** How many companions you may keep, talents included. */
  get partyLimit(): number {
    return PARTY_LIMIT + this.perks.party;
  }

  /** Could this creature be talked round at all? */
  canTame(who: Actor): boolean {
    if (who.isPlayer || !who.alive) return false;
    if (who.stance === "friendly") return false;
    if (this.party.length >= this.partyLimit) return false;
    return !!this.reg.enemies.get(who.def)?.tameable;
  }

  /** The odds, in words, for the menu. */
  tameOdds(who: Actor): string {
    const t = this.reg.enemies.get(who.def)?.tameable;
    if (!t) return "";
    const chance = this.tameChance(who);
    const food = (t.food ?? []).filter((f) => this.pack.includes(f));
    const hurt = who.pools.hp < who.pools.hpMax / 2;
    const notes = [
      `${Math.round(chance * 100)}%`,
      food.length ? `offering ${this.reg.items.get(food[0]!)?.name ?? food[0]}` : "nothing to offer it",
      hurt ? "and it is hurt, which helps" : "",
    ].filter(Boolean);
    return notes.join(" · ");
  }

  /**
   * How likely taming is, and why.
   *
   * Three things move it: the creature's own base willingness, whether you are
   * holding something it wants, and whether it is in a state to argue. A hurt
   * creature is easier, which gives the system a tactic — beat it down, then
   * offer it lunch — rather than being a dice roll you spam.
   */
  private tameChance(who: Actor): number {
    const t = this.reg.enemies.get(who.def)?.tameable;
    if (!t) return 0;
    let chance = t.chance;
    chance += this.perks.tame;
    chance += this.tameSkill * 0.02;
    chance += this.player.derived.tameBonus;
    if ((t.food ?? []).some((f) => this.pack.includes(f))) chance += 0.3;
    if (who.pools.hp < who.pools.hpMax / 2) chance += 0.2;
    if (who.pools.hp < who.pools.hpMax / 5) chance += 0.2;
    return Math.max(0.02, Math.min(0.95, chance));
  }

  /** Try to tame something. Costs a turn whether or not it works. */
  tame(who: Actor): void {
    if (this.over || this.pendingChoices) return;
    if (!this.canTame(who)) {
      this.log(this.party.length >= this.partyLimit
        ? "You already have as many companions as you can keep track of."
        : `${who.name} is not interested in you.`, "warn");
      return;
    }
    if (distance(who.pos, this.player.pos) > 1.5) { this.log("You need to be next to it.", "warn"); return; }

    const t = this.reg.enemies.get(who.def)!.tameable!;
    const offered = (t.food ?? []).find((f) => this.pack.includes(f));
    if (offered) this.pack.splice(this.pack.indexOf(offered), 1);

    const rng = this.rng.fork(`tame:${who.id}:${this.turn}`);
    if (rng.next() < this.tameChance(who)) {
      who.stance = "friendly";
      who.data["companion"] = true;
      this.party.push(who.id);
      this.log(`${who.name} decides you are worth following.`, "good");
    } else {
      // A refusal is not free: it knows what you tried.
      who.stance = "hostile";
      this.log(offered
        ? `${who.name} takes the ${this.reg.items.get(offered)?.name ?? offered} and stays unconvinced.`
        : `${who.name} will not have it.`, "warn");
    }
    this.finishTurn({ tookTurn: true });
  }

  /** Say something to a creature that is not trying to kill you. */
  talk(who: Actor): void {
    const def = this.reg.enemies.get(who.def);
    const lines = def?.says ?? [];
    if (!lines.length) { this.log(`${who.name} has nothing to say to you.`, "plain"); return; }
    const rng = this.rng.fork(`talk:${who.id}:${this.turn}`);
    this.log(`${who.name}: "${lines[rng.int(lines.length)]}"`, "plain");
  }

  /**
   * Companions come with you through stairs. Everything else does not.
   *
   * Called from `enterLevel`, which otherwise drops the whole actor list — and
   * dropping your pet down a staircase and never seeing it again would be a
   * cruel way to find out the system exists.
   */
  private bringCompanions(from: Actor[]): Actor[] {
    return from.filter((a) => !a.isPlayer && a.alive && a.data["companion"]);
  }

  // --- walking somewhere ---------------------------------------------------

  /**
   * A route the player is following, one step per `stepTravel`.
   *
   * Travel is not a single action: each step is a real turn, so the world moves
   * and anything can interrupt. What the UI does is call `stepTravel` on a timer
   * and stop when it returns false.
   */
  travelPath: Pos[] = [];

  /** Start walking to a square. Returns whether there is a way there. */
  travelTo(x: number, y: number): boolean {
    const path = findPath(this.level, this.player.pos, { x, y }, {
      blocked: (bx, by) => {
        const who = this.actorAt(bx, by);
        return !!who && who.alive && !who.isPlayer;
      },
      // Walking "to" something solid or occupied means walking up to it.
      adjacent: this.level.solid(x, y) || !!this.actorAt(x, y),
    });
    this.travelPath = path;
    if (!path.length) {
      this.log("You cannot see a way there.", "warn");
      return false;
    }
    return true;
  }

  /**
   * Take one step of a journey. False when the journey is over or interrupted.
   *
   * Stops for anything that would make a person look up: a hostile creature
   * coming into view, taking a hit, a level-up waiting to be spent, or the next
   * square no longer being walkable because something moved into it.
   */
  stepTravel(): boolean {
    if (!this.travelPath.length || this.over || this.pendingChoices) { this.travelPath = []; return false; }
    if (this.visibleThreat()) {
      this.travelPath = [];
      this.log("You stop.", "warn");
      return false;
    }
    const next = this.travelPath[0]!;
    const who = this.actorAt(next.x, next.y);
    if (this.level.solid(next.x, next.y) || (who && !who.isPlayer)) { this.travelPath = []; return false; }

    const hpBefore = this.player.pools.hp;
    this.travelPath.shift();
    this.move(next.x - this.player.pos.x, next.y - this.player.pos.y);
    if (this.player.pools.hp < hpBefore) { this.travelPath = []; return false; }
    return this.travelPath.length > 0;
  }

  /** Anything hostile that can currently see you back. */
  private visibleThreat(): Actor | undefined {
    return this.actors.find((a) =>
      a.alive && !a.isPlayer && a.stance === "hostile" &&
      !!this.level.visible[this.level.idx(a.pos.x, a.pos.y)]);
  }

  /** What is standing on a tile, for the look command and for the renderer. */
  actorAt(x: number, y: number): Actor | undefined {
    return actorAt(this.actors, x, y);
  }

  // --- villages ------------------------------------------------------------

  /** The village whose square you are standing in, if any. */
  get villageHere(): { index: number; village: Village } | null {
    return this.villageNear(this.player.pos.x, this.player.pos.y, 6);
  }

  /** The village near a point, if any. */
  villageNear(x: number, y: number, within = 6): { index: number; village: Village } | null {
    let best: { index: number; village: Village } | null = null;
    let bestD = within + 1;
    this.continent.villages.forEach((village, index) => {
      const d = Math.hypot(village.pos.x - x, village.pos.y - y);
      if (d < bestD) { bestD = d; best = { index, village }; }
    });
    return best;
  }

  /** The market for a village, made on first use. */
  marketOf(index: number): Market {
    const had = this.markets.get(index);
    if (had) return had;
    const village = this.continent.villages[index];
    const made = newMarket(village?.trade ?? "market", village?.depth ?? 12, this.turn);
    this.markets.set(index, made);
    return made;
  }

  /**
   * How much better a price you get, as a fraction.
   *
   * Cunning and Presence, plus standing with this particular village. Standing
   * is capped well below the point where it would close the spread, because a
   * village that likes you enough to let you buy and sell at the same price is a
   * village you can print money at.
   */
  haggleAt(index: number): number {
    const d = this.player.derived;
    const liked = Math.min(0.08, (this.standing.get(index) ?? 0) * 0.004);
    return d.haggle + liked;
  }

  /** Everything a village will deal in, priced. */
  stallAt(index: number): Quote[] {
    const extra = this.villagersOf(index)
      .flatMap((a) => this.reg.npcs.get(String(a.data["npc"]))?.deals ?? []);
    return stall(
      this.marketOf(index), this.reg.items as Map<string, ItemDef>, extra,
      this.turn, this.haggleAt(index));
  }

  /** The villagers currently standing in a village. */
  villagersOf(index: number): Actor[] {
    return this.actors.filter((a) => a.alive && a.data["village"] === index && a.data["npc"]);
  }

  /**
   * Buy one of something.
   *
   * Takes a turn, because standing at a stall is standing somewhere — and
   * because a free action would let you buy a village out of ore without the
   * world noticing.
   */
  buy(index: number, itemId: string): boolean {
    const def = this.reg.items.get(itemId);
    if (!def) return false;
    const q = quote(this.marketOf(index), def, this.turn, this.haggleAt(index));
    if (this.coin < q.buy) {
      this.log(`You cannot afford ${def.name} (${q.buy} coin).`, "warn");
      return false;
    }
    this.coin -= q.buy;
    this.pack.push(itemId);
    trade(this.marketOf(index), itemId, -1, this.turn);
    this.log(`You buy ${def.name} for ${q.buy}.`, "plain");
    this.finishTurn({ tookTurn: true });
    return true;
  }

  /** Sell one of something. */
  sell(index: number, itemId: string): boolean {
    const def = this.reg.items.get(itemId);
    if (!def) return false;
    const at = this.pack.indexOf(itemId);
    if (at < 0) { this.log(`You are not carrying any ${def.name}.`, "warn"); return false; }
    const q = quote(this.marketOf(index), def, this.turn, this.haggleAt(index));
    this.pack.splice(at, 1);
    this.coin += q.sell;
    trade(this.marketOf(index), itemId, 1, this.turn);
    this.log(`You sell ${def.name} for ${q.sell}.`, "good");
    this.finishTurn({ tookTurn: true });
    return true;
  }

  /**
   * Sell everything of one kind at once.
   *
   * Each one is priced as it goes, so a stack sells at a falling price rather
   * than all at the best one — which is what stops a full pack of ore being
   * worth as much as the first sack times forty.
   */
  sellAll(index: number, itemId: string): void {
    let sold = 0, got = 0;
    const def = this.reg.items.get(itemId);
    if (!def) return;
    while (this.pack.includes(itemId)) {
      const q = quote(this.marketOf(index), def, this.turn, this.haggleAt(index));
      this.pack.splice(this.pack.indexOf(itemId), 1);
      this.coin += q.sell;
      got += q.sell;
      trade(this.marketOf(index), itemId, 1, this.turn);
      sold++;
      if (sold > 500) break;        // a guard, not a rule
    }
    if (sold) {
      this.log(`You sell ${sold} × ${def.name} for ${got}.`, "good");
      this.finishTurn({ tookTurn: true });
    }
  }

  /**
   * Where to sell what you are carrying, and for how much more.
   *
   * This is the Warbanner feature made legible: for every tradeable thing in the
   * pack, the village that pays best for it and how much more than here. Computed
   * from the live markets, so it reflects what you have already done to the
   * prices — sell a village out of ore and this stops recommending it.
   *
   * It only names villages you have actually visited, by whether a market exists
   * for them yet. A route to somewhere you have never been is not a tip, it is a
   * spoiler, and finding the places is half the game.
   */
  bestRoutes(fromIndex: number): { item: string; name: string; here: number; to: number; toName: string; profit: number }[] {
    const out: { item: string; name: string; here: number; to: number; toName: string; profit: number }[] = [];
    for (const itemId of new Set(this.pack)) {
      const def = this.reg.items.get(itemId);
      if (!def || def.unique) continue;
      const here = quote(this.marketOf(fromIndex), def, this.turn, this.haggleAt(fromIndex));

      let best: { index: number; sell: number } | null = null;
      for (const index of this.markets.keys()) {
        if (index === fromIndex) continue;
        const q = quote(this.marketOf(index), def, this.turn, this.haggleAt(index));
        if (!best || q.sell > best.sell) best = { index, sell: q.sell };
      }
      if (!best) continue;
      const profit = best.sell - here.buy;
      if (profit <= 0) continue;
      out.push({
        item: itemId, name: def.name ?? itemId, here: here.sell,
        to: best.sell, toName: this.continent.villages[best.index]?.name ?? "elsewhere",
        profit,
      });
    }
    return out.sort((a, b) => b.profit - a.profit).slice(0, 8);
  }

  /** What a biome is called, for the look panel and the wiki. */
  biomeName(id: string): string {
    return BIOME_BY_ID.get(id)?.name ?? id;
  }

  /**
   * Every melee attack the player can make, wielded weapon first.
   *
   * The right-click menu needs the list rather than just the default, because
   * the whole point of the menu is that you can choose: punching something that
   * resists steel is a real decision, and the keyboard only offers the weapon.
   */
  get playerAbilities(): string[] {
    const weapon = this.weaponAbility;
    const base = ["punch", "kick"].filter((id) => this.reg.abilities.has(id));
    // The weapon's attack is a synthetic ability built from the steel and the
    // hand, so it has no content id; it is offered under "punch", which is the
    // ability `move` actually substitutes it for.
    return weapon.id && this.reg.abilities.has(String(weapon.id))
      ? [String(weapon.id), ...base.filter((b) => b !== weapon.id)]
      : base;
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

/**
 * Open a saved run.
 *
 * A free function rather than a method because the seed has to be known before
 * the game exists: the constructor builds the continent, and building the wrong
 * continent and then replacing it would mean generating the world twice and
 * leaving a window in which `game.continent` is a lie.
 */
export function loadGame(reg: Registry, save: SaveFile): Game {
  const game = new Game(reg, save.seed);
  game.restore(save);
  return game;
}

/**
 * A villager's given name.
 *
 * Two syllables out of a small table, which is enough for a world of nine
 * villages to have no two people the same without shipping a name list. The
 * stream is forked per village, so the same seed always produces the same
 * people — a smith who is called something different every time you load is a
 * smith nobody remembers.
 */
export function villagerName(rng: Rng): string {
  const first = ["Bren", "Hal", "Mor", "Tess", "Ard", "Gil", "Wen", "Rask", "Dol", "Pell",
                 "Cuth", "Ims", "Nary", "Oss", "Fenn", "Thal", "Bry", "Kel", "Sarn", "Vess"];
  const last = ["a", "wyn", "ric", "mund", "is", "or", "eth", "an", "ow", "ick"];
  return `${first[rng.int(first.length)]}${last[rng.int(last.length)]}`;
}
