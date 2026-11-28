---
id: docker-multi-stage-builds
title: Multi-stage builds and small images
track: docker
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [docker-dockerfile-layers-and-cache]
learning_objectives:
  - Write a multi-stage Dockerfile that builds a program in one stage and ships only the result in a small final stage.
  - Compare the size and contents of a single-stage and a multi-stage image, and explain where the difference comes from.
  - Build one chosen stage with --target, for example to run tests or to get a debugging image with the toolchain.
  - Choose a final base image (scratch, distroless or a small distribution) and explain what each gives up.
resources:
  - title: Multi-stage builds
    url: https://docs.docker.com/build/building/multi-stage/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Several FROM stages in one Dockerfile, naming stages with AS, COPY --from, --target, and how the legacy builder and BuildKit differ in which stages they build.
    verification: { status: verified, checked_on: 2026-11-28 }
  - title: BuildKit
    url: https://docs.docker.com/build/buildkit/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Docker's default builder; it detects and skips unused build stages and builds independent stages in parallel.
    verification: { status: verified, checked_on: 2026-11-28 }
  - title: Distroless container images
    url: https://github.com/GoogleContainerTools/distroless
    publisher: GoogleContainerTools
    type: source-code
    level: intermediate
    official: true
    why: The minimal final images used in this lesson — no package manager, no shell — with nonroot and debug variants.
    verification: { status: verified, checked_on: 2026-11-28 }
  - title: cgo command documentation (CGO_ENABLED)
    url: https://pkg.go.dev/cmd/cgo
    publisher: The Go Authors
    type: reference
    level: advanced
    official: true
    why: Why the build sets CGO_ENABLED=0, so the Go program does not depend on the C library and runs on an image without one.
    verification: { status: verified, checked_on: 2026-11-28 }
self_check:
  - id: what-ships
    prompt: A Dockerfile has a build stage FROM golang with your source and the compiler, and a final stage FROM a distroless image that runs COPY --from=build /out/app /app. What is in the image you push?
    options:
      - { id: a, text: "Everything from both stages, because both are in the same Dockerfile" }
      - { id: b, text: "The distroless base image's files plus /app — the compiler and the source stay in the build stage" }
      - { id: c, text: "Only /app, with no base image at all" }
    answer: b
    explanation: The image is the last stage (or the one named with --target). Earlier stages are only places to build things; COPY --from carries across exactly the files you name. You measured it in the lab — the compiler and the source were not in the small image.
  - id: target-tests
    prompt: Your Dockerfile has stages build, test (FROM build, RUN go test) and a final stage. In CI you want the tests to run and stop the pipeline if they fail. Which command does that with BuildKit?
    options:
      - { id: a, text: "docker build -t app . — BuildKit always runs every stage" }
      - { id: b, text: "docker build --target test . — it builds the test stage and the build stage it depends on, and fails when go test fails" }
      - { id: c, text: "docker run app go test" }
    answer: b
    explanation: BuildKit builds only the stages the target depends on, so a plain build of the final stage skips the test stage. Name it with --target test (as in the lab, where a broken test stopped the build), then build the final image.
  - id: scratch-or-distroless
    prompt: Your Go service calls HTTPS APIs, and you want the smallest final image that still works. Why might gcr.io/distroless/static be a better final base than scratch?
    options:
      - { id: a, text: "Distroless includes a shell for debugging" }
      - { id: b, text: "Distroless static adds the files a static program usually still needs — CA certificates, time-zone data, /tmp and an /etc/passwd entry — while staying tiny; scratch is completely empty" }
      - { id: c, text: "scratch images cannot run Go programs" }
    answer: b
    explanation: A static Go binary runs on scratch, but HTTPS needs CA certificates to check servers, and time zones need tzdata. The distroless static image provides them (and a nonroot variant) without a shell or package manager. You would copy those files into scratch yourself otherwise.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine; the output shown was recorded from that run. Base images are pinned by digest (golang:1.27.3-alpine3.24 and gcr.io/distroless/static-debian13:nonroot). Image sizes depend on your CPU architecture and Docker's image store, so they are shown as … and compared against limits instead. First run locally on 2026-11-28 with Docker Engine 29.1.3 and its legacy builder; the commands avoid builder-specific output, so they should print the same with BuildKit, which CI uses. That BuildKit skips unused stages is described from Docker's documentation (checked 2026-11-28), not shown by a command.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## The idea in one sentence

A **multi-stage build** uses several `FROM` instructions in one Dockerfile: early **stages** hold the tools needed to build or test the program, and the **final stage** starts from a small base image and copies in only the finished program with `COPY --from`, so the compiler, the source code and the build caches never reach the image you ship.

## Explain it like I'm twelve

You build a birdhouse in a workshop full of saws, glue and offcuts. When you give the birdhouse to your grandmother, you do not post her the whole workshop — you put the birdhouse in a box and send only that.

The **workshop** is the build stage, the **box** is the small final image, and **taking just the birdhouse out of the workshop** is `COPY --from`.

Where the analogy breaks: the workshop does not disappear. Docker keeps the build stage in its build cache, so the next build can reuse it, and you can ask for the workshop itself as an image (`--target`) when you need it.

## What problem it solves

A compiled language needs a compiler, libraries and the source code to build a program, but the running program usually needs only the result. In a single-stage Dockerfile, everything used during the build ends up in the image: hundreds of megabytes that every server and every CI job must download and store, and many extra programs an attacker could use if they break in. Deleting the tools in a later `RUN` does not help, because earlier layers stay in the image.

A multi-stage build keeps building and shipping in one Dockerfile and one `docker build` command, and the image contains only what the last stage puts in it.

## How it works

![](media:docker/multi-stage.svg)

- Each `FROM` starts a new **stage** with its own base image. In Docker's words: "With multi-stage builds, you use multiple `FROM` statements in your Dockerfile."
- Name a stage with `AS`: `FROM golang:… AS build`. Later stages refer to it by that name — more readable than its number, and it still works when you add or reorder stages.
- `COPY --from=build /out/hello /hello` copies a file from another stage instead of from your project folder. `--from` also accepts an image name, such as `COPY --from=nginx:latest /etc/nginx/nginx.conf /nginx.conf` in Docker's documentation, to take one file from a published image.
- A stage can start from an earlier one: `FROM build AS test` begins with everything the build stage made and adds the tests.
- By default the **last stage** becomes the image. `docker build --target test` stops at the stage you name instead.
- **Which stages run depends on the builder.** BuildKit, Docker's default builder, "only builds the stages that the target stage depends on": building the final stage here skips the test stage, because nothing copies from it. The older legacy builder "processes all stages of a Dockerfile leading up to the selected `--target`". With BuildKit, run tests explicitly with `--target test` — a plain build does not run them.
- **The final base image** decides what else ships. `scratch` is empty. A **distroless** image contains "only your application and its runtime dependencies" — no package manager and no shell; `gcr.io/distroless/static` adds CA certificates, time-zone data, a `/tmp` folder and an `/etc/passwd` entry, for programs that do not need the C library. A small distribution such as Alpine keeps a shell and a package manager, which helps debugging and costs a few megabytes.

## Try it yourself

> **Local lab** — needs Docker. It downloads the Go image (`golang:1.27.3-alpine3.24`, about 75 MB to download and 250 MB on disk) and the distroless static image (under 3 MB) on the first build. Every command is run automatically in DevForge's tests, and the last step removes the images it builds.

### 1. A small Go program and a single-stage image

```bash run
mkdir -p multistage-lab && cd multistage-lab
printf 'module example.com/hello\n\ngo 1.27\n' > go.mod
cat > main.go <<'EOF'
package main

import (
	"fmt"
	"os"
)

func greeting(name string) string {
	return "Hello, " + name + "! I run from a small image."
}

func main() {
	name := "DevForge"
	if len(os.Args) > 1 {
		name = os.Args[1]
	}
	fmt.Println(greeting(name))
}
EOF
cat > main_test.go <<'EOF'
package main

import "testing"

func TestGreeting(t *testing.T) {
	want := "Hello, Asha! I run from a small image."
	if got := greeting("Asha"); got != want {
		t.Errorf("greeting() = %q, want %q", got, want)
	}
}
EOF
cat > Dockerfile.single <<'EOF'
FROM golang:1.27.3-alpine3.24@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18
WORKDIR /src
COPY go.mod *.go ./
RUN CGO_ENABLED=0 go build -o /usr/local/bin/hello .
ENTRYPOINT ["hello"]
EOF
build() { docker build -q "$@" > build.log 2>&1 || { cat build.log; return 1; }; }
build -f Dockerfile.single -t hello-go:single .
docker run --rm hello-go:single
```

```text output
Hello, DevForge! I run from a small image.
```

- The base image is pinned by **tag and digest**: people read the version, Docker uses exactly that image.
- `CGO_ENABLED=0` tells Go not to use the C toolchain, so the program does not depend on the C library — you need that in step 2.
- `build` keeps the builder's messages in `build.log` and shows them only if a build fails. Define it again in a new terminal.

### 2. The same program, built in stages

```bash run
cat > Dockerfile <<'EOF'
# Stage 1: everything needed to build the program.
FROM golang:1.27.3-alpine3.24@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS build
WORKDIR /src
COPY go.mod *.go ./
RUN CGO_ENABLED=0 go build -o /out/hello .

# Stage 2: the tests, run only when asked for (--target test).
FROM build AS test
RUN go test ./...

# Stage 3: only what is needed to run. This is the image you ship.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:aafe993665bf6200db38a02c11a9351e782a84b6a45e7f33b6695638c88e3931
COPY --from=build /out/hello /hello
ENTRYPOINT ["/hello"]
EOF
build -t hello-go:small .
docker run --rm hello-go:small Asha
docker image ls hello-go --format '{{.Repository}}:{{.Tag}} {{.Size}}' | sort
```

```text output
Hello, Asha! I run from a small image.
hello-go:single …MB
hello-go:small …MB
```

- The final stage starts `FROM` a distroless image and receives exactly one file from the build stage.
- When this lesson was recorded (x86-64, Docker Engine 29.1.3), the single-stage image was 287 MB and the multi-stage image 4.72 MB — about 60 times smaller, for the same program. Your sizes depend on your computer's architecture and on how Docker stores images, so the lesson shows them as `…`; expect a similar gap. Check it with exact byte counts:

```bash run
size() { docker image inspect -f '{{.Size}}' "$1"; }
echo "single-stage image over 100 MB: $([ "$(size hello-go:single)" -gt 100000000 ] && echo yes || echo no)"
echo "multi-stage image under 10 MB:  $([ "$(size hello-go:small)" -lt 10000000 ] && echo yes || echo no)"
echo "user in the small image: $(docker image inspect -f '{{.Config.User}}' hello-go:small)"
```

```text output
single-stage image over 100 MB: yes
multi-stage image under 10 MB:  yes
user in the small image: 65532
```

The `nonroot` variant of the distroless image already sets a non-root user, so the program does not run as root — without a `USER` line of your own.

### 3. What each image contains

```bash run
docker run --rm --entrypoint go hello-go:single env GOVERSION
docker run --rm --entrypoint ls hello-go:single /src
docker run --rm --entrypoint go hello-go:small version > /dev/null 2>&1 && echo "go found" || echo "no go in the small image"
docker run --rm --entrypoint sh hello-go:small -c true > /dev/null 2>&1 && echo "shell found" || echo "no shell in the small image"
```

```text output
go1.27.3
go.mod
main.go
main_test.go
no go in the small image
no shell in the small image
```

The single-stage image ships the whole Go toolchain and your source code. The small image has neither — and no shell either, so `docker exec … sh` will not work in it. That is less for an attacker to use, and it also means you debug differently (step 4).

### 4. Build one stage with --target

`--target` stops the build at the stage you name. Get the build stage as an image — the toolchain plus your source, handy for debugging a build:

```bash run
build --target build -t hello-go:build .
docker run --rm hello-go:build go env GOVERSION
docker run --rm hello-go:build ls /out
```

```text output
go1.27.3
hello
```

Now use the test stage as a gate. Break the program, and the tests stop the build:

```bash run
sed 's/a small image/a tiny image/' main.go > main.go.new && mv main.go.new main.go
docker build --target test -t hello-go:test . > test.log 2>&1 && echo "tests passed" || echo "tests failed: the build stopped"
grep -m1 -o 'FAIL: TestGreeting' test.log
```

```text output
tests failed: the build stopped
FAIL: TestGreeting
```

Put it back, and the same command passes:

```bash run
sed 's/a tiny image/a small image/' main.go > main.go.new && mv main.go.new main.go
docker build --target test -t hello-go:test . > test.log 2>&1 && echo "tests passed" || echo "tests failed: the build stopped"
```

```text output
tests passed
```

In CI, run `docker build --target test .` first and build the final image only when it passes. With BuildKit, a plain `docker build .` skips the test stage, because the final stage copies nothing from it.

### 5. Clean up

```bash run
cd ..
docker image rm hello-go:single hello-go:small hello-go:build hello-go:test > /dev/null
echo "removed"
```

```text output
removed
```

The base images stay in Docker's cache for the next build. To free their space too, remove them by name and digest, for example `docker image rm golang:1.27.3-alpine3.24@sha256:fa3d…` with the full digest from the Dockerfile.

## Common mistakes

- **Cleaning up in a later `RUN`.** `RUN apk del build-base` in the same stage hides the files but leaves them in the earlier layer, so the image stays large. Build in a separate stage instead.
- **A dynamically linked program on `scratch` or distroless static.** A program that needs the C library fails to start on an image without it. Build a static program (`CGO_ENABLED=0` for Go) or choose a final base that has the libraries, such as `gcr.io/distroless/base` or Alpine.
- **Expecting a plain build to run the tests.** With BuildKit, a stage that the final stage does not depend on is skipped. Run `--target test` explicitly in CI.
- **Referring to stages by number.** `COPY --from=0` breaks when someone adds a stage above it; name stages with `AS`.
- **Forgetting the runtime files.** `scratch` has no CA certificates, time zones or user entries. Copy them in yourself, or start from distroless static, which includes them.
- **No way to debug.** Distroless images have no shell. Use their `:debug` variants (which add a BusyBox shell) or a `--target` build of an earlier stage while investigating — not in production.

## Where this fits in a real system

A pipeline in **GitHub Actions** or **Jenkins** can run `docker build --target test` as its test step, then build and push the final image. Smaller images are faster to pull when **Kubernetes** starts new Pods, and fewer packages mean fewer findings when the image is scanned — the **supply-chain** lesson generates an inventory (SBOM) of exactly those packages. The lab *Optimise a slow, oversized image* applies the same idea to a C program with a `scratch` final stage.
