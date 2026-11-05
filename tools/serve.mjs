/**
 * A dev server with no dependencies.
 *
 * Compiles nothing and bundles nothing — it serves the folder, and regenerates
 * content/index.json on every request for it, so adding an enemy file is: save
 * the file, reload the page.
 *
 *     node tools/serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { writeIndex } from "./index-content.mjs";

const ROOT = resolve(process.cwd());
const PORT = (() => {
  const arg = process.argv.find(a => /^\d+$/.test(a));
  return arg ? Number(arg) : 8099;
})();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ogg": "audio/ogg",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";

    // Keep requests inside the project folder.
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end("no"); return; }

    // The content index is rebuilt on demand, so a file you just added is seen.
    if (path === "/content/index.json") {
      const index = writeIndex(join(ROOT, "content"));
      res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(index));
      return;
    }

    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end("missing"); return; }

    const body = await readFile(full);
    const type = TYPES[extname(full)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
