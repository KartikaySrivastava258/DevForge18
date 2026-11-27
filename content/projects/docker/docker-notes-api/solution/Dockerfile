# Notes API image: small, reproducible, non-root, with its data in a volume at /data.

# Node.js 22 on Alpine Linux (a small base), pinned by digest so every build uses exactly the same image.
# The tag is for people; the digest is what Docker uses. Update both together, on purpose.
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# Only what the app needs, the file that changes least first. (No npm install: the API has no dependencies.)
COPY package.json ./
COPY server.js ./

# Create the data folder owned by the unprivileged "node" user that the base image provides (uid 1000).
# A new, empty named volume mounted here starts with this folder's owner — without the chown it would be
# owned by root and the app, running as node, could not write its notes.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

# Exec form: node itself is PID 1 and receives docker stop's SIGTERM (server.js handles it and exits with 0).
# The shell form ("CMD npm start") is run as /bin/sh -c "npm start", which leaves npm as PID 1 and node as its child.
CMD ["node", "server.js"]
