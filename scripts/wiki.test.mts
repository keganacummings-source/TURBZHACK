import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistry } from "./lib/harness.mts";
import { indexWiki, pageHtml, searchWiki, wikiHtml } from "../src/ui/wiki.ts";
import { Game } from "../src/game.ts";
import { CONTENT_KINDS } from "../src/content/schema.ts";
import { DUNGEON_FLOORS, dungeonKeeper } from "../src/world/dungeon.ts";

const reg = loadRegistry();

test("the wiki indexes every shipped content kind and each generated dungeon", () => {
  const game = new Game(reg, 2026);
  game.start("fighter");
  const entries = indexWiki(reg, game);
  const sections = new Map(CONTENT_KINDS.map((kind) => [kind, kind]));
  for (const kind of CONTENT_KINDS) {
    const source = reg[kind];
    assert.equal(
      entries.filter((entry) => entry.section === sections.get(kind)).length,
      source.size,
      `${kind} definitions are missing wiki entries`,
    );
  }
  assert.equal(entries.filter((entry) => entry.section === "dungeons").length, game.continent.entrances.length + 1);
  assert.ok(entries.some((entry) => entry.section === "rules" && entry.id === "attributes"));
  assert.ok(entries.some((entry) => entry.section === "rules" && entry.id === "resistances"));
});

test("all bestiary entries remain visible and boss pages disclose their actual locations", () => {
  const entries = indexWiki(reg);
  const enemyEntries = entries.filter((entry) => entry.section === "enemies");
  const html = wikiHtml(reg, entries, "enemies", "", null);
  assert.equal((html.match(/data-wiki-open="enemies\//g) ?? []).length, enemyEntries.length);
  const game = new Game(reg, 2026);
  game.start("fighter");
  const boss = [...reg.enemies.values()].find((enemy) => enemy.boss);
  assert.ok(boss, "expected world-boss definitions");
  const bossPage = pageHtml(reg, "enemies", String(boss!.id), game);
  assert.match(bossPage, /world boss/i);
  assert.match(bossPage, /lair/i);
  assert.match(bossPage, /World lair/);
});

test("wiki pages explain dungeon keepers, spells, statuses, upgrades, and character rules", () => {
  const game = new Game(reg, 2026);
  game.start("fighter");
  const dungeon = pageHtml(reg, "dungeons", "overview", game);
  assert.match(dungeon, new RegExp(`${DUNGEON_FLOORS} floors`));
  assert.match(dungeon, /keeper/i);
  const keeper = dungeonKeeper(game.seed, 0, reg.enemies.values());
  assert.ok(keeper, "there is no eligible dungeon keeper");
  assert.ok(pageHtml(reg, "dungeons", "entrance-0", game).includes(keeper!.name ?? String(keeper!.id)));
  const spell = [...reg.spells.keys()][0]!;
  assert.match(pageHtml(reg, "spells", spell), /Mana/);
  const status = [...reg.statuses.keys()][0]!;
  assert.match(pageHtml(reg, "statuses", status), /Duration/);
  const upgrade = [...reg.upgrades.keys()][0]!;
  assert.match(pageHtml(reg, "upgrades", upgrade), /Choice group/);
  assert.match(pageHtml(reg, "rules", "attributes"), /Modifier/);
  assert.ok(searchWiki(indexWiki(reg), "resistance").some((entry) => entry.id === "resistances"));
});
