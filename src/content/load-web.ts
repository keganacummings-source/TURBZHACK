/**
 * Loading content in the browser.
 *
 * The registry does not care where files come from, so this is the only piece
 * that knows about fetch. It reads `content/index.json` — a plain list of file
 * names per folder — because a web page cannot list a directory, and then
 * fetches each file.
 *
 * `tools/index-content.mjs` regenerates that index, and `npm run serve` does it
 * on every request, so during development you drop a file in and reload. The
 * index exists only because of the browser's limits; nothing else uses it, and
 * the tests read the folder directly.
 */
import { Registry, type ContentSource } from "./registry.ts";
import { CONTENT_KINDS, type ContentKind } from "./schema.ts";

export type ContentIndex = Partial<Record<ContentKind, string[]>>;

/**
 * Fetch one source folder.
 *
 * A file that 404s or contains broken JSON is reported through the registry's
 * problem list rather than thrown, so one bad mod file cannot stop the game
 * from starting.
 */
export async function fetchSource(base: string, name: string): Promise<ContentSource> {
  const files: ContentSource["files"] = {};
  let index: ContentIndex = {};
  try {
    const res = await fetch(`${base}/index.json`, { cache: "no-cache" });
    if (res.ok) index = (await res.json()) as ContentIndex;
  } catch {
    // No index: an empty source rather than a failure, so a missing mod folder
    // is simply a mod that is not installed.
    return { name, files };
  }

  for (const kind of CONTENT_KINDS) {
    const stems = index[kind];
    if (!stems?.length) continue;
    const bucket: Record<string, unknown> = {};
    await Promise.all(stems.map(async (stem) => {
      try {
        const res = await fetch(`${base}/${kind}/${stem}.json`, { cache: "no-cache" });
        bucket[stem] = res.ok
          ? await res.json()
          : { __loadError: `HTTP ${res.status}` };
      } catch (err) {
        bucket[stem] = { __loadError: String(err) };
      }
    }));
    files[kind] = bucket;
  }
  return { name, files };
}

/**
 * Load the base game and any mods, in order.
 *
 * Later sources win on id, so a mod that ships `enemies/goblin.json` replaces
 * the base goblin without anybody editing the original file.
 */
export async function loadContent(sources: { base: string; name: string }[] = [{ base: "content", name: "base" }]): Promise<Registry> {
  const reg = new Registry();
  for (const s of sources) reg.add(await fetchSource(s.base, s.name));
  reg.checkReferences();
  return reg;
}

/** Every sprite key the loaded content can ask for, so they can be preloaded. */
export function spriteKeys(reg: Registry): string[] {
  const keys = new Set<string>();
  for (const map of [reg.tiles, reg.enemies, reg.classes, reg.items]) {
    for (const def of map.values()) if (def.sprite) keys.add(def.sprite);
  }
  return [...keys];
}
