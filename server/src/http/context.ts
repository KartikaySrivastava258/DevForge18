import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZodType } from "zod/v4";
import type { UserRecord } from "../auth/users.ts";
import { HttpError } from "./errors.ts";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  requestId: string;
  ip: string;
  /** Route pattern used for metrics labels, e.g. /api/tracks/:slug. */
  route: string;
  sessionToken: string | undefined;
  user: UserRecord | undefined;
  /** Cookies to set on the response (already serialised). */
  setCookies: string[];
}

export interface JsonResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export const ok = (body: unknown, status = 200): JsonResult => ({ status, body });
export const noContent = (): JsonResult => ({ status: 204 });

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) throw new HttpError(413, "payload_too_large", "Request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, "payload_too_large", "Request body is too large.");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Read, parse and validate a JSON request body. Throws HttpError on any problem. */
export async function readJson<T>(ctx: RequestContext, schema: ZodType<T>): Promise<T> {
  const type = ctx.req.headers["content-type"] ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, "unsupported_media_type", "Send the request body as application/json.");
  }
  const text = await readBody(ctx.req, MAX_JSON_BODY_BYTES);
  let data: unknown;
  try {
    data = text.length ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "validation_failed",
      "Some fields are invalid.",
      parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}
