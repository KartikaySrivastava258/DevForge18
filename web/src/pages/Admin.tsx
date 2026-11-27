/**
 * Administration: users (role filter, paging, role change, disable / enable)
 * and the audit log. Admins only — the server enforces this on every route;
 * the page shows a clear "not allowed" state to everyone else.
 */
import { useEffect, useState } from "react";
import { ErrorState, Loading, NotAllowedState } from "../components/States.tsx";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { navigate } from "../lib/router.tsx";
import type { Role, User } from "../lib/types.ts";
import { useApi, useTitle } from "../lib/useApi.ts";

interface AdminUser extends User {
  disabledAt: string | null;
}
interface UsersResponse {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}
interface AuditEvent {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
  actor_name: string | null;
  target_name: string | null;
}

const PAGE = 20;
const ROLES: Role[] = ["student", "faculty", "admin"];
const ROLE_LABEL: Record<Role, string> = { student: "Student", faculty: "Faculty", admin: "Admin" };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A pending change waiting for the admin's confirmation. */
type Pending = { user: AdminUser; kind: "role"; role: Role } | { user: AdminUser; kind: "status"; disabled: boolean };

function describe(p: Pending): string {
  if (p.kind === "role") return `Change ${p.user.displayName} (${p.user.email}) from ${ROLE_LABEL[p.user.role]} to ${ROLE_LABEL[p.role]}?`;
  return p.disabled
    ? `Disable ${p.user.displayName} (${p.user.email})? They are signed out at once and cannot sign in until re-enabled.`
    : `Re-enable ${p.user.displayName} (${p.user.email})? They can sign in again.`;
}

function UsersSection({ me, onChanged }: { me: User; onChanged: () => void }) {
  const [role, setRole] = useState<Role | "">("");
  const [offset, setOffset] = useState(0);
  const path = `/api/admin/users?limit=${PAGE}&offset=${offset}${role ? `&role=${role}` : ""}`;
  const { data, error, loading, reload } = useApi<UsersResponse>(path);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "danger"; text: string } | null>(null);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      if (pending.kind === "role") {
        await api(`/api/admin/users/${encodeURIComponent(pending.user.id)}/role`, { method: "PATCH", body: { role: pending.role } });
        setMessage({ kind: "ok", text: `${pending.user.displayName} is now ${ROLE_LABEL[pending.role]}.` });
      } else {
        await api(`/api/admin/users/${encodeURIComponent(pending.user.id)}/status`, { method: "PATCH", body: { disabled: pending.disabled } });
        setMessage({ kind: "ok", text: `${pending.user.displayName} is ${pending.disabled ? "disabled" : "enabled"}.` });
      }
      reload();
      onChanged();
    } catch (err) {
      // The server's messages are written for people (e.g. 409 last_admin: "You cannot remove the last administrator.").
      setMessage({ kind: "danger", text: err instanceof ApiError ? err.message : "The change failed. Try again." });
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const total = data?.total ?? 0;
  return (
    <section aria-labelledby="users-h">
      <h2 id="users-h">Users</h2>
      <div className="filters">
        <label htmlFor="role-filter">Role</label>
        <select
          id="role-filter"
          className="select"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | "");
            setOffset(0);
          }}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <span className="muted small" aria-live="polite">
          {data ? (total === 0 ? "No users" : `Showing ${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`) : ""}
        </span>
      </div>

      {message ? (
        <div className={`notice notice--${message.kind}`} role={message.kind === "danger" ? "alert" : "status"}>
          <p>{message.text}</p>
        </div>
      ) : null}

      {pending ? (
        <div className="notice notice--warn" role="dialog" aria-modal="false" aria-labelledby="confirm-text">
          <p id="confirm-text">{describe(pending)}</p>
          <div className="adr__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void confirm()}>
              Confirm
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading label="Loading users" /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <th scope="row">
                    {u.displayName}
                    {u.id === me.id ? <span className="muted small"> (you)</span> : null}
                  </th>
                  <td>{u.email}</td>
                  <td>
                    <label className="sr-only" htmlFor={`role-${u.id}`}>
                      Role of {u.displayName}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      className="select"
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => setPending({ user: u, kind: "role", role: e.target.value as Role })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{u.disabledAt ? <span className="tag">Disabled</span> : <span className="tag tag--done">Active</span>}</td>
                  <td>{when(u.createdAt)}</td>
                  <td>
                    {u.id === me.id ? null : (
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={busy}
                        onClick={() => setPending({ user: u, kind: "status", disabled: !u.disabledAt })}
                      >
                        {u.disabledAt ? "Enable" : "Disable"}
                        <span className="sr-only"> {u.displayName}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="adr__actions admin-pager">
        <button type="button" className="btn btn--small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          Previous page
        </button>
        <button type="button" className="btn btn--small" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
          Next page
        </button>
      </div>
    </section>
  );
}

function AuditSection({ version }: { version: number }) {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useApi<{ events: AuditEvent[] }>(`/api/admin/audit?limit=${PAGE}&offset=${offset}`);
  useEffect(() => {
    if (version > 0) reload();
  }, [version, reload]);
  return (
    <section aria-labelledby="audit-h">
      <h2 id="audit-h">Audit log</h2>
      <p className="muted">Security-relevant and administrative actions, newest first. The log is append-only.</p>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading label="Loading the audit log" /> : null}
      {data ? (
        data.events.length === 0 ? (
          <p className="muted">No events on this page.</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table" aria-label="Audit log">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.created_at)}</td>
                    <td>{e.actor_name ? `${e.actor_name} (${e.actor_email ?? ""})` : <span className="muted">system or deleted user</span>}</td>
                    <td>
                      <code>{e.action}</code>
                    </td>
                    <td>{e.target_name ? `${e.target_name} (user)` : e.target_type ? `${e.target_type} ${e.target_id ?? ""}` : ""}</td>
                    <td className="admin-table__meta">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      <div className="adr__actions admin-pager">
        <button type="button" className="btn btn--small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          Newer events
        </button>
        <button type="button" className="btn btn--small" disabled={!data || data.events.length < PAGE} onClick={() => setOffset(offset + PAGE)}>
          Older events
        </button>
      </div>
    </section>
  );
}

export function AdminPage() {
  useTitle("Administration");
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (user === null) navigate("/login?next=%2Fadmin", { replace: true });
  }, [user]);

  if (!user) return <div className="page"><Loading /></div>;
  if (user.role !== "admin") {
    return (
      <div className="page">
        <NotAllowedState message="Administration is only available to administrators. Ask an administrator if you need a different role." />
      </div>
    );
  }
  return (
    <div className="page">
      <h1>Administration</h1>
      <p className="lede">Manage roles and accounts, and review the audit log. Every change here is recorded in the audit log.</p>
      <UsersSection me={user} onChanged={() => setVersion((v) => v + 1)} />
      <AuditSection version={version} />
    </div>
  );
}
