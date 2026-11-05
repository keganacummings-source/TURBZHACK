import { Rng, seedFrom } from "../engine/rng.ts";
import type { Registry } from "../content/registry.ts";
import { Game } from "../game.ts";

const NEIGHBOURS = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
] as const;

/** Start a seeded, automatically selected character beside a real dungeon door. */
export function createQuickStart(reg: Registry, seed: string | number = Date.now()): Game {
  const chooser = new Rng(seedFrom(String(seed))).fork("quick-start");
  const species = [...reg.species.keys()].sort();
  const classes = [...reg.classes.keys()].sort();
  const speciesId = chooser.fork("species").pick(species);
  const classId = chooser.fork("class").pick(classes);
  if (!speciesId || !classId) throw new Error("QuickStart needs at least one species and one class.");

  const game = new Game(reg, seed);
  game.start(classId, speciesId);

  const entrances = game.continent.entrances.slice().sort((a, b) =>
    Math.hypot(a.pos.x - game.continent.start.x, a.pos.y - game.continent.start.y)
    - Math.hypot(b.pos.x - game.continent.start.x, b.pos.y - game.continent.start.y));
  for (const entrance of entrances) {
    if (game.level.at(entrance.pos.x, entrance.pos.y)?.on !== "dungeon-entrance") continue;
    for (const delta of NEIGHBOURS) {
      const pos = { x: entrance.pos.x + delta.x, y: entrance.pos.y + delta.y };
      if (!game.level.inBounds(pos.x, pos.y) || game.level.solid(pos.x, pos.y)) continue;
      const occupant = game.actorAt(pos.x, pos.y);
      if (occupant && occupant !== game.player) continue;
      game.player.pos = pos;
      game.refreshFov();
      game.log(`QuickStart: ${speciesId} ${classId}, beside ${entrance.name}.`, "good");
      return game;
    }
  }
  throw new Error("QuickStart could not find a clear tile beside a dungeon staircase.");
}
