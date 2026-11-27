# Campus sites: one module instead of copy and paste

The campus runs small static sites — timetable, library, and next week exams — each as an nginx container.
`main.tf` creates them by copying the same resource block for every site, each with slightly different
mistakes. Turn the copies into a module and call it once per site.

The module `modules/static-site` (the check calls it on its own, so keep these names):

- inputs: `name` (container name; 3–41 lower-case letters, digits and hyphens, starting with a letter),
  `port` (1024–65535), `title` (not empty, at most 80 characters) — all three validated — and `image_id`;
- what it does: runs one container from `image_id`, published on `127.0.0.1:<port>` only, serving
  `index.html.tftpl` rendered with the title and name;
- outputs: `url` (`http://127.0.0.1:<port>`) and `container_name`.

The root configuration:

- variables `prefix` (default `campus`) and `sites`, a map keyed by site name of `{ port, title }`, with
  timetable (8081) and library (8082) as the default;
- one `module` block that creates every site, named `<prefix>-<key>`; adding or removing a site must touch only
  that site;
- output `urls`, a map from site name to URL; `kreuzwerker/docker` pinned to 4.6.0; the nginx image pinned by
  digest with `keep_locally = true`.

Run `bash check.sh path/to/this/folder` (needs Docker only — Terraform runs from its official image).
