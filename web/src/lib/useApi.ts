import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";

/** Public content rarely changes during a session; cache it to make navigation instant. */
const cache = new Map<string, unknown>();

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null, options: { cache?: boolean } = {}): ApiState<T> {
  const useCache = options.cache ?? false;
  const cached = path && useCache ? (cache.get(path) as T | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(cached);
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState<boolean>(path !== null && cached === undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    if (useCache && cache.has(path) && nonce === 0) {
      setData(cache.get(path) as T);
      setError(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (useCache) cache.set(path, result);
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Something unexpected went wrong."));
        setData(undefined);
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, nonce, useCache]);

  const reload = useCallback(() => {
    if (path) cache.delete(path);
    setNonce((n) => n + 1);
  }, [path]);

  return { data, error, loading, reload };
}

export function useTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} | DevForge 18` : "DevForge 18";
  }, [title]);
}
