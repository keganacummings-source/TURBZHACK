/**
 * "Was this file run directly, or imported?"
 *
 * The obvious way to write this is wrong on Windows, and wrong SILENTLY, which
 * is the worst way for a build script to be wrong:
 *
 *     if (import.meta.url === `file://${process.argv[1]}`)   // ✗
 *
 * On Linux that compares `file:///home/me/tools/x.mjs` with itself and works.
 * On Windows `process.argv[1]` is `D:\a\repo\tools\x.mjs`, so the template
 * builds `file://D:\a\repo\tools\x.mjs` while `import.meta.url` is
 * `file:///D:/a/repo/tools/x.mjs` — different slashes, different number of
 * them, no match. The script imports cleanly, does nothing, and exits 0.
 *
 * That is exactly what happened: `npm run build:web` "succeeded" on the Windows
 * runner without staging anything, and the build failed two steps later with
 * "Unable to find your web assets".
 *
 * Comparing resolved PATHS instead does the conversion properly on both.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * True when `metaUrl` names the script Node was asked to run.
 *
 * Compares PATHS rather than URLs. Both directions of the conversion are
 * platform-aware — `fileURLToPath` turns `file:///D:/a/x.mjs` into
 * `D:\a\x.mjs` on Windows and `resolve` normalises argv[1] the same way —
 * so the two meet in the middle whatever the platform, which string-building a
 * URL by hand never does.
 *
 * `argv1` is a parameter so tests can pass a path in rather than depending on
 * how the test runner happened to be invoked.
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return resolve(fileURLToPath(metaUrl)) === resolve(argv1);
  } catch {
    return false;
  }
}
