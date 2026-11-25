/** An error that maps directly to an HTTP response with a stable error code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);
export const unauthorized = () => new HttpError(401, "unauthenticated", "You need to sign in to do that.");
export const forbidden = () => new HttpError(403, "forbidden", "You do not have permission to do that.");
