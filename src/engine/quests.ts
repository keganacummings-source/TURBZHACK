/**
 * Quests: what somebody wants, and whether you have done it.
 *
 * Quests are generated from templates against the actual world rather than
 * written out one by one. "Kill eight of something that lives near here" is one
 * content file; the creature, the count, the pay and the phrasing are filled in
 * when it is offered, from the bestiary and from where the village actually is.
 * Writing one file per creature in a 71-strong bestiary would be 71 files that
 * all say the same thing, and the ones nobody ever saw would rot.
 *
 * The tracking is deliberately simple: a quest knows what it is counting and how
 * far along it is, and the Game tells it when something relevant happens. No
 * quest ever inspects the world for itself, because a quest that can read the
 * world can disagree with it.
 */
import type { Rng } from "./rng.ts";
import type { EnemyDef, ItemDef, QuestDef } from "../content/schema.ts";

export type QuestKind = NonNullable<QuestDef["kind"]>;

export type ActiveQuest = {
  /** Unique within a run, so two bounties on different creatures are two quests. */
  id: string;
  /** The template it came from. */
  def: string;
  kind: QuestKind;
  /** Which village set it, by index into the continent's village list. */
  village: number;
  /** Who set it, for the log and for handing it in. */
  giver: string;
  /** The thing being counted: an enemy def, an item id, a village index, a depth. */
  target: string;
  /** How many are needed, and how many are done. */
  need: number;
  done: number;
  /** The request, already phrased. */
  ask: string;
  /** What it pays. */
  pay: number;
  reward?: string;
  standing: number;
  /** Set once handed in. */
  finished?: boolean;
};

/** Is the task itself complete, whether or not it has been handed in? */
export const isDone = (q: ActiveQuest): boolean => q.done >= q.need;

/**
 * What a village should ask for.
 *
 * `tier` comes from how far out the village is, so a hamlet near the start asks
 * for rats and a town at the edge of the map asks for something that will kill
 * you. The reward is worked out from the task rather than written on the
 * template: eight of something worth 200 experience each is a bigger favour than
 * eight rats, and the pay should say so.
 */
export type QuestWorld = {
  /** Creatures that live near this village, by biome and distance band. */
  localEnemies: EnemyDef[];
  /** World bosses whose lair is within reach, and the name of where they are. */
  bosses: { def: EnemyDef; where: string }[];
  /** Goods this village is short of. */
  wanted: ItemDef[];
  /** Other villages, for a delivery. */
  elsewhere: { index: number; name: string }[];
  /** Dungeons near here, for a delve. */
  dungeons: { index: number; name: string }[];
  /** How far out the village is, 0-5. */
  band: number;
};

/**
 * Build one quest from a template and the world around a village.
 *
 * Returns null when the world cannot satisfy the template — a village with no
 * neighbours cannot ask for a delivery, and one with no boss in reach cannot
 * ask for a slaying. Returning null rather than inventing a target is what keeps
 * a quest from naming something that is not there.
 */
export function makeQuest(
  template: QuestDef, world: QuestWorld, village: number, giver: string, rng: Rng,
): ActiveQuest | null {
  const kind = template.kind;
  if (!kind) return null;
  const tier = template.tier ?? 1;
  const phrase = (text: string, parts: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(parts[key] ?? `{${key}}`));

  const pick = <T,>(list: T[]): T | undefined => list.length ? list[rng.int(list.length)] : undefined;
  const line = (list: string[] | undefined, fallback: string) => pick(list ?? []) ?? fallback;

  if (kind === "bounty") {
    const prey = pick(world.localEnemies);
    if (!prey) return null;
    // Fewer of the dangerous things. Eight rats is an afternoon; eight trolls is
    // not a bounty, it is a campaign.
    const worth = prey.xp ?? 10;
    const need = Math.max(2, Math.min(10, Math.round(60 / Math.max(6, worth / 3))));
    return {
      id: `${template.id}:${village}:${prey.id}`,
      def: String(template.id), kind, village, giver,
      target: String(prey.id), need, done: 0,
      ask: phrase(line(template.ask, "Kill {count} {what}."), {
        what: plural(prey.name ?? String(prey.id)), count: need,
        where: (prey.biomes ?? ["the hills"])[0] ?? "the hills",
      }),
      pay: Math.round((template.pay ?? 10) * tier + worth * need * 0.35),
      reward: template.reward,
      standing: template.standing ?? 1,
    };
  }

  if (kind === "slay") {
    const target = pick(world.bosses);
    if (!target) return null;
    return {
      id: `${template.id}:${target.def.id}`,
      def: String(template.id), kind, village, giver,
      target: String(target.def.id), need: 1, done: 0,
      ask: phrase(line(template.ask, "Kill {what}."), {
        what: target.def.title ?? target.def.name ?? String(target.def.id),
        where: target.where, count: 1,
      }),
      pay: Math.round((template.pay ?? 50) * tier + (target.def.xp ?? 500) * 0.4),
      reward: template.reward,
      standing: template.standing ?? 10,
    };
  }

  if (kind === "gather") {
    const good = pick(world.wanted);
    if (!good) return null;
    const need = 3 + rng.int(6);
    return {
      id: `${template.id}:${village}:${good.id}`,
      def: String(template.id), kind, village, giver,
      target: String(good.id), need, done: 0,
      ask: phrase(line(template.ask, "Bring me {count} {what}."), {
        what: plural(good.name ?? String(good.id)), count: need, where: "here",
      }),
      pay: Math.round((template.pay ?? 10) * tier + (good.value ?? 10) * need * 1.4),
      reward: template.reward,
      standing: template.standing ?? 1,
    };
  }

  if (kind === "deliver") {
    const to = pick(world.elsewhere);
    if (!to) return null;
    return {
      id: `${template.id}:${village}:${to.index}`,
      def: String(template.id), kind, village, giver,
      target: String(to.index), need: 1, done: 0,
      ask: phrase(line(template.ask, "Take this to {where}."), {
        where: to.name, what: "a sealed packet", count: 1,
      }),
      pay: Math.round((template.pay ?? 20) * tier * (1 + world.band * 0.4)),
      reward: template.reward,
      standing: template.standing ?? 2,
    };
  }

  // delve
  const dungeon = pick(world.dungeons);
  if (!dungeon) return null;
  const depth = Math.max(2, Math.min(10, 3 + world.band));
  return {
    id: `${template.id}:${dungeon.index}:${depth}`,
    def: String(template.id), kind: "delve", village, giver,
    target: String(dungeon.index), need: depth, done: 0,
    ask: phrase(line(template.ask, "Reach floor {count} of {where}."), {
      where: dungeon.name, count: depth, nth: ordinal(depth), what: "the deep",
    }),
    pay: Math.round((template.pay ?? 30) * tier * depth * 0.5),
    reward: template.reward,
    standing: template.standing ?? 4,
  };
}

/**
 * A rough plural, for "Kill eight goblins".
 *
 * Deliberately crude — the bestiary is full of names that no rule handles
 * ("The Hollow Choir") — so anything that already ends in s, or starts with
 * "The", is left exactly as written. Getting this wrong in the obvious cases is
 * worse than not trying, and these are the obvious cases.
 */
/** "1st", "2nd", "3rd", "4th". For "reach the 3rd floor". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function plural(name: string): string {
  if (/^the\b/i.test(name)) return name;
  if (/s$/i.test(name)) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(ch|sh|x|z)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

/** A short line for the quest log: "3 of 8 goblins". */
export function progressLine(q: ActiveQuest, nameOf: (id: string) => string): string {
  switch (q.kind) {
    case "bounty": return `${q.done} of ${q.need} ${plural(nameOf(q.target))}`;
    case "gather": return `${q.done} of ${q.need} ${plural(nameOf(q.target))}`;
    case "slay": return q.done ? "done" : `${nameOf(q.target)} still lives`;
    case "deliver": return q.done ? "delivered" : "not yet delivered";
    case "delve": return `floor ${q.done} of ${q.need}`;
  }
}
