# Noticeboard API image (finished — this project is about the Compose file).
# Node.js 22 on Alpine, pinned by tag and digest.
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json redis.js server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
