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
import { derive, withAttributes, type AttributeId, type Attributes } from "./attributes.ts";
import { WEAPON_CLASS, classOf } from "./weapons.ts";
import type { DamageKind } from "./types.ts";

/**
 * Where a piece of gear goes.
 *
 * One slot per line, and a thing can only occupy one of them. `ring` is listed
 * twice on purpose — two hands, two rings — which the UI shows as "ring" and
 * "ring 2" and which costs nothing here.
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
  "weapon", "offhand", "body", "head", "hands", "feet", "cloak", "ring", "ring2", "amulet",
] as const;
export type Slot = (typeof SLOTS)[number];

/** What the player is wearing: slot -> item id. */
export type Worn = Partial<Record<Slot, string>>;

/** A readable name for each slot, for the inventory screen. */
export const SLOT_NAME: Record<Slot, string> = {
  weapon: "Weapon", offhand: "Off-hand", body: "Body", head: "Head",
  hands: "Hands", feet: "Feet", cloak: "Cloak", ring: "Ring", ring2: "Ring",
  amulet: "Amulet",
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
  if (want === "ring") return ["ring", "ring2"];
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
  resist: {}, weapon: null, applies: [], attributes: {}, armourLoad: 0, demands: {},
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
): Loadout {
  const out: Loadout = { ...EMPTY, resist: {}, applies: [] };

  for (const slot of SLOTS) {
    const id = worn[slot];
    if (!id) continue;
    const item = items.get(id);
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

    for (const eid of item.enchantments ?? []) {
      const e = enchantments.get(eid);
      if (!e) continue;
      out.armour += e.modify?.armour ?? 0;
      out.might += e.bonusDamage ?? 0;
      for (const [kind, mult] of Object.entries(e.resist ?? {})) {
        if (typeof mult !== "number") continue;
        const k = kind as DamageKind;
        out.resist[k] = (out.resist[k] ?? 1) * mult;
      }
      for (const s of e.applies ?? []) if (!out.applies.includes(s)) out.applies.push(s);
    }
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
  setPool(actor.pools, "hp", "hpMax", actor.data["poolHp"] as number ?? 0, d.hpBonus);
  setPool(actor.pools, "stamina", "staminaMax", actor.data["poolStamina"] as number ?? 0, d.staminaBonus);
  setPool(actor.pools, "mana", "manaMax", actor.data["poolMana"] as number ?? 0, d.manaBonus);
  actor.speed = d.speed;

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
): { ok: boolean; message: string } {
  const item = items.get(itemId);
  if (!item) return { ok: false, message: "That is not a thing." };

  const slots = slotsFor(item);
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

  const off = displaced ? ` You put away ${items.get(displaced)?.name ?? displaced}.` : "";
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
  return { ok: true, message: `You take off ${items.get(id)?.name ?? id}.` };
}

/** A one-line description of an item, for the pack list. */
export function describe(item: ItemDef): string {
  const bits: string[] = [];
  if (item.damage) bits.push(`${item.damage} ${item.kind ?? "physical"}`);
  if (item.armour) bits.push(`${item.armour > 0 ? "+" : ""}${item.armour} armour`);
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
