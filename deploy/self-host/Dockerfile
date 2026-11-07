FROM node:22-bookworm-slim
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev
# stack/self-host.mjs imports functions/lib at load (presign, workers). The
# first image left that tree out and exited ERR_MODULE_NOT_FOUND before
# /health existed. runtimeClosure.mjs is the list; the test refuses a COPY
# that does not cover every file in it.
COPY app/stack ./stack
COPY app/functions ./functions
COPY app/src/shared/data/adapters/postgresWire.js ./src/shared/data/adapters/postgresWire.js
COPY app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "stack/self-host.mjs"]
