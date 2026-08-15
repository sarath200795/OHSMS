# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# The Cloud Run image for ohsms-server.
#
# This container is the authorization boundary. Everything it runs holds the
# Admin SDK, which bypasses firestore.rules entirely — so the aim here is to
# ship the smallest set of code that can serve a request, owned by somebody the
# process cannot become, and nothing else.
#
# Build and run it from THIS directory (server/), not the repo root:
#
#   docker build -t ohsms-server .
#   docker run --rm -e PORT=8081 -p 8081:8081 ohsms-server
#
# The build context is server/ on purpose. A context rooted at the repo would
# pull in src/ (the React app), dist/, functions/ and .env — see .dockerignore
# for why the last one matters.
# ─────────────────────────────────────────────────────────────────────────────

# node:22 to match `engines.node` in package.json and the runtime functions/
# already targets; a server that is tested on one major and deployed on another
# is a bug waiting for a syntax difference to surface it.
#
# -slim (Debian bookworm) rather than -alpine: alpine is musl, and firebase-admin
# pulls in the gRPC stack, which is the classic place a glibc/musl difference
# turns into a runtime failure that no local test reproduces. The repo's own
# docker-compose.yml is already on bookworm.
FROM node:22-slim AS deps

WORKDIR /app

# Only the manifests, so this layer is rebuilt when the dependencies change and
# not when a route does. The whole install is otherwise repeated on every edit.
COPY package.json package-lock.json ./

# `npm ci`, never `npm install`. ci installs exactly the lockfile; install is
# free to resolve a newer transitive version, which means the image can differ
# from the tree the tests passed against, silently, on a rebuild that changed
# nothing. --omit=dev drops vitest, supertest and their trees: a test runner in
# a production image is a few hundred packages of extra attack surface that
# cannot ever be reached by a request.
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim AS runtime

# Production for express (it caches instead of re-resolving per request) and,
# more importantly, so it is NOT `test` — src/firestore.js refuses to initialise
# firebase-admin when NODE_ENV is test and no emulator is configured, and that
# guard should never be the thing deciding whether production starts.
ENV NODE_ENV=production

WORKDIR /app

# No build stage, deliberately: the repo is ESM and runs as written, so there is
# nothing to transpile and no artifact whose provenance we would have to trust.
# The separate deps stage still earns its keep — npm's cache and the manifests
# stay behind in it rather than riding along in the final layers.
COPY --from=deps /app/node_modules ./node_modules

# package.json ships for one reason that is easy to miss: it carries
# `"type": "module"`. Without it Node treats every .js here as CommonJS and the
# first `import` fails at startup — a container that builds cleanly and cannot
# serve a single request.
COPY package.json ./

COPY src ./src

# LEFT OWNED BY ROOT, ON PURPOSE. The process below runs as `node`, so it can
# read its own code and cannot write it. If a handler is ever compromised, that
# is the difference between one bad request and an attacker rewriting
# src/authz/ and serving every subsequent request with the check removed.
# A `--chown=node:node` here would quietly give that away.
USER node

# Documentation only — Cloud Run ignores EXPOSE and injects its own PORT, which
# src/index.js reads (falling back to 8080, Cloud Run's default). Nothing here
# hardcodes a port.
EXPOSE 8080

# No HEALTHCHECK: Cloud Run does not run them, it probes the service on the
# endpoint configured on the revision. /healthz exists for that prober and is
# deliberately unauthenticated — see src/index.js.

# EXEC FORM MATTERS. This way node is PID 1 and receives SIGTERM directly, so
# the graceful shutdown in src/index.js actually runs. In shell form
# (`CMD node src/index.js`) /bin/sh is PID 1, does not forward signals, and
# Cloud Run's SIGTERM is swallowed — every in-flight request is cut when an
# instance is recycled, and on this server an in-flight request may be a
# half-finished write.
CMD ["node", "src/index.js"]
