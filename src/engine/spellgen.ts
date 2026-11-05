/**
 * Random spells.
 *
 * A generated spell is not a file and is never stored. It is an ID — a short
 * string that names a recipe — and everything about the spell is worked out from
 * that string whenever it is asked for:
 *
 *     gen-fire-bolt-t3-s4k2-sig45-arc2-root35
 *      │    │    │    │   │    │    │    └ 35% to root each victim
 *      │    │    │    │   │    │    └ bounces to 2 further creatures
 *      │    │    │    │   │    └ 45% to set each victim alight
 *      │    │    │    │   └ a little salt, which nudges the damage a few percent
 *      │    │    │    └ tier 3
 *      │    │    └ a single-target bolt
 *      │    └ fire
 *      └ generated
 *
 * which reads as "Arcing Rooting Fire Bolt".
 *
 * Putting the recipe in the ID is what keeps this cheap and safe:
 *
 *   - a save only has to remember the ID, which it already does for every spell
 *     you know, so saves need no new fields and old saves are untouched;
 *   - the registry's spell table is a `SpellBook`, which turns a `gen-` ID into a
 *     definition on demand, so every place that looks a spell up by ID — the
 *     hotkeys, the right-click menu, the AI, an item that casts it — works with a
 *     generated spell without knowing the difference;
 *   - the same ID always makes the same spell, so a spell does not change under
 *     you between sessions.
 *
 * The recipe (element, form, tier, which traits and how strong) is in the ID.
 * The numbers derived from it — damage, mana, cooldown — are worked out here,
 * which means rebalancing them later changes every generated spell at once.
 *
 * Weird combos are intentional. A Draining Arcing Withering Poison Burst is a
 * real, legal spell: the generator is allowed to stack status soup, bounce,
 * leech and awkward forms together so level-up picks feel like discoveries
 * rather than "another fire bolt".
 */
import type { SpellDef } from "../content/schema.ts";
import type { Rng } from "./rng.ts";
import type { DamageKind } from "./types.ts";

export const GENERATED_PREFIX = "gen-";

/** Is this the ID of a generated spell? */
export const isGeneratedId = (id: string): boolean => id.startsWith(GENERATED_PREFIX);

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

type ElementKey = "fire" | "cold" | "shock" | "poison" | "arcane";
type FormKey = "bolt" | "lance" | "burst" | "spike" | "wave";

type Element = {
  /** What it is called in the spell's name. */
  word: string;
  kind: DamageKind;
  /** The status this element is known for, which every spell of it has a chance of. */
  signature: string;
  /** How the signature reads in the description: "set alight". */
  verb: string;
};

const ELEMENTS: Record<ElementKey, Element> = {
  fire:   { word: "Fire",   kind: "fire",   signature: "burning",  verb: "set alight" },
  cold:   { word: "Frost",  kind: "cold",   signature: "chilled",  verb: "chill" },
  shock:  { word: "Shock",  kind: "shock",  signature: "stunned",  verb: "stun" },
  poison: { word: "Poison", kind: "poison", signature: "poisoned", verb: "poison" },
  arcane: { word: "Arcane", kind: "pure",   signature: "cursed",   verb: "curse" },
};

type Form = {
  word: string;
  target: "actor" | "beam" | "burst";
  range: number;
  /** Damage relative to a bolt. A spell that hits several things is worth less per thing. */
  damage: number;
  /** Mana per point of damage. Area spells cost more for what they do. */
  manaPerDamage: number;
  /** Optional fixed radius for burst-shaped forms. */
  radius?: number;
};

/**
 * Forms are the shape of the delivery.
 *
 * spike  — short-range, heavy single hit (sniper / execution feel)
 * wave   — long beam, slightly weaker than a lance (corridor clearer)
 * bolt / lance / burst — the classic trio
 */
const FORMS: Record<FormKey, Form> = {
  bolt:  { word: "Bolt",  target: "actor", range: 7, damage: 1.00, manaPerDamage: 0.55 },
  lance: { word: "Lance", target: "beam",  range: 6, damage: 0.90, manaPerDamage: 0.65 },
  burst: { word: "Burst", target: "burst", range: 5, damage: 0.70, manaPerDamage: 0.75, radius: 1 },
  spike: { word: "Spike", target: "actor", range: 4, damage: 1.35, manaPerDamage: 0.50 },
  wave:  { word: "Wave",  target: "beam",  range: 8, damage: 0.75, manaPerDamage: 0.70 },
};

/**
 * Traits that put a status on whatever the spell hits, other than the element's own.
 *
 * `max` is the most chance one may have. The ones that take a turn away — root,
 * stun, web — are capped low, because a coin-flip on a skipped turn is a spell
 * that wins fights by itself.
 */
type StatusTrait = { status: string; adjective: string; noun: string; verb: string; min: number; max: number };

const STATUS_TRAITS: Record<string, StatusTrait> = {
  root:   { status: "rooted",   adjective: "Rooting",   noun: "Roots",  verb: "root",   min: 20, max: 40 },
  bind:   { status: "webbed",   adjective: "Binding",   noun: "Webs",   verb: "web",    min: 18, max: 35 },
  stun:   { status: "stunned",  adjective: "Stunning",  noun: "Stupor", verb: "stun",   min: 12, max: 28 },
  chill:  { status: "chilled",  adjective: "Chilling",  noun: "Rime",   verb: "chill",  min: 25, max: 55 },
  hex:    { status: "cursed",   adjective: "Hexing",    noun: "Malice", verb: "curse",  min: 25, max: 55 },
  wither: { status: "withered", adjective: "Withering", noun: "Decay",  verb: "wither", min: 22, max: 50 },
  burn:   { status: "burning",  adjective: "Scorching", noun: "Embers", verb: "ignite", min: 25, max: 55 },
  venom:  { status: "poisoned", adjective: "Venomous",  noun: "Venom",  verb: "poison", min: 25, max: 55 },
};

/**
 * Every trait key, in the order they are written into an ID and into a name.
 *
 * A fixed order is what makes the same set of traits always the same string,
 * however they were picked.
 */
const TRAIT_ORDER = ["arc", "drain", "root", "bind", "stun", "chill", "hex", "wither", "burn", "venom"] as const;
type TraitKey = (typeof TRAIT_ORDER)[number];

/** How common each trait is when one is being picked. */
const TRAIT_WEIGHT: Record<TraitKey, number> = {
  arc: 7, drain: 6, root: 4, bind: 2, stun: 3, chill: 3, hex: 3, wither: 3, burn: 3, venom: 3,
};

/**
 * Damage by tier for a plain bolt, before traits and form modifiers.
 * Tuned so generated spells feel competitive with hand-written ones of the
 * same tier — learning a weird combo should feel like a power spike, not a
 * sidegrade.
 */
const BASE_DAMAGE = [12, 16, 22, 28, 36] as const;

/** How far a bounce reaches from the last creature struck, and how much weaker each hop is. */
const BOUNCE_RANGE = 4;
const BOUNCE_FALLOFF = 0.75;

// ---------------------------------------------------------------------------
// A recipe, and reading one
// ---------------------------------------------------------------------------

/** What an ID says, once it has been taken apart. */
export type Recipe = {
  element: ElementKey;
  form: FormKey;
  tier: number;
  salt: string;
  /** Chance, in percent, of the element's own status. */
  signature: number;
  /** Further creatures a bolt leaps to. 0 for none. */
  arc: number;
  /** Percent of the damage returned to the caster. 0 for none. */
  drain: number;
  /** Chance in percent per status trait, by trait key. */
  statuses: Partial<Record<string, number>>;
};

const isElement = (s: string | undefined): s is ElementKey => !!s && s in ELEMENTS;
const isForm = (s: string | undefined): s is FormKey => !!s && s in FORMS;

/**
 * Take an ID apart. Returns undefined for anything that is not a well-formed
 * generated spell, so a mangled or foreign ID is "no such spell" rather than a
 * crash — the same way an unknown content ID is treated.
 */
export function parseSpellId(id: string): Recipe | undefined {
  if (!isGeneratedId(id)) return undefined;
  const [, element, form, tierToken, saltToken, ...rest] = id.split("-");
  if (!isElement(element) || !isForm(form)) return undefined;

  const tier = /^t([1-5])$/.exec(tierToken ?? "")?.[1];
  if (!tier) return undefined;
  const salt = /^s([0-9a-z]{1,6})$/.exec(saltToken ?? "")?.[1];
  if (!salt) return undefined;

  const recipe: Recipe = {
    element, form, tier: Number(tier), salt,
    signature: 40, arc: 0, drain: 0, statuses: {},
  };

  const seen = new Set<string>();
  for (const token of rest) {
    const m = /^([a-z]+)(\d{1,3})$/.exec(token);
    if (!m) return undefined;
    const key = m[1]!;
    const n = Number(m[2]);
    if (seen.has(key)) return undefined;
    seen.add(key);

    if (key === "sig") recipe.signature = clamp(n, 5, 100);
    else if (key === "arc") {
      // Arc is only legal on single-target forms (bolt / spike); beams and
      // bursts already hit multiple creatures.
      if (form !== "bolt" && form !== "spike") return undefined;
      recipe.arc = clamp(n, 1, 4);
    } else if (key === "drain") recipe.drain = clamp(n, 5, 60);
    else if (key in STATUS_TRAITS) recipe.statuses[key] = clamp(n, 5, 100);
    else return undefined;
  }
  return recipe;
}

/** Write a recipe back out as an ID. The inverse of `parseSpellId`. */
export function spellIdOf(r: Recipe): string {
  const parts = [GENERATED_PREFIX.slice(0, -1), r.element, r.form, `t${r.tier}`, `s${r.salt}`, `sig${r.signature}`];
  for (const key of TRAIT_ORDER) {
    if (key === "arc" && r.arc) parts.push(`arc${r.arc}`);
    else if (key === "drain" && r.drain) parts.push(`drain${r.drain}`);
    else if (key in STATUS_TRAITS && r.statuses[key]) parts.push(`${key}${r.statuses[key]}`);
  }
  return parts.join("-");
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A small stable number from a string, so the salt can vary a spell without a Rng. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// From a recipe to a spell
// ---------------------------------------------------------------------------

/** The traits a recipe has, in name order. */
function traitsOf(r: Recipe): TraitKey[] {
  return TRAIT_ORDER.filter((k) =>
    k === "arc" ? r.arc > 0 : k === "drain" ? r.drain > 0 : !!r.statuses[k]);
}

/** Make the spell a recipe describes. */
export function buildSpell(r: Recipe): SpellDef {
  const element = ELEMENTS[r.element];
  const form = FORMS[r.form];
  const traits = traitsOf(r);

  // The salt moves the damage by up to ~10% either way: enough that two spells
  // with the same recipe are not the same number, not enough to matter.
  const wobble = 0.90 + 0.05 * (hash(r.salt) % 5);
  const damage = Math.max(1, Math.round(BASE_DAMAGE[r.tier - 1]! * form.damage * wobble));

  // Statuses, with the chance of each. The signature comes first.
  const inflicts: NonNullable<SpellDef["inflicts"]> = [{ status: element.signature, chance: r.signature / 100 }];
  for (const key of traits) {
    const t = STATUS_TRAITS[key];
    if (t) inflicts.push({ status: t.status, chance: (r.statuses[key] ?? 0) / 100 });
  }

  // Mana: damage worth, plus a surcharge for every extra effect. Kept lean so
  // multi-trait spells stay castable once mana regenerates each turn.
  let mana = Math.round(damage * form.manaPerDamage);
  mana += Math.round(r.signature / 25);
  mana += r.arc * 2;
  mana += Math.round(r.drain / 12);
  for (const key of traits) if (key in STATUS_TRAITS) mana += Math.round((r.statuses[key] ?? 0) / 25);
  // Complex spells get a small flat premium so pure damage spikes stay the
  // cheapest option.
  if (traits.length >= 3) mana += 2;

  // The more a spell does, the longer before it can be done again.
  let cooldown = Math.floor(traits.length / 2);
  if (r.form === "burst" || r.form === "wave") cooldown += 1;
  if (r.arc >= 3) cooldown += 1;

  const name = nameOf(r, traits);
  const def: SpellDef = {
    id: spellIdOf(r),
    name,
    about: describe(r, traits, damage),
    mana: Math.max(3, mana),
    kind: element.kind,
    damage,
    range: form.range,
    target: form.target,
    tier: r.tier,
    inflicts,
    say: `{caster} cast{s} ${name}${form.target === "actor" ? " at {target}" : ""}.`,
    generated: true,
  };
  if (form.target === "burst") {
    def.radius = form.radius ?? (r.tier >= 4 ? 2 : 1);
    if (r.tier >= 5 && r.form === "burst") def.radius = 2;
  }
  if (cooldown > 0) def.cooldown = cooldown;
  if (r.arc) def.bounce = { jumps: r.arc, range: BOUNCE_RANGE, falloff: BOUNCE_FALLOFF };
  if (r.drain) def.leech = r.drain / 100;
  return def;
}

/**
 * Name construction that stays readable even with 3–4 traits.
 *
 * Up to two traits go in front as adjectives; any further ones become
 * "of Noun and Noun" so a four-trait spell is still one phrase rather than a
 * wall of adjectives.
 */
function nameOf(r: Recipe, traits: TraitKey[]): string {
  const word = (k: TraitKey, noun: boolean) =>
    k === "arc" ? (noun ? "Arcs" : "Arcing")
      : k === "drain" ? (noun ? "Drain" : "Draining")
        : noun ? STATUS_TRAITS[k]!.noun : STATUS_TRAITS[k]!.adjective;

  const front = traits.slice(0, 2).map((k) => word(k, false));
  const rest = traits.slice(2);
  let back = "";
  if (rest.length === 1) back = ` of ${word(rest[0]!, true)}`;
  else if (rest.length > 1) {
    back = ` of ${rest.map((k) => word(k, true)).join(" and ")}`;
  }
  return [...front, ELEMENTS[r.element].word, FORMS[r.form].word].join(" ") + back;
}

/** A sentence for the level-up screen, so a choice says what it does before you pick it. */
function describe(r: Recipe, traits: TraitKey[], damage: number): string {
  const e = ELEMENTS[r.element];
  const parts: string[] = [];
  parts.push(
    r.form === "bolt" ? `A bolt of ${e.word.toLowerCase()} for ${damage}.`
      : r.form === "lance" ? `A line of ${e.word.toLowerCase()} for ${damage} to everything in it.`
        : r.form === "burst" ? `A burst of ${e.word.toLowerCase()} for ${damage} to everything it catches.`
          : r.form === "spike" ? `A short-range spike of ${e.word.toLowerCase()} for ${damage}.`
            : `A long wave of ${e.word.toLowerCase()} for ${damage} along the line.`);
  if (r.arc) {
    const hops = r.arc === 1 ? "one more creature" : `${r.arc} more creatures`;
    parts.push(`Then it leaps to ${hops}, weaker each hop.`);
  }

  const chances = [`${r.signature}% to ${e.verb}`];
  for (const k of traits) {
    const t = STATUS_TRAITS[k];
    if (t) chances.push(`${r.statuses[k]}% to ${t.verb}`);
  }
  parts.push(`${chances.join("; ")} on each creature it hits.`);
  if (r.drain) parts.push(`You recover ${r.drain}% of the damage dealt.`);
  if (traits.length >= 3) parts.push("A tangled, hungry spell.");
  return parts.join(" ");
}

/** Make a spell straight from its ID, or undefined if the ID is not one. */
export function spellFromId(id: string): SpellDef | undefined {
  const recipe = parseSpellId(id);
  return recipe ? buildSpell(recipe) : undefined;
}

// ---------------------------------------------------------------------------
// Rolling a new one
// ---------------------------------------------------------------------------

/**
 * How many traits a spell of a tier carries (minimum).
 * Higher tiers are allowed to get messier — that is where the weird combos live.
 */
const TRAIT_COUNT = [1, 1, 2, 2, 3] as const;

/** Roll the recipe for a new spell of a tier. */
export function rollRecipe(rng: Rng, tier: number): Recipe {
  const t = clamp(Math.round(tier), 1, 5);
  const element = rng.pick(Object.keys(ELEMENTS) as ElementKey[])!;

  // Forms: bolts remain the most common, but spikes, waves and bursts show up
  // often enough that level-up screens are not a wall of "X Bolt".
  const form = rng.weighted<FormKey>(
    ["bolt", "lance", "burst", "spike", "wave"],
    (f) => (f === "bolt" ? 5 : f === "lance" || f === "burst" ? 3 : 2),
  )!;

  const salt = rng.int(36 ** 3).toString(36).padStart(3, "0");

  // Signature status chance climbs with tier; high-tier spells almost always
  // land their element's signature effect.
  const signature = clamp(35 + 6 * t + 5 * rng.int(4), 20, 80);

  // Trait count: minimum from the table, then a chance to go one (or at tier
  // 5, two) higher so you can actually roll four-trait monstrosities.
  // Typed as number (not the TRAIT_COUNT literal union) so it can climb to 4.
  let count: number = TRAIT_COUNT[t - 1]!;
  if (t >= 2 && rng.chance(0.35)) count += 1;
  if (t >= 4 && rng.chance(0.25)) count += 1;
  if (t >= 5 && rng.chance(0.15)) count += 1;
  count = Math.min(4, count);

  // Which traits are on offer: not a duplicate of the element's own signature
  // status, and no arc on multi-target forms.
  let pool: TraitKey[] = TRAIT_ORDER.filter((k) => {
    if (k === "arc") return form === "bolt" || form === "spike";
    if (k in STATUS_TRAITS && STATUS_TRAITS[k]!.status === ELEMENTS[element].signature) return false;
    return true;
  });

  const recipe: Recipe = { element, form, tier: t, salt, signature, arc: 0, drain: 0, statuses: {} };
  for (let i = 0; i < count && pool.length; i++) {
    const key = rng.weighted(pool, (k) => TRAIT_WEIGHT[k])!;
    pool = pool.filter((k) => k !== key);

    if (key === "arc") {
      // 1–4 hops; higher tiers get more ambitious chaining.
      let hops = 1;
      if (t >= 3 && rng.chance(0.55)) hops += 1;
      if (t >= 4 && rng.chance(0.45)) hops += 1;
      if (t >= 5 && rng.chance(0.35)) hops += 1;
      recipe.arc = Math.min(4, hops);
    } else if (key === "drain") {
      recipe.drain = rng.pick([15, 20, 25, 30, 35, 40, 45])!;
    } else {
      const s = STATUS_TRAITS[key]!;
      const steps = Math.floor((s.max - s.min) / 5) + 1;
      recipe.statuses[key] = s.min + 5 * rng.int(steps);
    }
  }
  return recipe;
}

/** Roll the ID of a new spell of a tier. */
export const rollSpellId = (rng: Rng, tier: number): string => spellIdOf(rollRecipe(rng, tier));

/**
 * Roll `count` different spells for a level-up.
 *
 * Most are of the highest tier on offer and some are a tier below, so the roll
 * is mostly about what you have just become strong enough for without hiding the
 * smaller, cheaper ones. A small chance of a "wild" tier+0 with extra trait
 * pressure is handled inside rollRecipe itself.
 */
export function rollSpells(rng: Rng, maxTier: number, count: number): SpellDef[] {
  const out: SpellDef[] = [];
  const seen = new Set<string>();
  for (let guard = 0; out.length < count && guard < count * 12; guard++) {
    // 25% chance of one tier lower (cheaper / simpler), otherwise full tier.
    const tier = rng.chance(0.25) ? Math.max(1, maxTier - 1) : maxTier;
    const def = spellFromId(rollSpellId(rng, tier));
    if (!def || seen.has(String(def.id))) continue;
    seen.add(String(def.id));
    out.push(def);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The spell table
// ---------------------------------------------------------------------------

/**
 * The registry's table of spells, which also knows how to make a generated one.
 *
 * It is a plain Map to everything that uses it: `get`, `has`, iteration and
 * `size` all behave as before. The one difference is that asking for a `gen-`
 * ID that is not in the table builds it from the ID instead of coming back
 * empty. Generated spells are never added to the table itself, so iterating it
 * — the wiki, the content checks — still lists only what is written in files.
 */
export class SpellBook extends Map<string, SpellDef> {
  private made = new Map<string, SpellDef | null>();

  override get(id: string): SpellDef | undefined {
    const written = super.get(id);
    if (written || !isGeneratedId(id)) return written;
    // Built once. The HUD asks for every known spell on every frame.
    let def = this.made.get(id);
    if (def === undefined) {
      def = spellFromId(id) ?? null;
      this.made.set(id, def);
    }
    return def ?? undefined;
  }

  override has(id: string): boolean {
    return super.has(id) || this.get(id) !== undefined;
  }
}
