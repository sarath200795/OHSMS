# A dedicated environment: the control plane, the gateway, and the app, in
# one container. docs/CONTROL-PLANE.md.
#
# One image serves every company. Nothing about a company is built in: the
# host tells the app its gateway, sign-in and file store at start-up
# (/runtime-config.js, stack/app.mjs), and everything else is environment
# variables and secrets given to the container. Build from the repository
# root (the app and stack/ both live there):
#
#   docker build -f stack/Dockerfile -t weehs-dedicated .

# ── 1. The app ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS app
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── 2. The server ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv

COPY stack/package.json stack/package-lock.json stack/
RUN cd stack && npm ci --omit=dev --no-audit --no-fund

# stack/ imports the policy helpers it shares with Cloud Functions and the
# app's wire format; those files, not their packages.
COPY stack/ stack/
COPY functions/lib/ functions/lib/
COPY src/shared/data/adapters/postgresWire.js src/shared/data/adapters/postgresWire.js
COPY --from=app /src/dist stack/public

USER node
WORKDIR /srv/stack
EXPOSE 8080
CMD ["node", "main.mjs"]
