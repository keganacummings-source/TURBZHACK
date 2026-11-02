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
};

const EMPTY: Loadout = {
  armour: 0, might: 0, focus: 0, accuracy: 0, evasion: 0,
  resist: {}, weapon: null, applies: [],
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
    out.might += item.might ?? 0;
    out.focus += item.focus ?? 0;
    out.accuracy += item.accuracy ?? 0;
    out.evasion += item.evasion ?? 0;

    for (const [kind, mult] of Object.entries(item.resist ?? {})) {
      if (typeof mult !== "number") continue;
      const k = kind as DamageKind;
      out.resist[k] = (out.resist[k] ?? 1) * mult;
    }

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
  const base = actor.baseStats;
  actor.stats.might = base.might + load.might;
  actor.stats.focus = base.focus + load.focus;
  actor.stats.accuracy = base.accuracy + load.accuracy;
  actor.stats.evasion = base.evasion + load.evasion;
  actor.armour = actor.baseArmour + load.armour;

  actor.resist = { ...actor.baseResist };
  for (const [kind, mult] of Object.entries(load.resist)) {
    if (typeof mult !== "number") continue;
    actor.resist[kind] = (actor.resist[kind] ?? 1) * mult;
  }
  actor.clampPools();
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
