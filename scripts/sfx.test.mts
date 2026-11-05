import assert from "node:assert/strict";
import test from "node:test";

import { MUSIC_TRACKS, renderSfx, type SfxName } from "../src/render/sfx.ts";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const cues: SfxName[] = ["step", "hit", "hurt", "cast"];

test("procedural cues are deterministic, finite, and audible", () => {
  for (const cue of cues) {
    const first = renderSfx(cue, 22050);
    const second = renderSfx(cue, 22050);
    assert.deepEqual(first, second, `${cue} changed between renders`);
    assert.ok(first.length > 0, `${cue} has no samples`);
    let peak = 0;
    for (const sample of first) {
      assert.ok(Number.isFinite(sample), `${cue} contains a non-finite sample`);
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak > 0.1 && peak <= 0.83, `${cue} peak was ${peak}`);
  }
});

test("sample rendering rejects invalid rates", () => {
  assert.throws(() => renderSfx("hit", 0), RangeError);
});

test("the complete authorized Main-game playlist is bundled", () => {
  assert.deepEqual(MUSIC_TRACKS, [
    "Background.ogg",
    "Background2.ogg",
    "Track4.ogg",
    "WINGRIDDENTURBZ.ogg",
    "WINGRIDDENTURBZ2.ogg",
    "Track9.ogg",
    "halloweenyEXT.ogg",
  ]);
  for (const track of MUSIC_TRACKS) {
    const path = resolve("assets", "audio", track);
    assert.ok(existsSync(path), `${track} is missing`);
    assert.ok(statSync(path).size > 0, `${track} is empty`);
  }
});
