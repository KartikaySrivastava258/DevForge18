# DevForge 18 — production image.
# Build from the repository root:  docker build -f deploy/Dockerfile -t devforge18 .
#
# Base image pinned by version and digest (multi-arch index). Node 22.23.4, pushed to Docker Hub 2026-11-05.
# To update: pick a release at least 14 days old and take its index digest from the registry.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

# ---- build stage: install dev dependencies, validate content, bundle the frontend
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# npm ci installs exactly what package-lock.json records (versions and integrity hashes).
COPY package.json package-lock.json tsconfig*.json ./
RUN npm ci --no-audit --no-fund
COPY content ./content
COPY shared ./shared
COPY scripts ./scripts
COPY types ./types
COPY server ./server
COPY web ./web
RUN npm run build

# ---- runtime stage: only what the server needs, running as a non-root user
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/devforge.db \
    CONTENT_PATH=/app/build/content.json \
    WEB_ROOT=/app/build/web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY --from=build /app/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
# start-interval: probe every 2 s while starting, so Nginx (depends_on: service_healthy) starts within seconds.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
