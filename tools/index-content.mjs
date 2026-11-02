/**
 * Writes content/index.json: the list of files in each content folder.
 *
 * A web page cannot list a directory, so the loader needs an index to know what
 * is there. This regenerates it. `npm run serve` does it on every request, so
 * during development you add a file and reload; run it by hand before building
 * a release.
 *
 *     node tools/index-content.mjs [contentDir]
 */
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "./is-main.mjs";

/*
 * Must match CONTENT_KINDS in src/content/schema.ts.
 *
 * It is duplicated because this is a plain .mjs build script and that is a .ts
 * module, and a build tool that needs compiling to run is a build tool that
 * cannot run before the build. scripts/content.test.mts asserts the two lists
 * are identical — adding "upgrades" to one and not the other meant the whole
 * upgrade folder silently never loaded in the browser.
 */
const KINDS = [
  "species", "classes", "enemies", "spells", "abilities", "enchantments", "statuses", "tiles", "items", "upgrades",
];

export function buildIndex(dir) {
  const index = {};
  for (const kind of KINDS) {
    const folder = join(dir, kind);
    if (!existsSync(folder)) continue;
    const stems = readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
    if (stems.length) index[kind] = stems;
  }
  return index;
}

export function writeIndex(dir = "content") {
  const index = buildIndex(dir);
  writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

if (isMain(import.meta.url)) {
  const dir = process.argv[2] ?? "content";
  const index = writeIndex(dir);
  const total = Object.values(index).reduce((n, list) => n + list.length, 0);
  console.log(`indexed ${total} files in ${dir}/index.json`);
  for (const [kind, list] of Object.entries(index)) console.log(`  ${kind}: ${list.length}`);
}
