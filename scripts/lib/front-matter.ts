/**
 * Front matter splitting, kept apart from markdown.ts so that code which only
 * needs the split (the server's content editor) does not load the Markdown
 * renderer and its build-time dependencies.
 */

/** Split a Markdown file into YAML front matter and body. */
export function splitFrontMatter(source: string): { frontMatter: string; body: string } | null {
  const normalised = source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalised);
  if (!match) return null;
  return { frontMatter: match[1] ?? "", body: match[2] ?? "" };
}
