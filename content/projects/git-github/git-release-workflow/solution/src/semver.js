/**
 * Parse "MAJOR.MINOR.PATCH" (for example "1.4.2") into numbers.
 * Throws on anything else; pre-release and build suffixes are not supported.
 */
export function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) throw new Error(`not a MAJOR.MINOR.PATCH version: ${version}`);
  // Compare parts as numbers: as strings, "10" < "9".
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch };
}

/** Compare two versions: negative if a < b, 0 if equal, positive if a > b (usable with Array.prototype.sort). */
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const part of ["major", "minor", "patch"]) {
    if (x[part] !== y[part]) return x[part] < y[part] ? -1 : 1;
  }
  return 0;
}
