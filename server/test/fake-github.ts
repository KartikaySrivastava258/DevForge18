/**
 * A small in-memory stand-in for the GitHub REST endpoints the content editor
 * uses (ADR 0011), served by node:http so API and browser tests never reach
 * GitHub. It enforces the same rules the editor relies on: a bearer token,
 * branch creation from an existing commit, and contents updates that must name
 * the blob SHA they replace.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { GitHubSettings } from "../src/config.ts";

const repoRoot = join(import.meta.dirname, "..", "..");

export interface FakeFile {
  text: string;
  sha: string;
}
export interface FakeRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  apiVersion: string | undefined;
  body: unknown;
}
export interface FakePullRequest {
  number: number;
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface FakeGitHub {
  url: string;
  settings: GitHubSettings;
  requests: FakeRequest[];
  /** branch name → files on that branch. */
  branches: Map<string, Map<string, FakeFile>>;
  pulls: FakePullRequest[];
  /** Answer the next request whose "METHOD path" starts with `prefix` with this status. */
  failNext: (prefix: string, status: number, message?: string) => void;
  /** Change a file on main, as if someone merged another pull request. */
  commitOnMain: (path: string, text: string) => void;
  close: () => Promise<void>;
}

export const FAKE_FILES = [
  "content/lessons/git-github/git-first-commits.md",
  "content/case-studies/docker-shopify.yaml",
  "content/quizzes/git-github/git-github-quiz.yaml",
];

const blobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
const commitSha = (seed: string) => createHash("sha1").update(`commit ${seed}`).digest("hex");

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export async function startFakeGitHub(options: { owner?: string; repo?: string; token?: string } = {}): Promise<FakeGitHub> {
  const owner = options.owner ?? "devforge-test";
  const repo = options.repo ?? "devforge18";
  const token = options.token ?? "test-token-not-a-secret";
  const main = new Map<string, FakeFile>();
  for (const path of FAKE_FILES) {
    const text = readFileSync(join(repoRoot, path), "utf8");
    main.set(path, { text, sha: blobSha(text) });
  }
  // Files the editor must not offer: no schema for them, or outside content/.
  for (const [path, text] of [
    ["content/projects/docker/docker-notes-api/starter/README.md", "# Starter\n"],
    [".github/workflows/ci.yml", "name: ci\n"],
    ["content/media/docker/layers.svg", "<svg/>"],
  ] as const) {
    main.set(path, { text, sha: blobSha(text) });
  }
  const branches = new Map<string, Map<string, FakeFile>>([["main", main]]);
  const heads = new Map<string, string>([["main", commitSha("initial")]]);
  const requests: FakeRequest[] = [];
  const pulls: FakePullRequest[] = [];
  let failure: { prefix: string; status: number; message: string } | undefined;
  const base = `/repos/${owner}/${repo}`;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const path = decodeURIComponent(url.pathname);
      const method = req.method ?? "GET";
      const body = await readBody(req).catch(() => "invalid json");
      requests.push({
        method,
        path: `${path}${url.search}`,
        authorization: req.headers.authorization,
        apiVersion: req.headers["x-github-api-version"] as string | undefined,
        body,
      });
      const send = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(data));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "Bad credentials" });
      if (failure && `${method} ${path}`.startsWith(failure.prefix)) {
        const f = failure;
        failure = undefined;
        return send(f.status, { message: f.message });
      }

      if (method === "GET" && path === base) return send(200, { full_name: `${owner}/${repo}`, default_branch: "main" });

      let m = /^\/git\/ref\/heads\/(.+)$/.exec(path.slice(base.length));
      if (method === "GET" && path.startsWith(base) && m) {
        const sha = heads.get(m[1] ?? "");
        return sha ? send(200, { ref: `refs/heads/${m[1]}`, object: { type: "commit", sha } }) : send(404, { message: "Not Found" });
      }
      m = /^\/git\/trees\/(.+)$/.exec(path.slice(base.length));
      if (method === "GET" && path.startsWith(base) && m) {
        const files = branches.get(m[1] ?? "");
        if (!files || url.searchParams.get("recursive") === null) return send(404, { message: "Not Found" });
        const tree = [
          { path: "content", mode: "040000", type: "tree", sha: commitSha("tree") },
          ...[...files].map(([p, f]) => ({ path: p, mode: "100644", type: "blob", sha: f.sha, size: Buffer.byteLength(f.text) })),
        ];
        return send(200, { sha: commitSha("tree"), truncated: false, tree });
      }
      m = /^\/contents\/(.+)$/.exec(path.slice(base.length));
      if (path.startsWith(base) && m) {
        const filePath = m[1] ?? "";
        if (method === "GET") {
          const file = branches.get(url.searchParams.get("ref") ?? "main")?.get(filePath);
          if (!file) return send(404, { message: "Not Found" });
          // GitHub wraps the base64 content in lines of 60 characters.
          const content = Buffer.from(file.text).toString("base64").replace(/.{60}/g, "$&\n");
          return send(200, { type: "file", path: filePath, sha: file.sha, size: Buffer.byteLength(file.text), encoding: "base64", content });
        }
        if (method === "PUT") {
          const b = body as { message?: string; content?: string; sha?: string; branch?: string };
          const files = branches.get(b.branch ?? "main");
          if (!files || !b.message || typeof b.content !== "string") return send(422, { message: "Invalid request." });
          const existing = files.get(filePath);
          if (existing && existing.sha !== b.sha) return send(409, { message: `${filePath} does not match ${b.sha}` });
          const text = Buffer.from(b.content, "base64").toString("utf8");
          files.set(filePath, { text, sha: blobSha(text) });
          const commit = commitSha(`${b.branch}:${filePath}:${text}`);
          heads.set(b.branch ?? "main", commit);
          return send(existing ? 200 : 201, { content: { path: filePath, sha: blobSha(text) }, commit: { sha: commit } });
        }
      }
      if (method === "POST" && path === `${base}/git/refs`) {
        const b = body as { ref?: string; sha?: string };
        const name = /^refs\/heads\/(.+)$/.exec(b.ref ?? "")?.[1];
        if (!name || !b.sha) return send(422, { message: "Invalid request." });
        if (heads.has(name)) return send(422, { message: "Reference already exists" });
        const from = [...heads].find(([, sha]) => sha === b.sha)?.[0];
        if (!from) return send(422, { message: "Object does not exist" });
        heads.set(name, b.sha);
        branches.set(name, new Map(branches.get(from)));
        return send(201, { ref: b.ref, object: { type: "commit", sha: b.sha } });
      }
      if (method === "POST" && path === `${base}/pulls`) {
        const b = body as { title?: string; head?: string; base?: string; body?: string };
        if (!b.title || !b.head || !b.base || !heads.has(b.head) || !heads.has(b.base)) return send(422, { message: "Validation Failed" });
        const number = pulls.length + 1;
        pulls.push({ number, title: b.title, head: b.head, base: b.base, body: b.body ?? "" });
        return send(201, { number, html_url: `https://github.example/${owner}/${repo}/pull/${number}`, state: "open" });
      }
      return send(404, { message: "Not Found" });
    })().catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    settings: { owner, repo, token, apiUrl: url },
    requests,
    branches,
    pulls,
    failNext: (prefix, status, message = "Simulated failure") => {
      failure = { prefix, status, message };
    },
    commitOnMain: (path, text) => {
      main.set(path, { text, sha: blobSha(text) });
      heads.set("main", commitSha(`main:${path}:${text}`));
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
