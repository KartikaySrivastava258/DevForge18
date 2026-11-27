// campus-search: small helpers for the course search page.
// Supported: Node.js 22, 24 and 26 (package.json "engines"). The first version used RegExp.escape (added in
// Node.js 24) and Uint8Array.prototype.toBase64 / Uint8Array.fromBase64 (in Node.js 26, not in 24): the tests
// passed on 26, which was the only version CI ran. The test matrix found both; these versions work everywhere.

/** Escapes every character that has a meaning in a regular expression, so the text matches literally. */
function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

/**
 * Wraps every case-insensitive match of term in <mark>…</mark>. The term is typed by users, so characters
 * with a meaning in regular expressions (such as "+" in "C++" or "." in "Node.js") must match literally.
 */
export function highlight(text, term) {
  if (!term) return text;
  const pattern = new RegExp(escapeRegExp(term), "gi");
  return text.replace(pattern, (match) => `<mark>${match}</mark>`);
}

/** Turns a result position such as { page: 2, q: "data" } into an opaque, URL-safe cursor (base64url, no padding). */
export function encodeCursor(position) {
  // Buffer's "base64url" encoding has no padding, like toBase64({ alphabet: "base64url", omitPadding: true }).
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

/** The inverse of encodeCursor. Throws a TypeError for anything that is not a cursor. */
export function decodeCursor(cursor) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TypeError("invalid cursor");
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}
