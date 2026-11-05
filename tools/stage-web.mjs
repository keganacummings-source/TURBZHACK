/**
 * Copies the web game into dist-web/ — just the files it needs to run.
 *
 * This exists because Tauri bundles whatever folder `frontendDist` points at,
 * and pointing it at the repository root fails outright:
 *
 *     The configured frontendDist includes the `["src-tauri\target",
 *     "node_modules", "src-tauri"]` folders.
 *
 * Which is fair — bundling the repo root would mean packing node_modules and
 * Tauri's own build output into the installer, and the build output grows every
 * time you build. So the shippable files are staged into a clean folder with
 * their paths preserved exactly, and Tauri is pointed at that.
 *
 * The same folder is what the web artifact uploads, so the browser build and
 * the .exe are provably the same files.
 *
 *     node tools/stage-web.mjs [outDir]
 */
import { cp, mkdir, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isMain } from "./is-main.mjs";

/**
 * What goes in, as `source -> path inside dist-web`.
 *
 * The paths on the right MUST match what index.html asks for, or the staged
 * copy loads in the browser and breaks inside the .exe.
 */
const INCLUDE = [
  ["index.html", "index.html"],
  ["dist", "dist"],                 // compiled TypeScript
  ["assets", "assets"],             // 16x16 art
  ["content", "content"],           // every enemy, spell, class and tile
  ["src/ui/style.css", "src/ui/style.css"],
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

export async function stageWeb(outDir = "dist-web") {
  const root = resolve(process.cwd());
  const out = resolve(root, outDir);

  // Always from scratch: a stale file left in here would ship in the installer.
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const copied = [];
  for (const [from, to] of INCLUDE) {
    const src = join(root, from);
    if (!(await exists(src))) {
      throw new Error(
        `stage-web: "${from}" is missing. Run \`npm run build\` and ` +
        `\`node tools/index-content.mjs content\` first.`);
    }
    await cp(src, join(out, to), { recursive: true });
    copied.push(to);
  }
  return { out, copied };
}

if (isMain(import.meta.url)) {
  const { out, copied } = await stageWeb(process.argv[2]);
  console.log(`staged the web game into ${out}`);
  for (const c of copied) console.log(`  ${c}`);
}
