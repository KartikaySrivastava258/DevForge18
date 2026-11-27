# Campus Notes API image. The base image is pinned by digest (node:24.22.2-bookworm-slim, published
# 2026-11-05), so a rebuild of the same commit starts from exactly the same layers.
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
WORKDIR /app
ENV NODE_ENV=production
# Dependencies first: this layer is reused until package-lock.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
# The pipeline passes the commit; the label lets anyone trace an image back to its source.
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.title="campus-notes-api"
# The official Node.js images include an unprivileged user called node.
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
