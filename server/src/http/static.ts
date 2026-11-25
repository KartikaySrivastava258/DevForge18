/**
 * Serves the built frontend from WEB_ROOT. In production Nginx serves these
 * files directly; this exists so `npm start` alone gives a working app.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

export function serveStatic(req: IncomingMessage, res: ServerResponse, webRoot: string, urlPath: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const root = resolve(webRoot);
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  if (decoded.includes("\0")) return false;

  const candidate = resolve(join(root, normalize(decoded)));
  const insideRoot = candidate === root || candidate.startsWith(root + sep);
  let file: string | undefined;
  if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
    file = candidate;
  } else if (extname(decoded) === "") {
    // Client-side route such as /tracks/docker → the single-page app shell.
    const index = join(root, "index.html");
    if (existsSync(index)) file = index;
  }
  if (!file) return false;

  const isHashedAsset = file.startsWith(join(root, "assets") + sep);
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
  res.setHeader("Content-Length", statSync(file).size);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
