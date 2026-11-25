/** Fetch wrapper: same-origin cookies, CSRF header on writes, typed errors. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, details: { field: string; message: string }[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  fieldError(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.message;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-devforge-csrf"] = "1";
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Could not reach DevForge. Check your connection, then try again.");
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = (data as ErrorBody | null)?.error;
    const details = Array.isArray(err?.details) ? (err.details as { field: string; message: string }[]) : [];
    throw new ApiError(response.status, err?.code ?? "http_error", err?.message ?? `Request failed (${response.status}).`, details);
  }
  return data as T;
}
