# syntax=docker/dockerfile:1

# ---- build: web (Vite) + server (tsc) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY server server
COPY web web
RUN npm run build

# ---- production deps of the server only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist
WORKDIR /app/server
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist /app/web/dist
COPY server/package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

# unhealthy if the HTTP server is down or Telegram is disconnected (GramJS reconnects on its own)
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.json()).then(j=>process.exit(j.ok&&j.connected?0:1)).catch(()=>process.exit(1))"

# exec form, no npm: SIGTERM reaches node so it can flush the snapshot
CMD ["node", "dist/src/main.js"]
