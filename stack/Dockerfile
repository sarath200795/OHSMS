# One company's dedicated environment: the control plane, the gateway, and
# the company's build of the app, in one container. docs/CONTROL-PLANE.md.
#
# Build from the repository root (the app and stack/ both live there):
#
#   docker build -f stack/Dockerfile \
#     --build-arg PUBLIC_ORIGIN=https://ehs.example.com \
#     --build-arg AUTH_METHOD=saml \
#     -t dedicated-env .
#
# The app's settings are compiled in (Vite reads VITE_* at build time), so
# each company gets its own image. Nothing secret is a build argument.

# ── 1. The company's build of the app ───────────────────────────────────────
FROM node:22-bookworm-slim AS app
WORKDIR /src

# Where this environment is served. The app sends /data, /auth and /presign
# to it, same-origin.
ARG PUBLIC_ORIGIN
# saml | oidc | supabase — from the provisioning request.
ARG AUTH_METHOD
# The company's own presign endpoint when it brought a bucket; empty means
# this environment's /presign.
ARG S3_PRESIGN_ENDPOINT=""

RUN test -n "$PUBLIC_ORIGIN" && test -n "$AUTH_METHOD" \
  || (echo "PUBLIC_ORIGIN and AUTH_METHOD build args are required" && exit 1)

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The same values fulfillment's publicEnv describes (stack/fulfill.mjs).
RUN VITE_DATA_DRIVER=postgres \
    VITE_DATA_GATEWAY="$PUBLIC_ORIGIN" \
    VITE_STORAGE_DRIVER=s3 \
    VITE_S3_PRESIGN_ENDPOINT="${S3_PRESIGN_ENDPOINT:-$PUBLIC_ORIGIN/presign}" \
    VITE_AUTH_METHOD="$AUTH_METHOD" \
    VITE_AUTH_TOTP=off \
    npm run build

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
