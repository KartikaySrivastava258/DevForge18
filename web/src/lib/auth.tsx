import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import type { Bookmark, User } from "./types.ts";

interface AuthValue {
  /** undefined while the session is being checked. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<User>;
  logout: () => Promise<void>;
  bookmarks: Set<string>;
  toggleBookmark: (type: Bookmark["type"], id: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthValue | null>(null);
const key = (type: string, id: string) => `${type}:${id}`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) {
      setBookmarks(new Set());
      return;
    }
    api<{ bookmarks: Bookmark[] }>("/api/me/bookmarks")
      .then((r) => setBookmarks(new Set(r.bookmarks.map((b) => key(b.type, b.id)))))
      .catch(() => setBookmarks(new Set()));
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } });
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: input });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const toggleBookmark = useCallback(
    async (type: Bookmark["type"], id: string) => {
      const k = key(type, id);
      const on = !bookmarks.has(k);
      await api(`/api/me/bookmarks/${type}/${encodeURIComponent(id)}`, { method: on ? "PUT" : "DELETE" });
      setBookmarks((prev) => {
        const next = new Set(prev);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      });
      return on;
    },
    [bookmarks],
  );

  const value = useMemo(
    () => ({ user, login, register, logout, bookmarks, toggleBookmark }),
    [user, login, register, logout, bookmarks, toggleBookmark],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const bookmarkKey = key;
