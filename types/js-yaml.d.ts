// Minimal declaration for the subset of js-yaml used by this project (works for
// js-yaml 3 and 4). Only load() with CORE_SCHEMA is permitted: see scripts/lib/yaml.ts.
declare module "js-yaml" {
  interface Schema {
    readonly __schema: unique symbol;
  }
  interface JsYaml {
    load(input: string, options?: { filename?: string; schema?: Schema }): unknown;
    CORE_SCHEMA: Schema;
  }
  const jsyaml: JsYaml;
  export default jsyaml;
}
