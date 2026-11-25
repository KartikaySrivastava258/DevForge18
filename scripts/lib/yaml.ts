/**
 * The only way content and workflow YAML is parsed in this project.
 *
 * CORE_SCHEMA allows plain data (strings, numbers, booleans, null, lists,
 * maps) only: no custom JavaScript types, no "<<" merge keys (the subject of
 * js-yaml security advisories) and no timestamp conversion — dates stay
 * strings such as "2026-11-25", which the content schema validates. The same
 * call is safe in js-yaml 3 and 4.
 */
import jsyaml from "js-yaml";

export function parseYaml(source: string, filename?: string): unknown {
  return jsyaml.load(source, { schema: jsyaml.CORE_SCHEMA, ...(filename ? { filename } : {}) });
}
