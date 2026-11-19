# Stage 1: build the frontend.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY web web
RUN npm run build

# Stage 2: the runtime image, with only the server's production dependencies.
FROM node:26-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY --from=web /app/web/dist web/dist
# The data directory holds the database and must be writable by the unprivileged user.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
# Node runs the TypeScript sources directly, so there is no server build step.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
