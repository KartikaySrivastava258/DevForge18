/**
 * Content editor for faculty and admins (ADR 0011): pick a content file from
 * the repository's default branch, edit it, check it against its schema, and
 * submit it as a pull request. Review and CI still decide what is published.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, Loading, NotAllowedState } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { navigate } from "../lib/router.tsx";
import { useApi, useTitle } from "../lib/useApi.ts";

interface CmsStatus {
  enabled: boolean;
  repository?: string;
  reason?: string;
  maxBytes: number;
  kinds: { kind: string; label: string }[];
}
interface CmsFile {
  path: string;
  kind: string;
  size: number;
}
interface OpenFile {
  path: string;
  kind: string;
  label: string;
  defaultBranch: string;
  sha: string;
  content: string;
}
interface Submission {
  id: string;
  path: string;
  kind: string;
  title: string;
  branch: string;
  prUrl: string;
  prNumber: number;
  createdAt: string;
  author?: string | null;
}

const CROSS_FILE_NOTE =
  "Only this file is checked here. Checks that need other files — links between lessons, tracks and paths, figures, prerequisites — run in CI on the pull request.";

function Problems({ errors }: { errors: string[] }) {
  return (
    <div className="notice notice--danger" role="alert">
      <p>
        <strong>{errors.length === 1 ? "1 problem" : `${errors.length} problems`} found.</strong> Fix {errors.length === 1 ? "it" : "them"}, then check again.
      </p>
      <ul className="cms-errors">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

function FilePicker({ kinds, onOpen, busy }: { kinds: CmsStatus["kinds"]; onOpen: (path: string) => void; busy: boolean }) {
  const { data, error, loading, reload } = useApi<{ files: CmsFile[]; defaultBranch: string; truncated: boolean }>("/api/cms/files");
  const [kind, setKind] = useState("");
  const [filter, setFilter] = useState("");
  const [path, setPath] = useState("");
  const shown = useMemo(
    () => (data?.files ?? []).filter((f) => (!kind || f.kind === kind) && f.path.toLowerCase().includes(filter.trim().toLowerCase())),
    [data, kind, filter],
  );
  useEffect(() => {
    if (!shown.some((f) => f.path === path)) setPath(shown[0]?.path ?? "");
  }, [shown, path]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Loading label="Loading the list of content files" />;
  const label = (k: string) => kinds.find((x) => x.kind === k)?.label ?? k;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (path) onOpen(path);
      }}
      aria-label="Choose a content file"
    >
      <div className="filters">
        <div className="field">
          <label htmlFor="cms-kind">Type</label>
          <select id="cms-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cms-filter">Filter by path</label>
          <input id="cms-filter" className="input" type="search" value={filter} maxLength={200} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. git-first" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cms-file">File ({shown.length} of {data.files.length} on {data.defaultBranch})</label>
        <select id="cms-file" className="select" value={path} onChange={(e) => setPath(e.target.value)} disabled={shown.length === 0}>
          {shown.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path} ({label(f.kind)})
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn" disabled={!path || busy}>
        Open file
      </button>
    </form>
  );
}

function Editor({ file, maxBytes, onSubmitted }: { file: OpenFile; maxBytes: number; onSubmitted: (s: Submission) => void }) {
  const [content, setContent] = useState(file.content);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "danger"; text: string } | null>(null);
  const changed = content !== file.content;
  const bytes = new TextEncoder().encode(content).length;

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ valid: boolean; errors: string[] }>("/api/cms/validate", { method: "POST", body: { path: file.path, content } });
      setErrors(r.errors);
    } catch (err) {
      setErrors(null);
      setMessage({ kind: "danger", text: err instanceof ApiError ? err.message : "The check failed. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ submission: Submission }>("/api/cms/submissions", {
        method: "POST",
        body: { path: file.path, content, baseSha: file.sha, title, note },
      });
      setErrors(null);
      onSubmitted(r.submission);
    } catch (err) {
      if (err instanceof ApiError && err.code === "content_invalid") {
        setErrors(err.details.map((d) => d.message));
      } else {
        const field = err instanceof ApiError ? err.details.find((d) => d.field === "title" || d.field === "note") : undefined;
        setMessage({ kind: "danger", text: field ? `${field.field === "title" ? "Title" : "Note"}: ${field.message}` : err instanceof ApiError ? err.message : "Submitting failed. Try again." });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Edit the file" noValidate>
      <h2 id="edit-h">
        Editing <code>{file.path}</code>
      </h2>
      <p className="muted small">
        {file.label}. This copy comes from the <strong>{file.defaultBranch}</strong> branch of the repository, not from the version this site was built from.
      </p>
      <div className="field">
        <label htmlFor="cms-content">File content</label>
        <textarea
          id="cms-content"
          className="cms-editor"
          spellCheck={file.path.endsWith(".md")}
          value={content}
          aria-describedby="cms-content-hint"
          aria-invalid={errors && errors.length > 0 ? true : undefined}
          onChange={(e) => {
            setContent(e.target.value);
            setErrors(null);
          }}
        />
        <p className="field__hint" id="cms-content-hint">
          {(bytes / 1024).toFixed(1)} KB of {maxBytes / 1024} KB. {file.path.endsWith(".md") ? "YAML front matter between the --- lines, then Markdown." : "YAML."}
        </p>
      </div>
      <div className="adr__actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
          Check for errors
        </button>
      </div>
      <div aria-live="polite">
        {errors && errors.length > 0 ? <Problems errors={errors} /> : null}
        {errors && errors.length === 0 ? (
          <div className="notice notice--ok" role="status">
            <p>
              <strong>No problems found in this file.</strong> {CROSS_FILE_NOTE}
            </p>
          </div>
        ) : null}
      </div>

      <h2>Submit for review</h2>
      <div className="field">
        <label htmlFor="cms-title">Title of the change</label>
        <input id="cms-title" className="input" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clarify the staging-area explanation" />
      </div>
      <div className="field">
        <label htmlFor="cms-note">Note for reviewers (optional)</label>
        <textarea id="cms-note" className="input cms-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {message ? (
        <div className={`notice notice--${message.kind}`} role="alert">
          <p>{message.text}</p>
        </div>
      ) : null}
      <div className="adr__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !changed || title.trim().length < 5}>
          {busy ? "Working…" : "Open pull request"}
        </button>
        {!changed ? <span className="muted small">Make a change to submit it.</span> : null}
      </div>
    </form>
  );
}

function Submissions({ version, admin }: { version: number; admin: boolean }) {
  const { data, error, reload } = useApi<{ submissions: Submission[] }>("/api/cms/submissions");
  useEffect(() => {
    if (version > 0) reload();
  }, [version, reload]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || data.submissions.length === 0) return null;
  return (
    <section aria-labelledby="subs-h">
      <h2 id="subs-h">{admin ? "Recent pull requests from the editor" : "Your recent pull requests"}</h2>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Pull request</th>
              <th scope="col">File</th>
              {admin ? <th scope="col">Author</th> : null}
              <th scope="col">Opened</th>
            </tr>
          </thead>
          <tbody>
            {data.submissions.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={s.prUrl} target="_blank" rel="noreferrer">
                    #{s.prNumber} {s.title}
                  </a>
                </td>
                <td>
                  <code>{s.path}</code>
                </td>
                {admin ? <td>{s.author ?? "deleted account"}</td> : null}
                <td>{new Date(s.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ContentEditorPage() {
  useTitle("Edit content");
  const { user } = useAuth();
  const staff = user?.role === "faculty" || user?.role === "admin";
  const status = useApi<CmsStatus>(staff ? "/api/cms/status" : null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [done, setDone] = useState<Submission | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (user === null) navigate("/login?next=%2Fcontent-editor", { replace: true });
  }, [user]);

  if (!user) return <div className="page"><Loading /></div>;
  if (!staff) return <div className="page"><NotAllowedState message="The content editor is for faculty and administrators." /></div>;
  if (status.error) return <div className="page"><ErrorState error={status.error} onRetry={status.reload} /></div>;
  if (!status.data) return <div className="page"><Loading label="Loading the content editor" /></div>;
  const s = status.data;

  const open = async (path: string) => {
    setOpening(true);
    setOpenError(null);
    setDone(null);
    try {
      setFile(await api<OpenFile>(`/api/cms/file?path=${encodeURIComponent(path)}`));
    } catch (err) {
      setOpenError(err instanceof ApiError ? err.message : "The file could not be opened.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="page page--narrow">
      <h1>Edit content</h1>
      <p className="lede">
        Change a lesson, lab, quiz, project or case study without using Git. Your edit becomes a pull request: a maintainer reviews it and CI runs every check
        before it is published. Nothing on this site changes until the pull request is merged and the site is rebuilt.
      </p>
      {!s.enabled ? (
        <div className="notice notice--warn" role="status">
          <p>
            <strong>The content editor is turned off on this server.</strong> {s.reason}
          </p>
        </div>
      ) : (
        <>
          <p className="muted small">
            Repository: <code>{s.repository}</code>. {CROSS_FILE_NOTE}
          </p>
          <FilePicker kinds={s.kinds} onOpen={(p) => void open(p)} busy={opening} />
          {openError ? (
            <div className="notice notice--danger" role="alert">
              <p>{openError}</p>
            </div>
          ) : null}
          {done ? (
            <div className="notice notice--ok" role="status">
              <p>
                <strong>Pull request #{done.prNumber} opened</strong> on branch <code>{done.branch}</code>.{" "}
                <a href={done.prUrl} target="_blank" rel="noreferrer">
                  View it on GitHub
                </a>
                . Reviewers and CI take it from here.
              </p>
            </div>
          ) : null}
          {file && !done ? (
            <Editor
              key={`${file.path}@${file.sha}`}
              file={file}
              maxBytes={s.maxBytes}
              onSubmitted={(sub) => {
                setDone(sub);
                setFile(null);
                setVersion((v) => v + 1);
              }}
            />
          ) : null}
          <Submissions version={version} admin={user.role === "admin"} />
        </>
      )}
    </div>
  );
}
