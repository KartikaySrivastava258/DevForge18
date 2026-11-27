# Notes API — container image

`server.js` is a small notes API with no dependencies outside Node.js. It keeps its notes in
`$DATA_DIR/notes.json` (`/data` by default), listens on `$PORT` (3000) and reads the admin token for
`DELETE /notes` from `NOTES_ADMIN_TOKEN` when it starts. The team wants to run it as a container image that
can be shared. The `Dockerfile` here is a first draft: it builds and runs, but it should not be shared.

## Requirements for the image

1. **Reproducible base.** Every `FROM` names a small base image by tag **and digest**
   (`FROM node:22.23.5-alpine@sha256:…`), so a rebuild next month uses the same image. The image stays under
   300 MB.
2. **No secrets inside.** The admin token is given at run time (`docker run -e NOTES_ADMIN_TOKEN=…`), never
   with `ENV` in the Dockerfile. `.env` and `.git` never reach the builder — a `.dockerignore` keeps them out of
   the build context.
3. **Not root.** The image's default user is unprivileged.
4. **Data in a volume.** Notes live in `/data`. With a named volume mounted there, notes survive removing the
   container and starting a new one — including the very first time, when the volume is new and empty.
5. **Stops cleanly.** `docker stop` ends the API within a few seconds with exit code 0 (`server.js` already
   handles `SIGTERM`; the process must receive it).

## Endpoints

| Request | Answer |
|---------|--------|
| `GET /health` | `200 {"status":"ok"}` when `/data` is writable, otherwise `503` with the reason |
| `GET /notes` | `200` and the list of notes |
| `POST /notes` with `{"text": "…"}` | `201` and the new note |
| `DELETE /notes` with `Authorization: Bearer <token>` | `204`, deletes every note |

## Try it

```bash
docker build -t notes-api:dev .
docker volume create notes-data
docker run -d --name notes -p 127.0.0.1:3000:3000 -v notes-data:/data -e NOTES_ADMIN_TOKEN=local-only-token notes-api:dev
curl -s http://127.0.0.1:3000/health
curl -s -X POST -H 'Content-Type: application/json' -d '{"text":"buy lab coat"}' http://127.0.0.1:3000/notes
docker rm -f notes            # then run it again: is the note still there?
```

Clean up with `docker rm -f notes`, `docker volume rm notes-data` and `docker image rm notes-api:dev`.
