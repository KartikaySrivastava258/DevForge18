import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Link, navigate, safeNext, useLocation } from "../lib/router.tsx";
import { useTitle } from "../lib/useApi.ts";

function useNext(): string {
  return safeNext(useLocation().search.get("next"));
}

export function LoginPage() {
  useTitle("Sign in");
  const { login } = useAuth();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Could not sign in. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="auth">
        <div className="card">
          <h1>Sign in</h1>
          <p className="muted">Pick up where you left off and keep your progress.</p>
          <form onSubmit={submit} noValidate>
            {error && !error.details.length ? (
              <div className="notice notice--danger" role="alert">
                <p>{error.message}</p>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error?.fieldError("email"))} />
              {error?.fieldError("email") ? <span className="field__error">{error.fieldError("email")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn--primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="small muted" style={{ marginTop: "var(--space-4)", marginBottom: 0 }}>
            New here? <Link to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  useTitle("Create an account");
  const { register } = useAuth();
  const next = useNext();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ displayName, email, password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Could not create the account. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (f: string) => error?.fieldError(f);
  return (
    <div className="page">
      <div className="auth">
        <div className="card">
          <h1>Create an account</h1>
          <p className="muted">Save completed lessons and bookmarks. Your progress is private to you.</p>
          <form onSubmit={submit} noValidate>
            {error && !error.details.length ? (
              <div className="notice notice--danger" role="alert">
                <p>
                  {error.message}
                  {error.code === "email_taken" ? (
                    <>
                      {" "}
                      <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in instead</Link>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" autoComplete="name" maxLength={80} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={Boolean(fieldError("displayName"))} aria-describedby={fieldError("displayName") ? "name-err" : undefined} />
              {fieldError("displayName") ? <span id="name-err" className="field__error">{fieldError("displayName")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(fieldError("email"))} aria-describedby={fieldError("email") ? "email-err" : undefined} />
              {fieldError("email") ? <span id="email-err" className="field__error">{fieldError("email")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(fieldError("password"))} aria-describedby={fieldError("password") ? "pw-hint pw-err" : "pw-hint"} />
              <span id="pw-hint" className="field__hint">At least 10 characters. A short phrase of unrelated words works well.</span>
              {fieldError("password") ? <span id="pw-err" className="field__error">{fieldError("password")}</span> : null}
            </div>
            <button className="btn btn--primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
          <p className="small muted" style={{ marginTop: "var(--space-4)", marginBottom: 0 }}>
            Already have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
