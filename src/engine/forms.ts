import type { Slot } from "./equipment.ts";
import type { DamageKind } from "./types.ts";

export type FormDef = {
  id: string;
  name: string;
  about: string;
  duration: number;
  mana: number;
  blockedSlots: readonly Slot[];
  might?: number;
  armour?: number;
  evasion?: number;
  speed?: number;
  naturalDamage?: number;
  resist?: Partial<Record<DamageKind, number>>;
};

const ARMOUR_SLOTS: readonly Slot[] = ["body", "head", "hands", "feet", "cloak", "offhand"];

export const FORMS: readonly FormDef[] = [
  {
    id: "dire-bear", name: "Dire Bear",
    about: "Powerful and durable; worn armor and weapons meld away as you fight with natural claws.",
    duration: 30, mana: 15,
    blockedSlots: ["weapon", "offhand", "body", "hands", "feet", "cloak"],
    might: 4, armour: 2, evasion: -1, speed: -10, naturalDamage: 8,
  },
  {
    id: "serpent", name: "River Serpent",
    about: "Quick and poison-hardy, but body armor, gloves, boots, and shields meld away.",
    duration: 30, mana: 15,
    blockedSlots: ["body", "hands", "feet", "offhand"],
    evasion: 2, speed: 15, naturalDamage: 3, resist: { poison: 0.5 },
  },
  {
    id: "stone", name: "Stonehide",
    about: "A slow, armored form. Flexible armor, gloves, boots, and shields meld away.",
    duration: 30, mana: 15,
    blockedSlots: ["hands", "feet", "cloak", "offhand"],
    armour: 5, speed: -20, naturalDamage: 2,
  },
  {
    id: "wisp", name: "Wisp",
    about: "A swift, hard-to-hit spirit; physical equipment melds, and physical blows are reduced.",
    duration: 30, mana: 15,
    blockedSlots: [...ARMOUR_SLOTS, "weapon"],
    evasion: 4, speed: 25, naturalDamage: 4, resist: { physical: 0.8 },
  },
];

export function formById(id: string): FormDef | undefined {
  return FORMS.find((form) => form.id === id);
}
