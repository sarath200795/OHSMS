FROM node:22-bookworm-slim
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev
COPY app/stack ./stack
COPY app/src/shared/data/adapters/postgresWire.js ./src/shared/data/adapters/postgresWire.js
COPY app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "stack/self-host.mjs"]
