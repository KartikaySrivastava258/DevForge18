/**
 * The few GitHub REST calls the content editor needs, made with fetch (no SDK).
 * Endpoints and permissions were checked against docs.github.com — see ADR 0011.
 *
 * The token is sent only in the Authorization header to the configured API
 * origin; it is never logged, stored or returned to browsers.
 */
import type { GitHubSettings } from "../config.ts";

/** The REST API version shown on the docs pages checked for ADR 0011. */
export const GITHUB_API_VERSION = "2026-03-10";
const TIMEOUT_MS = 15_000;

export class GitHubError extends Error {
  /** HTTP status from GitHub, or 0 when GitHub could not be reached. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

export interface FileContent {
  sha: string;
  size: number;
  /** Decoded UTF-8 text, or undefined when GitHub did not inline it (files over 1 MB). */
  text: string | undefined;
}

/** Encode a repository path or branch name for a URL, keeping the "/" separators. */
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export class GitHubClient {
  private readonly settings: GitHubSettings;
  private readonly fetchImpl: typeof fetch;

  constructor(settings: GitHubSettings, fetchImpl: typeof fetch = fetch) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }

  private get repoPath(): string {
    return `/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.settings.apiUrl}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.settings.token}`,
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": "DevForge-content-editor",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GitHubError(0, "GitHub could not be reached.");
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = (data as { message?: unknown } | null)?.message;
      throw new GitHubError(res.status, typeof message === "string" ? message.slice(0, 300) : `HTTP ${res.status}`);
    }
    return data as T;
  }

  /** GET /repos/{owner}/{repo} — needs Metadata: read. */
  async defaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch?: unknown }>("GET", this.repoPath);
    if (typeof repo.default_branch !== "string" || !repo.default_branch) throw new GitHubError(502, "GitHub did not report a default branch.");
    return repo.default_branch;
  }

  /** GET /repos/{owner}/{repo}/git/ref/heads/{branch} — the commit the branch points to. */
  async branchSha(branch: string): Promise<string> {
    const ref = await this.request<{ object?: { sha?: unknown } }>("GET", `${this.repoPath}/git/ref/heads/${encodePath(branch)}`);
    const sha = ref.object?.sha;
    if (typeof sha !== "string") throw new GitHubError(502, "GitHub returned a reference without a commit.");
    return sha;
  }

  /** GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1 — every file on the branch. */
  async tree(branch: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const tree = await this.request<{ tree?: TreeEntry[]; truncated?: boolean }>(
      "GET",
      `${this.repoPath}/git/trees/${encodePath(branch)}?recursive=1`,
    );
    return { entries: Array.isArray(tree.tree) ? tree.tree : [], truncated: tree.truncated === true };
  }

  /** GET /repos/{owner}/{repo}/contents/{path}?ref={branch} */
  async file(path: string, ref: string): Promise<FileContent> {
    const f = await this.request<{ type?: unknown; sha?: unknown; size?: unknown; content?: unknown; encoding?: unknown }>(
      "GET",
      `${this.repoPath}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (f.type !== "file" || typeof f.sha !== "string") throw new GitHubError(404, "Not a file.");
    const size = typeof f.size === "number" ? f.size : 0;
    const text = f.encoding === "base64" && typeof f.content === "string" ? Buffer.from(f.content, "base64").toString("utf8") : undefined;
    return { sha: f.sha, size, text };
  }

  /** POST /repos/{owner}/{repo}/git/refs — create a branch at a commit. */
  async createBranch(branch: string, sha: string): Promise<void> {
    await this.request("POST", `${this.repoPath}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** PUT /repos/{owner}/{repo}/contents/{path} — commit a new version of one existing file on a branch. */
  async updateFile(input: { path: string; branch: string; message: string; text: string; sha: string }): Promise<string> {
    const r = await this.request<{ commit?: { sha?: unknown } }>("PUT", `${this.repoPath}/contents/${encodePath(input.path)}`, {
      message: input.message,
      content: Buffer.from(input.text, "utf8").toString("base64"),
      sha: input.sha,
      branch: input.branch,
    });
    return typeof r.commit?.sha === "string" ? r.commit.sha : "";
  }

  /** POST /repos/{owner}/{repo}/pulls */
  async openPullRequest(input: { title: string; head: string; base: string; body: string }): Promise<{ url: string; number: number }> {
    const pr = await this.request<{ html_url?: unknown; number?: unknown }>("POST", `${this.repoPath}/pulls`, input);
    if (typeof pr.html_url !== "string" || typeof pr.number !== "number") throw new GitHubError(502, "GitHub did not return the pull request.");
    return { url: pr.html_url, number: pr.number };
  }
}
