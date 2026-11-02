/**
 * The things that only break when you package the game.
 *
 * The first Windows build failed on exactly one line of config, ten minutes
 * into CI, for a reason nothing local could have noticed:
 *
 *     The configured frontendDist includes the `["src-tauri\target",
 *     "node_modules", "src-tauri"]` folders.
 *
 * `frontendDist` pointed at the repository root, so Tauri was being asked to
 * pack node_modules and its own build output into the installer. These tests
 * check the packaging rules locally and in seconds, including the icon set,
 * which would have been the very next failure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
  build: { frontendDist: string };
  bundle: { icon: string[] };
  app: { windows: { label?: string }[] };
};

/** Where frontendDist resolves to, relative to src-tauri/ as Tauri reads it. */
const frontendDir = resolve(join(ROOT, "src-tauri"), conf.build.frontendDist);

test("frontendDist does not point at the repository root", () => {
  // The actual failure. Tauri refuses a folder containing any of these, and it
  // is right to: bundling target/ into the installer grows it every build.
  assert.notEqual(resolve(frontendDir), resolve(ROOT),
    "frontendDist is the repo root, which Tauri refuses");
  for (const bad of ["node_modules", "src-tauri", ".git"]) {
    assert.ok(!existsSync(join(frontendDir, bad)),
      `the folder Tauri bundles contains "${bad}"`);
  }
});

test("every icon the bundle config names actually exists", () => {
  // A missing icon is the next build failure after frontendDist, and it also
  // only shows up on the Windows runner.
  for (const rel of conf.bundle.icon) {
    const path = join(ROOT, "src-tauri", rel);
    assert.ok(existsSync(path), `bundle.icon names "${rel}", which is not in src-tauri/`);
  }
  assert.ok(conf.bundle.icon.some((i) => i.endsWith(".ico")),
    "a Windows build needs an .ico in bundle.icon");
});

test("the capability targets a window that exists", () => {
  // Tauri v2 matches capabilities to windows by label. A capability pointing at
  // a window that is not there means the webview silently has no permissions.
  const capDir = join(ROOT, "src-tauri/capabilities");
  assert.ok(existsSync(capDir), "Tauri v2 needs src-tauri/capabilities/");
  const labels = new Set(conf.app.windows.map((w) => w.label).filter(Boolean));
  for (const file of readdirSync(capDir)) {
    if (!file.endsWith(".json")) continue;
    const cap = JSON.parse(readFileSync(join(capDir, file), "utf8")) as { windows?: string[] };
    for (const want of cap.windows ?? []) {
      assert.ok(labels.has(want), `${file} targets the window "${want}", which no window is labelled`);
    }
  }
});

test("staging produces every file index.html asks for", async () => {
  // Only meaningful once the game has been built; skipped otherwise so that a
  // fresh clone running `npm test` is not a wall of failures.
  if (!existsSync(join(ROOT, "dist"))) {
    console.log("  (skipped: run `npm run build:web` first)");
    return;
  }
  const { stageWeb } = await import("../tools/stage-web.mjs");
  const prev = process.cwd();
  process.chdir(ROOT);
  try {
    const { out } = await stageWeb("dist-web");

    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    // Every local path the page references must be in the staged folder, at the
    // same relative path — a staged copy that loads in the browser but not in
    // the .exe is the exact class of bug this is here to stop.
    const refs = [
      // <link href="..."> and <script src="...">
      ...[...html.matchAll(/(?:src|href)="\.?\/?([^":]+?)"/g)].map((m) => m[1]!),
      // and the module the inline <script type="module"> imports, which is how
      // the game is actually loaded — missing it here was why the first cut of
      // this test passed while checking almost nothing.
      ...[...html.matchAll(/from\s+"\.?\/?([^":]+?)"/g)].map((m) => m[1]!),
    ].filter((p) => !p.startsWith("http"));
    assert.ok(refs.length >= 2, `index.html references suspiciously few files: ${refs.join(", ")}`);
    assert.ok(refs.some((r) => r.endsWith(".js")), "no script found in index.html");
    assert.ok(refs.some((r) => r.endsWith(".css")), "no stylesheet found in index.html");
    for (const ref of refs) {
      assert.ok(existsSync(join(out, ref)), `index.html loads "${ref}", which is not staged`);
    }

    // And the content the loader fetches at runtime.
    assert.ok(existsSync(join(out, "content/index.json")), "the content index is not staged");
    const index = JSON.parse(readFileSync(join(out, "content/index.json"), "utf8")) as Record<string, string[]>;
    for (const [kind, stems] of Object.entries(index)) {
      for (const stem of stems) {
        assert.ok(existsSync(join(out, "content", kind, `${stem}.json`)),
          `the index lists ${kind}/${stem}.json, which is not staged`);
      }
    }
    assert.ok(readdirSync(join(out, "assets/tiles16")).length > 20, "the art is not staged");
  } finally {
    process.chdir(prev);
  }
});

test("the workflow builds the staged folder before packaging", () => {
  // The two steps have to stay in that order, and a reordered workflow is not
  // something any other test would notice.
  const yml = readFileSync(join(ROOT, ".github/workflows/build.yml"), "utf8");
  const staged = yml.indexOf("npm run build:web");
  const packaged = yml.indexOf("npx tauri build");
  assert.ok(staged > 0, "the workflow never stages the web game");
  assert.ok(packaged > 0, "the workflow never builds the executable");
  assert.ok(staged < packaged, "the workflow packages the app before building what it packages");
});

test("a build script knows it was run directly, on Windows too", async () => {
  /*
   * The bug this guards against cost a whole CI run and produced no error.
   *
   *   import.meta.url === `file://${process.argv[1]}`
   *
   * is true on Linux and false on Windows — argv[1] there is `D:\a\x.mjs`, so
   * the template makes `file://D:\a\x.mjs` while import.meta.url is
   * `file:///D:/a/x.mjs`. Both `npm run stage` and the content indexer imported
   * cleanly, did nothing, and exited 0; the build failed two steps later with
   * "Unable to find your web assets".
   */
  const { isMain } = await import("../tools/is-main.mjs");
  const { pathToFileURL, fileURLToPath } = await import("node:url");

  /*
   * Windows semantics cannot be faked from Linux — `pathToFileURL("D:\\a")`
   * here produces a relative path, not a drive letter. So this tests the real
   * round-trip on whatever platform is running it, which means the Windows
   * runner proves the Windows case for us on every push.
   */
  const realFile = join(ROOT, "tools/stage-web.mjs");
  const realUrl = pathToFileURL(realFile).href;
  assert.equal(isMain(realUrl, realFile), true,
    "a script's own path did not match its own file URL");
  assert.equal(fileURLToPath(realUrl), realFile, "the URL round-trip is lossy on this platform");

  // It still says no when the file was merely imported by another script.
  assert.equal(isMain(realUrl, join(ROOT, "tools/serve.mjs")), false);
  assert.equal(isMain(realUrl, undefined), false);
});

test("no build script uses the naive entrypoint check", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = join(ROOT, "tools");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mjs")) continue;
    // is-main.mjs is the fix; its header quotes the broken pattern on purpose.
    if (file === "is-main.mjs") continue;
    const src = readFileSync(join(dir, file), "utf8");
    assert.ok(!src.includes("file://${process.argv[1]}"),
      `tools/${file} uses the entrypoint check that silently does nothing on Windows — use isMain()`);
  }
});
