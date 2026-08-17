# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1 — deps: install ALL workspace deps
# Invalidated only when pnpm-lock.yaml changes, not on source edits.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps

RUN corepack enable

WORKDIR /app

# Manifests first — maximises layer cache on pnpm install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY infra/sandboxes/ ./infra/sandboxes/
COPY infra/compose/ ./infra/compose/
COPY infra/dokploy/dokploy-mcp/ ./infra/dokploy/dokploy-mcp/

RUN pnpm install --frozen-lockfile=false

# Generate Prisma/Drizzle client
RUN pnpm --filter @rakazo/db generate

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2 — builder: compile the Vite web app
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS builder

RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3 — runner: slim production image (~200MB base vs ~1.1GB full bookworm)
# api + worker run via `tsx src/index.ts` so source must be present at runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

RUN corepack enable

WORKDIR /app

# Copy the full workspace (source + node_modules) from builder.
# We need node_modules at runtime because tsx transpiles on-the-fly.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/pnpm-lock.yaml \
                    /app/pnpm-workspace.yaml \
                    /app/package.json \
                    /app/turbo.json \
                    /app/tsconfig.base.json ./

RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ENV NODE_ENV=production

EXPOSE 3100 5173 7091

# Default: run API. docker-compose overrides CMD per service.
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
