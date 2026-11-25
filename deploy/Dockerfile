# DevForge 18 — production image.
# Build from the repository root:  docker build -f deploy/Dockerfile -t devforge18 .

# ---- build stage: install dev dependencies, validate content, bundle the frontend
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig*.json ./
RUN npm install --no-audit --no-fund
COPY content ./content
COPY shared ./shared
COPY scripts ./scripts
COPY types ./types
COPY server ./server
COPY web ./web
RUN npm run build

# ---- runtime stage: only what the server needs, running as a non-root user
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/devforge.db \
    CONTENT_PATH=/app/build/content.json \
    WEB_ROOT=/app/build/web
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY --from=build /app/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
