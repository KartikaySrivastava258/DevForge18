# One image for both roles: compose.yaml starts it as the API (node api.js) or the worker (node worker.js).

# Node.js 22 on Alpine, pinned by tag and digest.
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ENV NODE_ENV=production
WORKDIR /app

# Only the application files. Secrets never reach the builder (.dockerignore excludes secrets/), and the
# files are owned by root and read-only for the app's user, so a compromised process cannot change its code.
COPY app/package.json app/redis.js app/api.js app/worker.js app/healthcheck.js ./

# The node image's unprivileged user (uid 1000).
USER node

# Exec form, so node is PID 1 and receives SIGTERM directly; both programs handle it.
CMD ["node", "api.js"]
