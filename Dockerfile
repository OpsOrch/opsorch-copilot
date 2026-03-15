FROM node:20-bookworm-slim AS base

FROM base AS build-tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

FROM build-tools AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM build-tools AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM build-tools AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid 1001 copilot
RUN chown -R copilot:nodejs /app
USER copilot

EXPOSE 6060

ENV PORT=6060

CMD ["node", "dist/server.js"]
