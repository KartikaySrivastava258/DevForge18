// campus-search: small helpers for the course search page.

/**
 * Wraps every case-insensitive match of term in <mark>…</mark>. The term is typed by users, so characters
 * with a meaning in regular expressions (such as "+" in "C++" or "." in "Node.js") must match literally.
 */
export function highlight(text, term) {
  if (!term) return text;
  const pattern = new RegExp(RegExp.escape(term), "gi");
  return text.replace(pattern, (match) => `<mark>${match}</mark>`);
}

/** Turns a result position such as { page: 2, q: "data" } into an opaque, URL-safe cursor (base64url, no padding). */
export function encodeCursor(position) {
  return new TextEncoder().encode(JSON.stringify(position)).toBase64({ alphabet: "base64url", omitPadding: true });
}

/** The inverse of encodeCursor. Throws a TypeError for anything that is not a cursor. */
export function decodeCursor(cursor) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TypeError("invalid cursor");
  return JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(cursor, { alphabet: "base64url" })));
}
