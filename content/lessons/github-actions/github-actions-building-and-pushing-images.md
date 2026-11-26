---
id: github-actions-building-and-pushing-images
title: Building and pushing container images
track: github-actions
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [github-actions-caching-and-artifacts]
learning_objectives:
  - Choose image tags a pipeline should push — commit, branch and semantic version — and explain why one image gets several tags.
  - Add OCI labels that link an image back to its source code and commit.
  - Push to a registry and pull by digest, and explain why deployments should use digests rather than tags.
  - Write a workflow that builds on every pull request and pushes to GitHub Container Registry only from main and version tags, with least-privilege permissions.
resources:
  - title: Working with the Container registry (GHCR)
    url: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: Images live at ghcr.io/NAMESPACE/IMAGE_NAME, and a workflow can publish with GITHUB_TOKEN (packages write permission).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker/metadata-action
    url: https://github.com/docker/metadata-action
    publisher: Docker
    type: source-code
    level: intermediate
    official: true
    why: Computes tags (sha, branch, semver) and OCI labels from the Git context; v6.2.0 is the latest release.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker/build-push-action
    url: https://github.com/docker/build-push-action
    publisher: Docker
    type: source-code
    level: intermediate
    official: true
    why: Builds with BuildKit and pushes; inputs context, push, tags, labels; output digest. v7.4.0 is the latest release.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: OCI image annotations (pre-defined keys)
    url: https://github.com/opencontainers/image-spec/blob/main/annotations.md
    publisher: Open Container Initiative
    type: reference
    level: intermediate
    official: true
    why: org.opencontainers.image.source, .revision and .version — the standard way to say where an image came from.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: OCI distribution specification (listing tags)
    url: https://github.com/opencontainers/distribution-spec/blob/main/spec.md
    publisher: Open Container Initiative
    type: reference
    level: advanced
    official: true
    why: GET /v2/<name>/tags/list, and the Docker-Content-Digest header that returns a manifest's digest.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: several-tags
    prompt: One build is pushed as sha-e7750c5, main, 1.2.0, 1.2 and 1. How many images are stored?
    options:
      - { id: a, text: "Five" }
      - { id: b, text: "One: the tags are five names for the same digest; each answers a different question (which commit, latest on main, which release, latest 1.x)" }
      - { id: c, text: "Two, one per branch" }
    answer: b
    explanation: The lab shows 1.2.0 and the sha tag resolving to the same digest. Tags like main and 1 move to newer images over time; sha and full versions should not.
  - id: digest
    prompt: Why should a production deployment reference image@sha256:… instead of image:1.2?
    options:
      - { id: a, text: "Digests are shorter" }
      - { id: b, text: "A tag can be moved to another image; a digest is the hash of the content, so it always means exactly the image that was tested and approved" }
      - { id: c, text: "Registries reject tags in production" }
    answer: b
    explanation: The same rule as pinning base images in the Docker track. Pipelines record the digest from the push and deploy that.
  - id: pr-push
    prompt: Why does the workflow build on pull requests but not push?
    options:
      - { id: a, text: "Pushing is slow" }
      - { id: b, text: "Building proves the Dockerfile works for every change, but pushing needs write access to packages — a pull request from a fork must not get that, and unreviewed images should not be published" }
      - { id: c, text: "GHCR does not accept pull requests" }
    answer: b
    explanation: The push input is a condition on the event, and only the push job's token has packages write permission.
verification:
  method: executed
  details: The local commands — a Git repository with a tagged commit, tags computed as docker/metadata-action would, a build with OCI labels, pushes to a local registry (registry:3, pinned by digest) and a pull by digest — run in the test suite and their output is compared with this lesson; the workflow is validated by DevForge's workflow checker. Pushing to ghcr.io from GitHub Actions is checked against GitHub's and Docker's documentation and the actions' action.yml files (2026-11-26) but not run, because it needs github.com.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A pipeline builds the image once, gives it **tags** that answer different questions (which commit? which release? the newest on main?), adds **labels** that point back to the source, pushes it to a **registry** — and deployments then use the image's **digest**, which can never change.

## Explain it like I'm twelve

A school prints its yearbook. Each printed copy gets several labels on the shelf: "print run 7", "the 2026 edition", "the newest edition". They are all the same book. The printer's barcode on the back (**digest**) identifies the exact printing — labels like "newest" move to next year's book, but the barcode never does.

Where the analogy breaks: copying an image is free, so registries keep one copy and let all the tags point at it.

## What problem it solves

Images built by hand on laptops are hard to trace (which commit is this?) and easy to overwrite (someone re-pushes `latest`). Building in CI makes every image reproducible from a commit, labelled with where it came from, and published only after review — and the digest gives deployments an exact reference.

## How it works

![](media:github-actions/image-pipeline.svg)

- **Tags**: `sha-<commit>` (exactly which code), the branch name (`main`: newest on main), and for release tags `v1.2.0` → `1.2.0`, `1.2` and `1`. `docker/metadata-action` computes them from the Git context.
- **Labels**: `org.opencontainers.image.source`, `.revision` and `.version` are the OCI standard keys linking an image to its repository and commit.
- **Push**: to GitHub Container Registry (`ghcr.io/<owner>/<image>`) with the job's `GITHUB_TOKEN`, which needs `packages: write`. Pull requests build but do not push.
- **Digest**: the registry returns `sha256:…` for each pushed manifest; `docker/build-push-action` outputs it, and deployments should use it.

## Try it yourself

> **Local lab** — needs Docker and Git, as in the earlier lessons. A local registry (port 5055) stands in for ghcr.io, so no account or token is needed. Every command is run automatically in DevForge's tests, and the last step removes the registry.

### 1. A registry and a tagged commit

```bash run
mkdir -p images-lab && cd images-lab
docker run -d --name devforge-registry -p 127.0.0.1:5055:5000 \
  registry:3@sha256:82f6ff4a7f982960c8aa51617fea3aabc485df6e55cce80d22deb1de36f1bc3c > /dev/null
for i in $(seq 1 30); do curl -sf http://127.0.0.1:5055/v2/ > /dev/null && break; sleep 0.5; done
curl -s -o /dev/null -w 'registry: HTTP %{http_code}\n' http://127.0.0.1:5055/v2/
git init -q
cat > server.js <<'EOF'
require("node:http").createServer((req, res) => res.end("course site\n")).listen(8080);
EOF
cat > Dockerfile <<'EOF'
FROM node:22-alpine
WORKDIR /app
COPY server.js .
USER node
CMD ["node", "server.js"]
EOF
git add . && git commit -q -m "Course site container" && git tag v1.2.0
```

```text output
registry: HTTP 200
```

### 2. Tags, as metadata-action would compute them

```bash run
sha=$(git rev-parse --short=7 HEAD)
version=$(git describe --tags --exact-match | sed 's/^v//')
image=localhost:5055/course-site
tags="sha-$sha main $version ${version%.*} ${version%%.*}"
echo "commit $sha, release $version"
echo "tags: $tags"
```

```text output
commit …, release 1.2.0
tags: sha-… main 1.2.0 1.2 1
```

The commit hash depends on your files and identity, so it is shown as `…`. Each tag answers a question: `sha-…` (exactly this code), `main` (newest on main), `1.2.0` (this release), `1.2` and `1` (newest patch and newest minor release).

### 3. Build once, with labels, and push every tag

```bash run
docker build -q \
  --label "org.opencontainers.image.source=https://github.com/asha-rao/course-site" \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  --label "org.opencontainers.image.version=$version" \
  $(for t in $tags; do printf -- '-t %s:%s ' "$image" "$t"; done) . > ../build.log 2>&1
for t in $tags; do docker push -q "$image:$t" > /dev/null; done
curl -s http://127.0.0.1:5055/v2/course-site/tags/list
docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}} built from {{index .Config.Labels "org.opencontainers.image.source"}}' "$image:1.2.0"
```

```text output
{"name":"course-site","tags":["1","1.2","1.2.0","main","sha-…"]}
1.2.0 built from https://github.com/asha-rao/course-site
```

The registry's tag list (`/v2/<name>/tags/list`, from the OCI distribution specification) shows all five names. Anyone inspecting the image can follow its labels back to the repository and commit.

### 4. One digest behind all the tags

```bash run
manifest_digest() {
  curl -s -I -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "http://127.0.0.1:5055/v2/course-site/manifests/$1" | grep -i '^docker-content-digest' | cut -d' ' -f2 | tr -d '\r'
}
digest=$(manifest_digest 1.2.0)
[ "$digest" = "$(manifest_digest "sha-$sha")" ] && [ "$digest" = "$(manifest_digest main)" ] && echo "1.2.0, sha-… and main share one digest: sha256:…"
for t in $tags; do docker rmi -f "$image:$t" > /dev/null; done
docker pull -q "$image@$digest" | sed 's/@sha256:.*/@sha256:…/'
```

```text output
1.2.0, sha-… and main share one digest: sha256:…
localhost:5055/course-site@sha256:…
```

The registry stored one image and five names for it. Pulling by digest got exactly that image — even if someone later moved `main` or `1.2` to another build, this reference would not change.

### 5. The workflow

```bash run
cd ..
mkdir -p images-lab/.github/workflows
cat > images-lab/.github/workflows/image.yml <<'EOF'
name: Container image

on:
  pull_request:
  push:
    branches: [main]
    tags: ["v*.*.*"]

permissions:
  contents: read

jobs:
  image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write          # only this job may push to ghcr.io
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - name: Tags and labels from the Git context
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
      - name: Sign in to ghcr.io (not for pull requests)
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build, and push except for pull requests
        id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
      - name: Record the digest to deploy
        if: github.event_name != 'pull_request'
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: echo "Deploy ghcr.io/${GITHUB_REPOSITORY}@${DIGEST}" >> "$GITHUB_STEP_SUMMARY"
EOF
docker rm -f devforge-registry > /dev/null
echo "workflow written; registry removed"
```

```text output
workflow written; registry removed
```

- `metadata-action` produces the same kinds of tags you made by hand, plus OCI labels (source, revision, version, created) from the repository.
- Pull requests build — proving the Dockerfile still works — but neither sign in nor push. Only the `image` job gets `packages: write`.
- The digest goes into the run's summary, ready for a deployment job (next lessons) to use.

## Common mistakes

- **Deploying `latest` or `main`.** Those tags move. Deploy the digest (or at least an immutable `sha-` tag).
- **Pushing from pull requests.** Fork pull requests must never get write tokens; build only.
- **`packages: write` for the whole workflow.** Grant it to the one job that pushes.
- **Rebuilding for each environment.** Build once, promote the same digest from staging to production.
- **No labels.** Without `source` and `revision`, nobody can tell which code an image contains.

## Where this fits in a real system

The **Docker** track's SBOM, scanning and digest pinning happen in this same job; the digest is what **Kubernetes** manifests or **Terraform** variables deploy; and **Jenkins** pipelines follow the same build-once, tag, push, deploy-by-digest pattern.
