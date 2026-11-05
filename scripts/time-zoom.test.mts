import assert from "node:assert/strict";
import test from "node:test";

import { timeOfDay } from "../src/engine/time.ts";
import { loadRegistry } from "./lib/harness.mts";
import { Game } from "../src/game.ts";
import { drawWorldMap } from "../src/render/draw.ts";
import {
  MAP_MAX_ZOOM, MAP_MIN_ZOOM, PLAY_MAX_ZOOM, PLAY_MIN_ZOOM,
  stepMapZoom, stepPlayZoomOffset,
} from "../src/render/zoom.ts";

const reg = loadRegistry();

test("day and night each last exactly 100 turns and repeat", () => {
  assert.deepEqual(timeOfDay(0), { phase: "day", turnInPhase: 1 });
  assert.deepEqual(timeOfDay(99), { phase: "day", turnInPhase: 100 });
  assert.deepEqual(timeOfDay(100), { phase: "night", turnInPhase: 1 });
  assert.deepEqual(timeOfDay(199), { phase: "night", turnInPhase: 100 });
  assert.deepEqual(timeOfDay(200), { phase: "day", turnInPhase: 1 });
  assert.deepEqual(timeOfDay(-1), { phase: "night", turnInPhase: 100 });
});

test("play and overview wheel zoom have clear bounded steps", () => {
  assert.equal(stepPlayZoomOffset(3, 0, -1), 1);
  assert.equal(stepPlayZoomOffset(3, 0, 1), -1);
  assert.equal(stepPlayZoomOffset(3, PLAY_MAX_ZOOM - 3, -1), PLAY_MAX_ZOOM - 3);
  assert.equal(stepPlayZoomOffset(3, PLAY_MIN_ZOOM - 3, 1), PLAY_MIN_ZOOM - 3);
  assert.equal(stepPlayZoomOffset(3, 0, 0), 0);

  let mapZoom = 1;
  for (let i = 0; i < 30; i++) mapZoom = stepMapZoom(mapZoom, -1);
  assert.equal(mapZoom, MAP_MAX_ZOOM, "map zoom exceeded or missed its upper bound");
  for (let i = 0; i < 60; i++) mapZoom = stepMapZoom(mapZoom, 1);
  assert.equal(mapZoom, MAP_MIN_ZOOM, "map zoom exceeded or missed its lower bound");
  assert.equal(stepMapZoom(1, 0), 1);
});

test("overview zoom centers on the player when zoomed in and fits at base zoom", () => {
  const game = new Game(reg, 2026);
  game.start("fighter");
  game.level.known.fill(0);
  const ctx = {
    canvas: { width: 800, height: 600 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  const colour = () => "#555";

  const fit = drawWorldMap(ctx, game, colour, { zoom: 1 });
  assert.equal(fit.scale, 1);
  const zoomed = drawWorldMap(ctx, game, colour, { zoom: 2 });
  assert.equal(zoomed.scale, 2);
  assert.ok(zoomed.offX <= 0 && zoomed.offY <= 0, "zoomed map was not clipped to the viewport");
  assert.ok(Math.abs(zoomed.offX + (game.player.pos.x + 0.5) * zoomed.scale - 400) <= 1,
    "map zoom did not keep the player centered horizontally");
  assert.ok(Math.abs(zoomed.offY + (game.player.pos.y + 0.5) * zoomed.scale - 300) <= 1,
    "map zoom did not keep the player centered vertically");
});
