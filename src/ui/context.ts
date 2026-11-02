/**
 * What you can do to the thing you just right-clicked.
 *
 * This is the mouse half of the game, and it is meant to be the whole game:
 * walking, attacking, picking things up, casting, talking, looking something up
 * in the wiki. Anything the keyboard can do to a square should be on this menu.
 *
 * The menu is DATA — a list of `{ kind, label, detail }` — rather than a list of
 * callbacks, for two reasons. It can be tested from Node without a DOM, which is
 * where the interesting questions are ("does a hostile creature in reach offer
 * an attack?", "does an empty square offer pick up?"). And the app stays the
 * only thing that knows about buttons.
 */
import type { Game } from "../game.ts";
import type { Actor } from "../engine/actor.ts";
import { distance } from "../engine/grid.ts";
import type { AbilityDef, SpellDef } from "../content/schema.ts";

export type ContextAction =
  | { kind: "look"; label: string; detail?: string }
  | { kind: "wiki"; label: string; detail?: string; topic: string }
  | { kind: "walk"; label: string; detail?: string; x: number; y: number }
  | { kind: "attack"; label: string; detail?: string; id: string; target: string }
  | { kind: "cast"; label: string; detail?: string; id: string; target: string }
  | { kind: "talk"; label: string; detail?: string; target: string }
  | { kind: "tame"; label: string; detail?: string; target: string }
  | { kind: "pickup"; label: string; detail?: string }
  | { kind: "harvest"; label: string; detail?: string; x: number; y: number }
  | { kind: "enter"; label: string; detail?: string }
  | { kind: "wait"; label: string; detail?: string };

export type ContextMenu = {
  /** What was clicked, for the heading. */
  title: string;
  /** A sentence about it. */
  about: string;
  /** The sprite to show beside the heading, if there is one. */
  sprite?: string;
  /** Lines of fact: health, resistances, damage, where it lives. */
  facts: [string, string][];
  actions: ContextAction[];
};

/** Everything known about a creature, for the panel and for the wiki. */
export function describeActor(game: Game, who: Actor): { facts: [string, string][]; about: string } {
  const def = game.reg.enemies.get(who.def);
  const facts: [string, string][] = [
    ["Health", `${Math.round(who.pools.hp)}/${Math.round(who.pools.hpMax)}`],
  ];
  if (who.armour) facts.push(["Armour", String(who.armour)]);
  facts.push(["Hit", `${who.stats.accuracy}%`], ["Dodge", `${who.stats.evasion}%`]);
  if (who.speed !== 100) {
    facts.push(["Speed", who.speed > 100 ? `${who.speed} — faster than you` : `${who.speed} — slower than you`]);
  }

  const resist = Object.entries(who.resist).filter(([, v]) => v !== 1);
  if (resist.length) {
    facts.push(["Resists", resist
      .map(([k, v]) => `${k} ${v === 0 ? "immune" : v < 1 ? `${Math.round((1 - v) * 100)}% less` : `${Math.round((v - 1) * 100)}% more`}`)
      .join(", ")]);
  }

  const hits = [...(def?.abilities ?? []), ...(who.spells ?? [])]
    .map((id) => game.reg.abilities.get(id)?.name ?? game.reg.spells.get(id)?.name ?? id);
  if (hits.length) facts.push(["Attacks", hits.join(", ")]);
  if (def?.xp) facts.push(["Worth", `${def.xp} xp`]);
  if (who.statuses.length) {
    facts.push(["Affected by", who.statuses.map((s) => `${game.reg.statuses.get(s.id)?.name ?? s.id} (${s.turns})`).join(", ")]);
  }
  if (def?.biomes?.length) facts.push(["Found in", def.biomes.join(", ")]);
  if (def?.boss) facts.push(["", "A world boss. There is only one."]);

  return { facts, about: def?.about ?? "" };
}

/**
 * The menu for one square.
 *
 * Only what is actually possible appears. An attack is offered when something
 * hostile is standing within reach; "walk here" when there is a route; "pick up"
 * when there is something on the floor under you. An option that would fail is
 * worse than no option, because the player learns the menu by reading it.
 */
export function menuAt(game: Game, x: number, y: number): ContextMenu {
  const level = game.level;
  const inSight = level.inBounds(x, y) && !!level.visible[level.idx(x, y)];
  const known = level.inBounds(x, y) && !!level.known[level.idx(x, y)];
  const tile = level.at(x, y);
  const who = game.actorAt(x, y);
  const here = game.lootAt(x, y);
  const standingHere = game.player.pos.x === x && game.player.pos.y === y;
  const reach = distance({ x, y }, game.player.pos) <= 1.5;

  const actions: ContextAction[] = [];
  let title = tile?.name ?? "Nothing";
  let about = "";
  let sprite = tile?.sprite;
  let facts: [string, string][] = [];

  if (!known) {
    return {
      title: "Unexplored",
      about: "You have not been near enough to see this.",
      facts: [],
      actions: [{ kind: "walk", label: "Walk towards it", x, y }],
    };
  }

  if (who && inSight) {
    // A creature is the most interesting thing in a square, so it takes the
    // heading; the ground it is standing on becomes a fact.
    title = who.isPlayer ? `${who.name} (you)` : who.name;
    sprite = who.sprite;
    const d = describeActor(game, who);
    facts = d.facts;
    about = d.about;
    facts.push(["Standing on", tile?.name ?? "nothing"]);

    if (!who.isPlayer) {
      if (who.stance === "hostile" && reach) {
        for (const id of game.playerAbilities) {
          const ability = game.reg.abilities.get(id) as AbilityDef | undefined;
          if (!ability) continue;
          const cost = ability.stamina ?? 0;
          const can = game.player.pools.stamina >= cost;
          actions.push({
            kind: "attack", id, target: who.id,
            label: `${ability.name ?? id}`,
            detail: `${ability.damage ?? 0} ${ability.kind ?? "physical"}${cost ? ` · ${cost} stamina` : " · free"}${can ? "" : " · not enough stamina"}`,
          });
        }
      }
      for (const id of game.player.spells) {
        const spell = game.reg.spells.get(id) as SpellDef | undefined;
        if (!spell) continue;
        if (distance({ x, y }, game.player.pos) > (spell.range ?? 6)) continue;
        const can = game.player.pools.mana >= spell.mana;
        actions.push({
          kind: "cast", id, target: who.id,
          label: `Cast ${spell.name ?? id}`,
          detail: `${spell.mana} mana${can ? "" : " · not enough"}`,
        });
      }
      if (who.stance !== "hostile") {
        actions.push({ kind: "talk", label: "Talk to it", target: who.id });
      }
      if (game.canTame(who)) {
        actions.push({
          kind: "tame", label: "Try to tame it", target: who.id,
          detail: game.tameOdds(who),
        });
      }
      if (!reach) actions.push({ kind: "walk", label: "Walk to it", x, y });
      actions.push({ kind: "wiki", label: `Look up ${who.name}`, topic: `enemies/${who.def}` });
    }
  } else {
    about = tileAbout(game, x, y, tile?.id ?? "");
    if (game.harvestable(x, y)) {
      facts.push(["Harvest", game.harvestLabel(x, y)]);
    }
    if (tile?.solid) facts.push(["", "You cannot walk through this."]);
    if (tile?.on) facts.push(["Leads", tile.on === "stairs-down" ? "down" : tile.on === "stairs-up" ? "up" : "somewhere"]);
  }

  if (here.length) {
    facts.push(["On the ground", here.map((id) => game.reg.items.get(id)?.name ?? id).join(", ")]);
  }

  // Things to do with the square itself, after anything to do with its occupant.
  if (standingHere) {
    if (here.length) actions.push({ kind: "pickup", label: `Pick up ${here.length > 1 ? "everything" : game.reg.items.get(here[0]!)?.name ?? "it"}` });
    if (tile?.on) actions.push({ kind: "enter", label: tile.on === "stairs-up" ? "Go up" : tile.on === "stairs-down" ? "Go down" : "Go in" });
    actions.push({ kind: "wait", label: "Wait a turn" });
  } else if (!who || !inSight) {
    if (game.harvestable(x, y) && reach) {
      actions.push({ kind: "harvest", label: game.harvestLabel(x, y), x, y });
    } else if (!tile?.solid) {
      actions.push({ kind: "walk", label: "Walk here", x, y });
    } else if (game.harvestable(x, y)) {
      actions.push({ kind: "walk", label: "Walk up to it", x, y });
    }
  }

  if (tile) actions.push({ kind: "wiki", label: `Look up ${tile.name}`, topic: `tiles/${tile.id}` });

  return { title, about, sprite, facts, actions };
}

/** A line about a piece of ground, assembled from what the game knows. */
function tileAbout(game: Game, x: number, y: number, tileId: string): string {
  if (game.place.kind !== "overworld") return "";
  const i = game.level.idx(x, y);
  const biome = game.continent.biome[i];
  const band = game.continent.region[i];
  const name = biome ? game.biomeName(biome) : "";
  if (!name) return "";
  const howFar = band === undefined
    ? ""
    : band <= 1 ? " Close to where you woke up."
    : band <= 3 ? " A fair way out."
    : " Far out. Things here do not scale down for you.";
  return `${name}.${howFar}`;
}
