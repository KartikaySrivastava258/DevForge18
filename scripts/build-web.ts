/**
 * Bundles the React frontend with esbuild into build/web:
 *   assets/app-<hash>.js, assets/app-<hash>.css, index.html, and web/public/*.
 * Hashed names let the server cache assets forever ("immutable") while
 * index.html is always revalidated.
 *
 *   npm run web:build            production build (minified)
 *   WEB_DEV=1 npm run web:build  readable output with source maps
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "web");
const dev = process.env.WEB_DEV === "1";

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
cpSync(join(root, "web", "public"), out, { recursive: true });

const result = await build({
  entryPoints: { app: join(root, "web", "src", "main.tsx"), styles: join(root, "web", "src", "styles", "index.css") },
  outdir: join(out, "assets"),
  entryNames: "[name]-[hash]",
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome110", "firefox115", "safari16"],
  jsx: "automatic",
  minify: !dev,
  sourcemap: dev,
  metafile: true,
  legalComments: "linked",
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  logLevel: "warning",
});

const outputs = Object.keys(result.metafile.outputs);
const js = outputs.find((f) => /assets\/app-[^/]+\.js$/.test(f));
const css = outputs.find((f) => /assets\/styles-[^/]+\.css$/.test(f));
if (!js || !css) throw new Error("build did not produce the expected app JS and CSS");

const html = readFileSync(join(root, "web", "index.html"), "utf8")
  .replace("%JS%", `/assets/${basename(js)}`)
  .replace("%CSS%", `/assets/${basename(css)}`);
writeFileSync(join(out, "index.html"), html);

const size = (f: string) => `${(result.metafile.outputs[f]!.bytes / 1024).toFixed(1)} KB`;
console.log(`Web build OK${dev ? " (dev)" : ""}: ${basename(js)} ${size(js)}, ${basename(css)} ${size(css)} → ${out}`);
