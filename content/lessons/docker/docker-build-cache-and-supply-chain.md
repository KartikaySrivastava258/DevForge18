---
id: docker-build-cache-and-supply-chain
title: Build cache and the software supply chain
track: docker
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [docker-image-and-container-security]
learning_objectives:
  - Show that an image tag can point to different content over time, and pin a base image by digest instead.
  - Explain why the build cache can keep stale packages, and when to rebuild with --pull and --no-cache.
  - Generate a software bill of materials (SBOM) for an image and find a package and its exact version in it.
  - Describe how SBOMs, vulnerability scanners and build provenance fit together in a supply chain.
resources:
  - title: Building best practices — pin base image versions, rebuild your images
    url: https://docs.docker.com/build/building/best-practices/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Tags are mutable, pinning to a digest guarantees the same image, and --pull and --no-cache get fresh base images and dependencies.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker buildx build (docker build) reference
    url: https://docs.docker.com/reference/cli/docker/buildx/build/
    publisher: Docker Inc.
    type: reference
    level: intermediate
    official: true
    why: The --pull, --no-cache, --sbom and --provenance options.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Syft
    url: https://github.com/anchore/syft
    publisher: Anchore
    type: source-code
    level: intermediate
    official: true
    why: The open-source SBOM generator used in this lesson; it writes CycloneDX, SPDX and its own formats, and reads images saved with docker save (--from docker-archive).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: CycloneDX specification overview
    url: https://cyclonedx.org/specification/overview/
    publisher: OWASP CycloneDX
    type: reference
    level: advanced
    official: true
    why: The SBOM format produced in the lab — components identified by package URLs (purl) with exact versions.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: tag-vs-digest
    prompt: Your Dockerfile says FROM alpine:3.20. Six months later, the same Dockerfile builds on a new laptop. Is the base image the same?
    options:
      - { id: a, text: "Yes, the tag says 3.20" }
      - { id: b, text: "Not necessarily: the publisher may have moved the tag to a rebuilt image with updated packages. Only a digest (@sha256:…) names exactly one image" }
      - { id: c, text: "No, tags expire after six months" }
    answer: b
    explanation: Tags are names that can move — usually for good reasons, such as security fixes. Pin by digest for reproducible builds, and update the digest deliberately (tools such as Dependabot or Renovate can propose the change).
  - id: stale-cache
    prompt: A Dockerfile runs apk upgrade in a RUN step. A month later you rebuild without changing the Dockerfile. Do you get this month's fixes?
    options:
      - { id: a, text: "Yes, RUN steps always run" }
      - { id: b, text: "No: the instruction text did not change, so Docker reuses the cached layer from a month ago. Rebuild with --pull and --no-cache to refresh" }
      - { id: c, text: "Only if the base image tag changed" }
    answer: b
    explanation: The cache key is the instruction and its inputs, not the state of the package repository. The lab shows a RUN step reused, then rerun with --no-cache.
  - id: sbom-use
    prompt: A serious vulnerability is announced in libssl3 3.3.7. How does an SBOM help?
    options:
      - { id: a, text: "It fixes the vulnerability" }
      - { id: b, text: "It lists every package and exact version in each image, so you can find which images contain libssl3 3.3.7 without rebuilding or logging into anything" }
      - { id: c, text: "It prevents the vulnerability from being exploited" }
    answer: b
    explanation: An SBOM is an inventory. Scanners match it against vulnerability databases; you then rebuild the affected images and redeploy.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, after the previous lessons, and its output is compared with this lesson. The base image is pinned by digest and Syft by version (v1.55.0), so the SBOM is the same on every run. First run locally on 2026-11-26. BuildKit's --sbom and --provenance attestations and vulnerability scanning are described from the documentation, not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

To trust an image you must know **exactly what it was built from** (pin base images by **digest**, not just a tag), **rebuild it regularly** so the build cache does not keep old packages, and keep an **inventory of what is inside** (an **SBOM**) so you can answer "are we affected?" when the next vulnerability is announced.

## Explain it like I'm twelve

A canteen orders "bread from Baker Ali". One day Baker Ali hands the shop to someone else, but the sign stays the same — the name now means different bread. A **digest** is like the batch number stamped on one exact delivery. The **build cache** is yesterday's leftover bread: fine if nothing has changed, a problem if there was a recall. And an **SBOM** is the ingredients list on every packet, so when a recall is announced you can check every packet in minutes.

Where the analogy breaks: the batch number (digest) is a hash of the content itself, so nobody can attach it to different bread.

## What problem it solves

Modern software is mostly other people's software: a base image, system packages and libraries. Attacks and vulnerabilities in that chain — a compromised package, an outdated library such as Log4j in 2021 — affect everyone who ships it. Teams that know exactly what each image contains, and can rebuild it predictably, can respond in hours instead of weeks.

## How it works

![](media:docker/supply-chain.svg)

- A **tag** (`alpine:3.20`) is a movable name. A **digest** (`alpine@sha256:…`) is the hash of the image's manifest; `FROM alpine:3.20@sha256:…` always means the same image.
- The **build cache** reuses a layer when the instruction and its inputs are unchanged — it does not know that the package repository has newer versions. `--pull` fetches the newest base image for a tag; `--no-cache` reruns every step.
- An **SBOM** lists the components in an image — names, exact versions and package URLs (`purl`) — in a standard format such as **CycloneDX** or **SPDX**. Tools such as Syft generate them; BuildKit can attach one at build time (`docker buildx build --sbom=true`).
- **Vulnerability scanners** (for example Grype, Trivy or Docker Scout) compare an SBOM or image with vulnerability databases. **Provenance** attestations (`--provenance`) record how and from what an image was built.

## Try it yourself

> **Local lab** — needs Docker. It downloads the Syft image (`anchore/syft:v1.55.0`, about 90 MB). Every command is run automatically in DevForge's tests, and the last step removes everything you create.

### 1. A tag can move

```bash run
mkdir -p chain-lab && cd chain-lab
same_as() { [ "$(docker image inspect -f '{{.Id}}' "$1")" = "$(docker image inspect -f '{{.Id}}' "$2")" ] && echo yes || echo no; }
docker tag alpine:3.20 devforge-base:stable
echo "devforge-base:stable is alpine:3.20: $(same_as devforge-base:stable alpine:3.20)"
docker run --rm devforge-base:stable sh -c 'command -v node || echo "no node in this image"'
docker tag node:22-alpine devforge-base:stable
echo "devforge-base:stable is alpine:3.20: $(same_as devforge-base:stable alpine:3.20)"
docker run --rm devforge-base:stable sh -c 'command -v node || echo "no node in this image"'
```

```text output
devforge-base:stable is alpine:3.20: yes
no node in this image
devforge-base:stable is alpine:3.20: no
/usr/local/bin/node
```

Same name, different image. Here *you* moved the tag; on a registry, the publisher can — and for base images regularly does, when it rebuilds them with security fixes. A Dockerfile that says `FROM devforge-base:stable` would silently build on something else.

### 2. A digest cannot

```bash run
digest=$(docker image inspect -f '{{index .RepoDigests 0}}' alpine:3.20)
echo "$digest" | sed 's/@sha256:.*/@sha256:…/'
docker run --rm "$digest" sh -c '. /etc/os-release; echo "$PRETTY_NAME"'
```

```text output
alpine@sha256:…
Alpine Linux v3.20
```

The digest is a hash of the image's content description, so it identifies one image for ever. (It is shown as `…` because it depends on when you pulled `alpine:3.20`.) In a Dockerfile, write both, so people can read the version and Docker uses the exact image: `FROM alpine:3.20@sha256:…`.

### 3. The cache keeps old results

```bash run
cat > Dockerfile <<'EOF'
FROM alpine:3.20
# Stands in for "apk upgrade": a step whose result depends on when it runs.
RUN echo "packages refreshed at build $RANDOM$RANDOM" > /refreshed
CMD ["cat", "/refreshed"]
EOF
docker build -q -t devforge-cache:1 . > ../build.log 2>&1 || { cat ../build.log; exit 1; }
docker build -q -t devforge-cache:2 . > ../build.log 2>&1 || { cat ../build.log; exit 1; }
docker build -q --no-cache -t devforge-cache:3 . > ../build.log 2>&1 || { cat ../build.log; exit 1; }
[ "$(docker run --rm devforge-cache:1)" = "$(docker run --rm devforge-cache:2)" ] && echo "plain rebuild: RUN step reused from the cache" || echo "plain rebuild: RUN step ran again"
[ "$(docker run --rm devforge-cache:1)" = "$(docker run --rm devforge-cache:3)" ] && echo "--no-cache: RUN step reused" || echo "--no-cache: RUN step ran again"
```

```text output
plain rebuild: RUN step reused from the cache
--no-cache: RUN step ran again
```

If that `RUN` step were `apk upgrade`, the plain rebuild would ship last month's packages. Scheduled rebuilds (for example weekly in CI) should use `--pull --no-cache`; everyday builds keep the cache for speed.

### 4. An SBOM for a pinned base image

Pin `alpine:3.20` to one digest, save it to a file, and let Syft list what is inside:

```bash run
PINNED=alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
docker pull -q "$PINNED" > /dev/null
docker pull -q anchore/syft:v1.55.0 > /dev/null
docker tag "$PINNED" devforge-pinned-alpine:3.20
docker save devforge-pinned-alpine:3.20 -o base.tar && chmod 644 base.tar
syft() { docker run --rm -v "$PWD":/in:ro anchore/syft:v1.55.0 --from docker-archive /in/base.tar -q "$@"; }
syft -o syft-table
```

```text output
NAME                    VERSION      TYPE
alpine-baselayout       3.6.5-r0     apk
alpine-baselayout-data  3.6.5-r0     apk
alpine-keys             2.4-r1       apk
apk-tools               2.14.4-r1    apk
busybox                 1.36.1-r31   apk
busybox-binsh           1.36.1-r31   apk
ca-certificates-bundle  20260413-r0  apk
libcrypto3              3.3.7-r0     apk
libssl3                 3.3.7-r0     apk
musl                    1.2.5-r3     apk
musl-utils              1.2.5-r3     apk
scanelf                 1.3.7-r2     apk
ssl_client              1.36.1-r31   apk
zlib                    1.3.2-r0     apk
```

Fourteen packages, each with an exact version. Because the image is pinned by digest, this list is the same on every machine, every time. Now the same inventory in a standard format that other tools read:

```bash run
syft -o cyclonedx-json > sbom.cdx.json
grep -o '"bomFormat":"[^"]*","specVersion":"[^"]*"' sbom.cdx.json
echo "components: $(grep -o '"purl":"pkg:apk/' sbom.cdx.json | wc -l | tr -d ' ')"
grep -o '"purl":"pkg:apk/alpine/libssl3@[^"]*"' sbom.cdx.json
```

```text output
"bomFormat":"CycloneDX","specVersion":"1.7"
components: 14
"purl":"pkg:apk/alpine/libssl3@3.3.7-r0?arch=x86_64&distro=alpine-3.20.10&upstream=openssl"
```

The **package URL** says exactly what this is: the Alpine package `libssl3`, version `3.3.7-r0`, built from upstream `openssl`, for Alpine 3.20.10. If an OpenSSL vulnerability is announced, searching stored SBOMs for `upstream=openssl` tells you which images to rebuild — without opening a single one.

### 5. Clean up

```bash run
cd ..
docker image rm devforge-base:stable devforge-cache:1 devforge-cache:2 devforge-cache:3 devforge-pinned-alpine:3.20 > /dev/null
echo "removed"
```

```text output
removed
```

## Common mistakes

- **`latest` or a floating tag in production Dockerfiles.** Builds stop being reproducible. Pin by digest and let a bot propose updates.
- **Pinning and then never updating.** A pinned image does not receive security fixes; update the digest deliberately and often.
- **Trusting the cache for security updates.** Schedule `--pull --no-cache` rebuilds.
- **Generating an SBOM and never using it.** Store it with the image (BuildKit can attach it as an attestation) and scan it regularly — new vulnerabilities are found in old packages every day.
- **Scanning only the base image.** Your application's own dependencies (npm, pip, Maven) are usually most of the SBOM; scan the image you actually ship.

## Where this fits in a real system

A typical pipeline in **GitHub Actions** or **Jenkins** builds with pinned base images, attaches an SBOM and provenance (`docker buildx build --sbom=true --provenance=true`), scans the result and blocks the release on critical findings, and rebuilds on a schedule. **Kubernetes** clusters can then admit only images that are signed and scanned, and the same digest-pinning rule applies to the images named in manifests.
