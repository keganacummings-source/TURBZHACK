/**
 * Carrying things, and wearing them.
 *
 * Until now an item was a flat bonus applied once when a run started, which is
 * not an item at all — it is a line in the class file. This is the real thing:
 * a pack you can fill, slots you can fill from it, and gear that is found in
 * the world rather than handed to you.
 *
 * The design rule here is the same as everywhere else in this engine: an item
 * is a CONTENT FILE, and the only thing this module knows is how to add up
 * whatever those files happen to say. Adding a new kind of armour never means
 * touching this file.
 *
 * Totals are RECOMPUTED from scratch whenever anything changes, rather than
 * applied and un-applied as gear goes on and off. Incremental application is
 * where equipment systems rot: one missed un-apply and the player keeps a
 * bonus from a sword they sold ten floors ago.
 */
import type { Actor } from "./actor.ts";
import type { ItemDef, EnchantmentDef } from "../content/schema.ts";
import type { ProcDef } from "../content/schema.ts";
import { derive, withAttributes, type AttributeId, type Attributes } from "./attributes.ts";
import { affixEffect } from "./affixes.ts";

/** The base content id behind a pack handle: "short-sword#7" -> "short-sword". */
export function baseId(packId: string): string {
  const hash = packId.indexOf("#");
  return hash < 0 ? packId : packId.slice(0, hash);
}
import { WEAPON_CLASS, classOf } from "./weapons.ts";
import type { DamageKind } from "./types.ts";

/**
 * Where a piece of gear goes.
 *
 * One slot per line, and a thing can only occupy one of them. Ring items can
 * occupy up to eight species-supported positions.
 */
/**
 * Slots that are not worn: something you carry, use up, or build with.
 *
 * Listed once here because three different files used to each have their own
 * copy of this array, and adding "material" for the crafting materials meant
 * finding all three — the registry rejected them, the starting kit tried to
 * equip them, and the pack screen offered a "wear" button for a lump of ore.
 */
export const CARRIED_SLOTS = ["potion", "scroll", "misc", "material", "food"] as const;

/** Can this be put on, as opposed to merely carried? */
export function isWearable(slot: string | undefined): boolean {
  return !!slot && !(CARRIED_SLOTS as readonly string[]).includes(slot);
}

export const SLOTS = [
  "weapon", "offhand", "body", "head", "hands", "feet", "cloak",
  "ring", "ring2", "ring3", "ring4", "ring5", "ring6", "ring7", "ring8", "amulet",
] as const;
export type Slot = (typeof SLOTS)[number];
export const RING_SLOTS: readonly Slot[] = ["ring", "ring2", "ring3", "ring4", "ring5", "ring6", "ring7", "ring8"];
const STANDARD_SLOTS: readonly Slot[] = SLOTS.filter((slot) => !RING_SLOTS.slice(2).includes(slot));

/** Equipment this body can wear before a temporary form melds anything. */
export function speciesSlots(speciesId: string, build?: string): Slot[] {
  if (speciesId === "octopode") return ["weapon", "head", ...RING_SLOTS, "amulet"];
  const slots = SLOTS.filter((slot) => !RING_SLOTS.slice(2).includes(slot));
  return build === "serpentine" ? slots.filter((slot) => slot !== "feet") : slots;
}

export function slotLabel(slot: Slot, speciesId: string): string {
  if (speciesId === "octopode" && RING_SLOTS.includes(slot)) {
    return `Tentacle ${RING_SLOTS.indexOf(slot) + 1}`;
  }
  return SLOT_NAME[slot] ?? slot;
}

/** What the player is wearing: slot -> item id. */
export type Worn = Partial<Record<Slot, string>>;

/** A readable name for each slot, for the inventory screen. */
export const SLOT_NAME: Record<Slot, string> = {
  weapon: "Weapon", offhand: "Off-hand", body: "Body", head: "Head",
  hands: "Hands", feet: "Feet", cloak: "Cloak", ring: "Ring", ring2: "Ring",
  ring3: "Ring", ring4: "Ring", ring5: "Ring", ring6: "Ring", ring7: "Ring",
  ring8: "Ring", amulet: "Amulet",
};

/**
 * Which slots an item may go in.
 *
 * An item file says `"slot": "ring"`, and this is what turns that into "either
 * ring finger". Anything with no slot — a potion, a scroll — is carried but
 * never worn, and returns an empty list.
 */
export function slotsFor(item: ItemDef): Slot[] {
  const want = item.slot;
  if (!want) return [];
  if (want === "ring") return [...RING_SLOTS];
  if (want === "shield") return ["offhand"];
  return (SLOTS as readonly string[]).includes(want) ? [want as Slot] : [];
}

/** Everything a set of gear adds up to. */
export type Loadout = {
  armour: number;
  might: number;
  focus: number;
  accuracy: number;
  evasion: number;
  /** Multiplied together, so two sources of fire resistance compound. */
  resist: Partial<Record<DamageKind, number>>;
  /** Damage and kind of the weapon in hand, if there is one. */
  weapon: { damage: number; kind: DamageKind; name: string } | null;
  /** Statuses the wearer's attacks apply, from enchantments. */
  applies: string[];
  /** On-hit effects from everything worn — chain lightning off a ring counts. */
  procs: ProcDef[];
  /** Pools and speed added by affixes. */
  hpMax: number;
  staminaMax: number;
  manaMax: number;
  speed: number;
  /** Chance of a free second step when moving, from boots and the like. */
  extraMove: number;
  /** Attributes added by what is worn. */
  attributes: Partial<Attributes>;
  /**
   * Total armour weight carried, for the encumbrance check.
   *
   * Armour past what your Strength can carry costs evasion rather than being
   * refused. A hard requirement would mean a low-Strength character simply
   * cannot wear plate; a soft one means they can, badly, which is a decision.
   */
  armourLoad: number;
  /** Attribute minimums the worn items ask for, and how far short you are. */
  demands: Partial<Attributes>;
};

const EMPTY: Loadout = {
  armour: 0, might: 0, focus: 0, accuracy: 0, evasion: 0,
  hpMax: 0, staminaMax: 0, manaMax: 0, speed: 0, extraMove: 0,
  resist: {}, weapon: null, applies: [], procs: [], attributes: {}, armourLoad: 0, demands: {},
};

/**
 * Add up what is worn.
 *
 * Pure: it reads the worn map and the content, and returns a total. Nothing is
 * mutated, which is what makes it safe to call after every single change.
 */
export function loadoutOf(
  worn: Worn,
  items: Map<string, ItemDef>,
  enchantments: Map<string, EnchantmentDef>,
  instances?: Map<string, { affixes?: string[] }>,
): Loadout {
  /*
   * Fresh copies of every object field, not just a spread of EMPTY.
   *
   * A spread copies the references, so `out.attributes` was the SAME object as
   * EMPTY.attributes on every call — and mutating it meant each loadout wrote its
   * gear's attribute bonuses permanently into the shared default. It showed up as
   * a helm's +2 Strength that never came off, because by then "+2 Strength" was
   * baked into the empty loadout every character started from.
   */
  const out: Loadout = {
    ...EMPTY, resist: {}, applies: [], procs: [], attributes: {}, demands: {},
  };

  for (const slot of SLOTS) {
    const id = worn[slot];
    if (!id) continue;
    const item = items.get(baseId(id));
    if (!item) continue;

    out.armour += item.armour ?? 0;
    out.armourLoad += item.armour ?? 0;
    for (const [key, value] of Object.entries(item.attributes ?? {})) {
      if (typeof value !== "number") continue;
      out.attributes[key as AttributeId] = (out.attributes[key as AttributeId] ?? 0) + value;
    }
    // The strictest demand across everything worn is the one that counts: two
    // items each wanting 12 Strength is still a demand for 12, not 24.
    for (const [key, value] of Object.entries(item.requires ?? {})) {
      if (typeof value !== "number") continue;
      const k = key as AttributeId;
      out.demands[k] = Math.max(out.demands[k] ?? 0, value);
    }
    out.might += item.might ?? 0;
    out.focus += item.focus ?? 0;
    out.accuracy += item.accuracy ?? 0;
    out.evasion += item.evasion ?? 0;
    // Armour (and heavy gear in general) can drain the stamina pool directly.
    // A negative staminaMax on a piece of armour means wearing it makes you
    // fatigue faster — plate armour has less headroom for sustained swings than
    // leather even before the weapon cost is counted.
    out.staminaMax += item.staminaMax ?? 0;

    for (const [kind, mult] of Object.entries(item.resist ?? {})) {
      if (typeof mult !== "number") continue;
      const k = kind as DamageKind;
      out.resist[k] = (out.resist[k] ?? 1) * mult;
    }

    // A staff helps you cast simply by being a staff, so the class's own focus
    // bonus is added here rather than being written on every staff file.
    if (slot === "weapon") out.focus += WEAPON_CLASS[classOf(item)].focus ?? 0;

    // Only the weapon hand gives a weapon. A sword in the off-hand is a
    // shield's worth of nothing, which is the simplest honest rule.
    if (slot === "weapon" && item.damage) {
      out.weapon = { damage: item.damage, kind: (item.kind ?? "physical") as DamageKind, name: item.name };
    }

    /*
     * Affixes: both the ones baked into the file and the ones rolled onto this
     * particular copy. The two are the same kind of thing — a named bundle of
     * modifiers — so they are gathered into one list and applied once.
     */
    const affixIds = [...(item.enchantments ?? []), ...(instances?.get(id)?.affixes ?? [])];
    const eff = affixEffect(affixIds, enchantments);
    out.armour += eff.armour;
    out.might += eff.might + eff.bonusDamage;   // a flaming weapon hits harder
    out.focus += eff.focus;
    out.accuracy += eff.accuracy;
    out.evasion += eff.evasion;
    out.hpMax += eff.hpMax;
    out.staminaMax += eff.staminaMax;
    out.manaMax += eff.manaMax;
    out.speed += eff.speed;
    out.extraMove = Math.min(1, out.extraMove + eff.extraMove);
    for (const [k, v] of Object.entries(eff.attributes)) {
      if (typeof v !== "number") continue;
      out.attributes[k as AttributeId] = (out.attributes[k as AttributeId] ?? 0) + v;
    }
    for (const [k, mult] of Object.entries(eff.resist)) {
      if (typeof mult !== "number") continue;
      out.resist[k as DamageKind] = (out.resist[k as DamageKind] ?? 1) * mult;
    }
    for (const st of eff.applies) if (!out.applies.includes(st)) out.applies.push(st);
    for (const p of eff.procs) out.procs.push(p);
  }
  return out;
}

/**
 * Put the totals onto an actor.
 *
 * The actor keeps its OWN numbers — the ones a class and its level-ups gave it
 * — separately in `base`, and what the engine reads is always base plus gear.
 * Recomputed from scratch every time, so taking something off can never leave
 * part of it behind.
 */
export function applyLoadout(actor: Actor, load: Loadout): void {
  /*
   * Attributes first, because everything else is derived from them.
   *
   * A ring that grants Strength has to raise the attribute before the pools and
   * combat stats are worked out, or the ring would show on the sheet and do
   * nothing — which was the shape of the original equipment bug this whole
   * base-and-total arrangement exists to prevent.
   */
  actor.attributes = withAttributes(actor.baseAttributes, load.attributes);
  const d = derive(actor.attributes);

  const base = actor.baseStats;
  actor.stats.might = base.might + load.might + d.heavyDamage;
  actor.stats.focus = base.focus + load.focus + d.spellPower;
  actor.stats.accuracy = base.accuracy + load.accuracy;
  actor.stats.evasion = base.evasion + load.evasion + d.evasion + encumbrance(load, actor.attributes);
  actor.armour = actor.baseArmour + load.armour;

  /*
   * Pools follow the attributes, keeping the fraction you had.
   *
   * Taking off a ring of endurance must not kill you: if the maximum drops, the
   * current value is scaled rather than clamped, so you come out of it as hurt
   * as you went in rather than suddenly at death's door.
   */
  setPool(actor.pools, "hp", "hpMax", actor.data["poolHp"] as number ?? 0, d.hpBonus + load.hpMax);
  setPool(actor.pools, "stamina", "staminaMax", actor.data["poolStamina"] as number ?? 0, d.staminaBonus + load.staminaMax);
  setPool(actor.pools, "mana", "manaMax", actor.data["poolMana"] as number ?? 0, d.manaBonus + load.manaMax);
  actor.speed = d.speed + load.speed;
  // Boots of the wind and the like: read in the game loop after a plain step.
  actor.data["extraMove"] = load.extraMove;

  actor.resist = { ...actor.baseResist };
  for (const [kind, mult] of Object.entries(load.resist)) {
    if (typeof mult !== "number") continue;
    actor.resist[kind] = (actor.resist[kind] ?? 1) * mult;
  }
  actor.clampPools();
}

/**
 * The evasion penalty for wearing more armour than you can carry.
 *
 * Two points of evasion per point of armour over tolerance, and nothing at all
 * under it. A penalty that started immediately would make armour a trap for
 * everyone; one that never arrives makes Strength irrelevant to armour, which is
 * the thing it is supposed to be for.
 *
 * Failing an item's own `requires` is worse, because that is the item saying you
 * cannot really handle it: four points of evasion per point short, and it stacks
 * with the weight.
 */
export function encumbrance(load: Loadout, attr: Attributes): number {
  const d = derive(attr);
  const overWeight = Math.max(0, load.armourLoad - d.armourTolerance);
  let shortfall = 0;
  for (const [key, want] of Object.entries(load.demands)) {
    if (typeof want !== "number") continue;
    shortfall += Math.max(0, want - attr[key as AttributeId]);
  }
  return -(overWeight * 2 + shortfall * 4);
}

/**
 * Set a pool's maximum from a stored base plus an attribute bonus, keeping the
 * fraction of it that was full.
 *
 * `storedBase` of 0 means nobody has recorded a base for this pool yet — which is
 * every actor that is not the player — so the current maximum is left alone and
 * only the bonus is reconciled. That keeps this safe to call on a goblin.
 */
function setPool(
  pools: Actor["pools"], now: "hp" | "stamina" | "mana",
  max: "hpMax" | "staminaMax" | "manaMax", storedBase: number, bonus: number,
): void {
  if (!storedBase) return;
  const was = pools[max];
  const fraction = was > 0 ? pools[now] / was : 1;
  pools[max] = Math.max(now === "hp" ? 1 : 0, Math.round(storedBase + bonus));
  pools[now] = Math.round(pools[max] * fraction);
}

/**
 * Wear something from the pack.
 *
 * Returns what to print. Anything already in the slot goes back to the pack,
 * so equipping is never destructive — the commonest way to lose a good item in
 * a roguelike should not be putting on a worse one.
 */
export function equip(
  pack: string[],
  worn: Worn,
  itemId: string,
  items: Map<string, ItemDef>,
  preferSlot?: Slot,
  availableSlots: readonly Slot[] = STANDARD_SLOTS,
): { ok: boolean; message: string } {
  const item = items.get(baseId(itemId));
  if (!item) return { ok: false, message: "That is not a thing." };

  const slots = slotsFor(item).filter((slot) => availableSlots.includes(slot));
  if (!slots.length) return { ok: false, message: `${item.name} is not something you can wear.` };

  const at = pack.indexOf(itemId);
  if (at < 0) return { ok: false, message: `You are not carrying ${item.name}.` };

  // The first free slot it fits, or the one asked for, or the first.
  const slot = preferSlot && slots.includes(preferSlot)
    ? preferSlot
    : slots.find((s) => !worn[s]) ?? slots[0]!;

  const displaced = worn[slot];
  pack.splice(at, 1);
  worn[slot] = itemId;
  if (displaced) pack.push(displaced);

  const off = displaced ? ` You put away ${items.get(baseId(displaced))?.name ?? displaced}.` : "";
  return { ok: true, message: `You equip ${item.name}.${off}` };
}

/** Take something off, back into the pack. */
export function unequip(
  pack: string[],
  worn: Worn,
  slot: Slot,
  items: Map<string, ItemDef>,
): { ok: boolean; message: string } {
  const id = worn[slot];
  if (!id) return { ok: false, message: `Nothing is in that slot.` };
  delete worn[slot];
  pack.push(id);
  return { ok: true, message: `You take off ${items.get(baseId(id))?.name ?? id}.` };
}

/** A one-line description of an item, for the pack list. */
export function describe(item: ItemDef): string {
  const bits: string[] = [];
  if (item.damage) bits.push(`${item.damage} ${item.kind ?? "physical"}`);
  if (item.armour) bits.push(`${item.armour > 0 ? "+" : ""}${item.armour} armour`);
  if (item.staminaMax) bits.push(`${item.staminaMax > 0 ? "+" : ""}${item.staminaMax} stamina`);
  if (item.might) bits.push(`${item.might > 0 ? "+" : ""}${item.might} might`);
  if (item.focus) bits.push(`${item.focus > 0 ? "+" : ""}${item.focus} focus`);
  if (item.accuracy) bits.push(`${item.accuracy > 0 ? "+" : ""}${item.accuracy}% hit`);
  if (item.evasion) bits.push(`${item.evasion > 0 ? "+" : ""}${item.evasion}% dodge`);
  for (const [kind, mult] of Object.entries(item.resist ?? {})) {
    if (typeof mult !== "number") continue;
    bits.push(mult === 0 ? `immune to ${kind}` : `${kind} x${mult}`);
  }
  if (item.casts) bits.push(`casts ${item.casts}`);
  if (item.tool) bits.push(`${item.tool} tool`);
  /*
   * A material has no effect, and that is correct.
   *
   * Ore does nothing until it is smelted. Saying "no effect" about it in the
   * pack would read as a bug rather than as a fact, so materials describe what
   * they are instead — and the test that every item describes itself as
   * SOMETHING stays meaningful for the things that really have been left blank.
   */
  if (!bits.length && item.slot === "material") return "crafting material";
  if (!bits.length && item.slot === "food") return "food";
  return bits.join(" · ") || "no effect";
}
