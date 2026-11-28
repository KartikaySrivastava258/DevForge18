/**
 * The location-matcher model against a real Nginx (REMAINING_WORK.md §5.14: "Unit-test the model against real
 * Nginx in CI by generating configurations and comparing which block answers").
 *
 * A seeded generator writes server blocks — exact "=", prefix, "^~" and regular-expression "~" / "~*" locations
 * in random orders with overlapping patterns, plus server blocks built from the simulation's own palette with
 * the model's "add" rules — and request paths aimed at those patterns (with case changes, "//", "." and ".."
 * segments). Each location answers `return 200 "block-N"`; one Nginx container serves every server block (one
 * server_name each), and every path is sent to it. The model must pick the same block for every path, and say
 * 404 or 400 exactly when Nginx does. Nginx is the truth: a disagreement is a bug in the model.
 *
 * The image is the one deploy/docker-compose.yml pins, read from that file so the two never drift apart.
 * Needs DEVFORGE_DOCKER_TEST=1 and a Docker engine (CI: the "Executed lessons" job, shard 1, whenever the model
 * may have changed — scripts/lib/affected.ts). DEVFORGE_NGINX_SEED=<n> tries another seed locally.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Agent, request } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { dockerTestingEnabled } from "../../../scripts/lib/lesson-runner.ts";
import { label, locationMatcher, matchLocations, normalizeUri, PALETTE, PATH, type LocationDef, type MatcherState, type Modifier } from "./location-matcher.ts";

const SEED = Number(process.env.DEVFORGE_NGINX_SEED ?? "20261128");
const GENERATED_CONFIGS = 140;
const PALETTE_CONFIGS = 60;
const PATHS_PER_CONFIG = 24;

/** Required in CI: there, a missing Docker engine must fail the run instead of skipping the comparison. */
const required = process.env.DEVFORGE_NGINX_COMPARE_REQUIRED === "1";
const enabled = dockerTestingEnabled();

function composeNginxImage(): string {
  const compose = readFileSync(join(import.meta.dirname, "..", "..", "..", "deploy", "docker-compose.yml"), "utf8");
  const image = /^\s*image:\s*(nginx:\S+@sha256:[0-9a-f]{64})\s*$/m.exec(compose)?.[1];
  assert.ok(image, "deploy/docker-compose.yml pins an nginx image by digest");
  return image;
}

/** mulberry32: a small, well-known seeded generator, so a failure can be reproduced from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Generated {
  name: string;
  defs: LocationDef[];
  paths: string[];
}

const WORDS = ["api", "v1", "v2", "docs", "static", "img", "health", "a", "ab", "b"];
const EXTENSIONS = ["", "", "", ".html", ".png", ".PNG", ".json", ".jpg", ".JPEG", ".gif"];
/** Regular expressions written in the subset where PCRE (Nginx) and JavaScript agree. */
const REGEXES = ["\\.html$", "\\.png$", "\\.(gif|jpg|jpeg)$", "^/api/.*\\.json$", "\\.json$", "^/api/v[0-9]+/", "/docs/", "^/static/", "^/a", "b$", "^/(api|static)/[a-z]+$", "img"];

function generator(seed: number) {
  const random = rng(seed);
  const int = (n: number) => Math.floor(random() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number) => random() < p;

  const segments = (min: number, max: number) => Array.from({ length: min + int(max - min + 1) }, () => pick(WORDS));
  const prefixPattern = () => {
    if (chance(0.12)) return "/";
    const s = `/${segments(1, 3).join("/")}`;
    return chance(0.6) ? `${s}/` : s;
  };

  function generatedDefs(): LocationDef[] {
    const defs: LocationDef[] = [];
    const count = 1 + int(9);
    for (let tries = 0; defs.length < count && tries < 50; tries++) {
      const modifier = pick<Modifier>(["=", "", "", "^~", "~", "~*"]);
      const pattern = modifier === "~" || modifier === "~*" ? pick(REGEXES) : prefixPattern();
      // Nginx refuses two "=" locations, or two prefix locations ("" and "^~" alike), with the same pattern
      // ("duplicate location"); regular expressions are kept unique too so every block is reachable in principle.
      const kind = (m: Modifier) => (m === "=" ? "=" : m === "" || m === "^~" ? "prefix" : "regex");
      if (defs.some((d) => d.pattern === pattern && kind(d.modifier) === kind(modifier))) continue;
      defs.push({ id: `block-${defs.length}`, modifier, pattern, target: "app" });
    }
    return defs;
  }

  /** A server block a learner could build: palette locations added in a random order through the model's own rules. */
  function paletteDefs(): LocationDef[] {
    let state: MatcherState = locationMatcher.init({ locations: [] }).state;
    const want = 1 + int(10);
    for (let tries = 0; state.locations.length < want && tries < 40; tries++) {
      const r = locationMatcher.step(state, { type: "add", id: pick(PALETTE).id });
      if (!r.error) state = r.state;
    }
    return state.locations.map((id, i) => ({ ...PALETTE.find((l) => l.id === id)!, id: `block-${i}` }));
  }

  const flipCase = (s: string) => [...s].map((c) => (chance(0.3) ? (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) : c)).join("");
  const tail = () => `${segments(0, 2).join("/")}${chance(0.5) ? `/${pick(WORDS)}${pick(EXTENSIONS)}` : pick(EXTENSIONS)}`;

  /** Adds "//", "." or ".." segments (sometimes climbing above the root) after a random slash, or at the end. */
  function messUp(path: string): string {
    if (chance(0.2)) return `${path.replace(/\/$/, "")}${pick(["/.", "/..", "/../.."])}`;
    const at = pick([...path.matchAll(/\//g)].map((m) => m.index));
    return `${path.slice(0, at + 1)}${pick(["/", "./", `${pick(WORDS)}/../`, "../", "../../"])}${path.slice(at + 1)}`;
  }

  function pathsFor(defs: LocationDef[]): string[] {
    const paths = new Set<string>(["/"]);
    const literal = defs.filter((d) => d.modifier === "=" || d.modifier === "" || d.modifier === "^~").map((d) => d.pattern);
    for (let tries = 0; paths.size < PATHS_PER_CONFIG && tries < 400; tries++) {
      let p: string;
      const roll = random();
      if (literal.length && roll < 0.2) p = pick(literal); // exactly a pattern
      else if (literal.length && roll < 0.3) p = pick(literal).replace(/\/$/, ""); // the pattern without its slash
      else if (literal.length && roll < 0.6) p = `${pick(literal)}${tail()}`; // below a prefix
      else p = `/${segments(1, 3).join("/")}${pick(EXTENSIONS)}`;
      if (chance(0.15)) p = flipCase(p);
      if (chance(0.15)) p = messUp(p);
      if (!p.startsWith("/")) p = `/${p}`;
      if (PATH.test(p)) paths.add(p);
    }
    return [...paths];
  }

  return {
    configs(): Generated[] {
      const out: Generated[] = [];
      for (let i = 0; i < GENERATED_CONFIGS + PALETTE_CONFIGS; i++) {
        const defs = i < GENERATED_CONFIGS ? generatedDefs() : paletteDefs();
        out.push({ name: `c${i}`, defs, paths: pathsFor(defs) });
      }
      return out;
    },
  };
}

function nginxConfig(configs: Generated[]): string {
  const blocks = configs.map(
    (c) =>
      `server {\n  listen 80;\n  server_name ${c.name};\n  root /nonexistent;\n${c.defs
        .map((d) => `  location ${d.modifier ? `${d.modifier} ` : ""}${d.pattern} { return 200 "${d.id}"; }`)
        .join("\n")}\n}\n`,
  );
  // Requests for an unknown host must not land in a generated block by accident.
  return `server {\n  listen 80 default_server;\n  return 421;\n}\n${blocks.join("")}`;
}

const docker = (args: string[], input?: string | Buffer) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000, ...(input !== undefined ? { input } : {}) });

describe(
  "location matcher: agrees with a real Nginx on generated configurations",
  { skip: enabled ? false : required ? false : "needs DEVFORGE_DOCKER_TEST=1 and a Docker engine (runs in CI)" },
  () => {
    const name = `devforge-test-nginx-matcher-${process.pid}`;
    const configs = generator(SEED).configs();
    const image = composeNginxImage();
    let port = "";
    const agent = new Agent({ keepAlive: true, maxSockets: 16 });

    before(async () => {
      assert.ok(enabled, "DEVFORGE_NGINX_COMPARE_REQUIRED=1, but DEVFORGE_DOCKER_TEST=1 or a Docker engine is missing");
      docker(["rm", "-f", "-v", name]);
      const created = docker(["create", "--name", name, "-p", "127.0.0.1::80", image]);
      assert.equal(created.status, 0, created.stderr);
      // docker cp instead of a bind mount, so the test also works with a remote Docker engine.
      const copied = docker(["cp", "-", `${name}:/etc/nginx/conf.d/`], tarOf("default.conf", nginxConfig(configs)));
      assert.equal(copied.status, 0, copied.stderr);
      const started = docker(["start", name]);
      assert.equal(started.status, 0, started.stderr);
      port = /:(\d+)\s*$/m.exec(docker(["port", name, "80/tcp"]).stdout)?.[1] ?? "";
      assert.ok(port, `no published port; logs:\n${docker(["logs", name]).stderr}`);
      for (let i = 0; ; i++) {
        const r = await get("c0", "/").catch(() => null);
        if (r) break;
        assert.ok(i < 100, `Nginx did not answer; logs:\n${docker(["logs", name]).stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
    after(() => {
      agent.destroy();
      docker(["rm", "-f", "-v", name]);
    });

    function get(host: string, path: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: Number(port), path, method: "GET", headers: { host }, agent }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end();
      });
    }

    it(`runs ${image.split("@")[0]} with ${GENERATED_CONFIGS + PALETTE_CONFIGS} generated server blocks (seed ${SEED})`, () => {
      const version = docker(["exec", name, "nginx", "-v"]);
      assert.match(version.stderr, /nginx version: nginx\/1\.\d+\.\d+/);
      const total = configs.reduce((n, c) => n + c.paths.length, 0);
      assert.ok(total >= (GENERATED_CONFIGS + PALETTE_CONFIGS) * 20, `only ${total} paths generated`);
      const kinds = new Set(configs.flatMap((c) => c.defs.map((d) => d.modifier)));
      assert.deepEqual([...kinds].sort(), ["", "=", "^~", "~", "~*"], "every kind of location is generated");
    });

    it("the model picks the block Nginx answers from, for every generated path", async () => {
      const jobs = configs.flatMap((c) => c.paths.map((path) => ({ c, path })));
      const disagreements: string[] = [];
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const { c, path } = jobs[next++]!;
          const res = await get(c.name, path);
          const real = res.status === 200 ? res.body : String(res.status);
          const m = matchLocations(c.defs, path);
          const model = m.uri === null ? "400" : (m.location ?? "404");
          if (real !== model) {
            const locations = c.defs.map((d) => `${d.id}: ${label(d)}`).join("; ");
            disagreements.push(`${c.name} GET ${path} (normalised ${normalizeUri(path)}): nginx ${real}, model ${model}\n    ${locations}`);
          }
        }
      };
      await Promise.all(Array.from({ length: 16 }, worker));
      assert.deepEqual(disagreements, [], `seed ${SEED}: ${disagreements.length} of ${jobs.length} paths disagree:\n${disagreements.slice(0, 20).join("\n")}`);
    });

    it("refuses the same duplicate locations as nginx -t", () => {
      const pairs: [string, string][] = [
        ["api-docs", "api-docs-stop"],
        ["static-stop", "static"],
        ["exact-root", "root"],
        ["health", "api"],
      ];
      for (const [first, second] of pairs) {
        const a = PALETTE.find((l) => l.id === first)!;
        const b = PALETTE.find((l) => l.id === second)!;
        const conf = `events {}\nhttp {\n  server {\n    listen 8081;\n    location ${a.modifier} ${a.pattern} { return 200; }\n    location ${b.modifier} ${b.pattern} { return 200; }\n  }\n}\n`;
        const t = docker(["exec", "-i", name, "sh", "-c", "cat > /tmp/pair.conf && nginx -t -q -c /tmp/pair.conf"], conf);
        const modelRefuses = Boolean(locationMatcher.step(locationMatcher.init({ locations: [first] }).state, { type: "add", id: second }).error);
        assert.equal(modelRefuses, t.status !== 0, `${label(a)} then ${label(b)}: nginx -t ${t.status === 0 ? "accepts" : `refuses (${t.stderr.trim()})`}`);
        if (t.status !== 0) assert.match(t.stderr, /duplicate location/);
      }
    });
  },
);

/** A one-file POSIX tar archive (ustar), for `docker cp -` without writing temporary files. */
function tarOf(fileName: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  const put = (text: string, offset: number, length: number) => header.write(text, offset, length, "ascii");
  put(fileName, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  put(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, 12);
  put("        ", 148, 8);
  put("0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding, Buffer.alloc(1024, 0)]);
}
