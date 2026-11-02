/**
 * Everything the tests need to stand a game up without a browser.
 *
 * The engine deliberately has no DOM in it, so a test can build a level, drop
 * actors on it and run turns exactly as the real game does. The only thing this
 * file adds is loading the content folder from disk, which in the browser is
 * done with fetch instead.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Registry, type ContentSource } from "../../src/content/registry.ts";
import { CONTENT_KINDS, type ContentKind } from "../../src/content/schema.ts";
import { Level, type TileKind } from "../../src/engine/grid.ts";
import { Actor } from "../../src/engine/actor.ts";
import { Rng } from "../../src/engine/rng.ts";
import type { StatusDef } from "../../src/engine/status.ts";
import type { ActionCtx } from "../../src/engine/actions.ts";
import type { TurnContext } from "../../src/engine/turns.ts";
import type { Message } from "../../src/engine/types.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Read content/ off disk in the shape the Registry wants. */
export function diskSource(dir = join(ROOT, "content"), name = "base"): ContentSource {
  const files: ContentSource["files"] = {};
  for (const kind of CONTENT_KINDS) {
    const folder = join(dir, kind);
    if (!existsSync(folder)) continue;
    const bucket: Record<string, unknown> = {};
    for (const entry of readdirSync(folder)) {
      if (!entry.endsWith(".json")) continue;
      const stem = entry.slice(0, -5);
      try {
        bucket[stem] = JSON.parse(readFileSync(join(folder, entry), "utf8"));
      } catch (err) {
        // A broken file must be reported, not thrown: the registry's whole
        // promise is that one bad mod file does not take the game down.
        bucket[stem] = { __parseError: String(err) };
      }
    }
    files[kind as ContentKind] = bucket;
  }
  return { name, files };
}

/** The base game's content, loaded and cross-checked. */
export function loadRegistry(): Registry {
  const reg = new Registry();
  reg.add(diskSource());
  reg.checkReferences();
  return reg;
}

export const statusMap = (reg: Registry) => reg.statuses as unknown as Map<string, StatusDef>;

/** An open room with a wall around it — the simplest level that can be fought in. */
export function testLevel(w = 20, h = 12): Level {
  const floor: TileKind = { id: "floor", name: "Floor", solid: false, opaque: false, sprite: "stone" };
  const wall: TileKind = { id: "wall", name: "Wall", solid: true, opaque: true, sprite: "wall-stone" };
  const level = new Level(w, h, [floor, wall], "Test Room", 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      level.set(x, y, edge ? 1 : 0);
    }
  }
  return level;
}

/** Build an actor from a class or enemy definition, the way the game does. */
export function spawn(reg: Registry, kind: "classes" | "enemies", defId: string, x: number, y: number, isPlayer = false): Actor {
  const def = (kind === "classes" ? reg.classes : reg.enemies).get(defId);
  if (!def) throw new Error(`no ${kind} definition "${defId}"`);
  const pools = {
    hpMax: 100 + (def.pools?.hp ?? 0),
    staminaMax: 100 + (def.pools?.stamina ?? 0),
    manaMax: 50 + (def.pools?.mana ?? 0),
  };
  const actor = new Actor({
    id: `${defId}#${x},${y}${isPlayer ? ":you" : ""}`,
    def: defId,
    name: isPlayer ? "You" : def.name,
    pos: { x, y },
    pools: { ...pools, hp: pools.hpMax, stamina: pools.staminaMax, mana: pools.manaMax },
    stance: isPlayer ? "friendly" : ((def as { stance?: string }).stance as never) ?? "hostile",
    sprite: def.sprite,
    isPlayer,
    spells: (def as { spells?: string[] }).spells ?? [],
    armour: def.armour ?? 0,
    resist: (def.resist ?? {}) as Record<string, number>,
  });
  actor.speed = (def as { speed?: number }).speed ?? 100;
  actor.clampPools();
  return actor;
}

/** A whole game context, ready to run turns in. */
export function makeGame(reg: Registry, actors: Actor[], seed = 1) {
  const messages: Message[] = [];
  const level = testLevel();
  const ctx: TurnContext & ActionCtx = {
    level,
    actors,
    rng: new Rng(seed),
    statuses: statusMap(reg),
    turn: 0,
    cooldowns: new Map(),
    log: (text, tone) => { messages.push({ text, tone, turn: ctx.turn }); },
  };
  return { ctx, messages, level };
}

/** Everything printed so far, as one string, for `assert.match`. */
export const logText = (messages: Message[]) => messages.map((m) => m.text).join("\n");
