# Campus API: a development environment anyone can recreate

New developers on the campus API spend their first day getting Redis running. Describe the environment with
Terraform instead, so `terraform apply` gives everyone the same setup and `terraform destroy` removes it.

What `terraform apply -var project=NAME` must create (the check relies on these names):

- a Docker network `NAME-dev`;
- a container `NAME-redis` running `redis:7.4-alpine` pinned by digest
  (`sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe`), attached to that network and
  published on `127.0.0.1:<redis_port>` only (keep `keep_locally = true` on `docker_image`);
- a file `dev.env` next to the configuration with the lines `PROJECT=NAME` and
  `REDIS_URL=redis://127.0.0.1:<redis_port>/0`.

Variables: `project` (3–21 lower-case letters, digits and hyphens, starting with a letter) and `redis_port`
(number, default 6380, 1024–65535), both validated. Outputs: `network_name`, `redis_container`, `redis_url`,
`env_file`. Pin exact provider versions: `kreuzwerker/docker` 4.6.0 and `hashicorp/local` 2.9.1.

Run `bash check.sh path/to/this/folder` (needs Docker only — Terraform runs from its official image).
