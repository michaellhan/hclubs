// Preview the static export (`out/`) the way a static host serves it: directory URLs
// resolve to index.html, missing files get 404.html. Optional base path via
// NEXT_PUBLIC_BASE_PATH. Local preview only.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "..", "out");
const port = Number(process.env.PORT ?? 4173);
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (base) {
    if (!path.startsWith(base)) return send(res, 404, join(root, "404.html"));
    path = path.slice(base.length) || "/";
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) return send(res, 403, null);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith("/")) {
      res.writeHead(301, { location: `${base}${path}/` });
      return res.end();
    }
    file = join(file, "index.html");
  }
  if (!existsSync(file)) return send(res, 404, join(root, "404.html"));
  send(res, 200, file);
}).listen(port, "127.0.0.1", () => console.log(`Static preview: http://127.0.0.1:${port}${base}/`));

function send(res, status, file) {
  if (!file || !existsSync(file)) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}
