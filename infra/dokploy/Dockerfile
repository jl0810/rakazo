# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1 — tools: Devin CLI + uv + dokploy-mcp (built once, copied to runner)
# Using full bookworm here because the Devin installer needs bash + curl + git.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm AS tools

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install uv (provides uvx for postgres-mcp)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install Devin CLI — strip interactive setup call from installer
RUN curl -fsSL https://cli.devin.ai/install.sh -o /tmp/devin-install.sh \
    && sed -i 's|.*COMPILED_BIN_NAME. setup||g' /tmp/devin-install.sh \
    && bash /tmp/devin-install.sh \
    && rm /tmp/devin-install.sh \
    && ln -sf /root/.local/bin/devin /usr/local/bin/devin

# Build dokploy-mcp from local copy
COPY infra/dokploy/dokploy-mcp/ /opt/dokploy-mcp/
RUN corepack enable && cd /opt/dokploy-mcp && npm install && npm run build \
    && chmod 755 build/index.js

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2 — deps: install ALL workspace deps (cached layer, invalidated only
#           when pnpm-lock.yaml changes)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps

RUN corepack enable

WORKDIR /app

# Copy only manifests first — maximises cache hit on pnpm install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY infra/sandboxes/ ./infra/sandboxes/
COPY infra/dokploy/dokploy-mcp/ ./infra/dokploy/dokploy-mcp/

RUN pnpm install --frozen-lockfile=false

# Generate Prisma/Drizzle client
RUN pnpm --filter @rakazo/db generate

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3 — builder: compile the web app (Vite) — only invalidated when
#           source changes, not on every lockfile tweak
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS builder

# Build-time env vars required by vite config (secrets guard)
ENV BETTER_AUTH_SECRET=3b9f04db62f81dd223d3f23eee073321572d64d9f0876d77b29c3e4b03f1e8fe
ENV ENCRYPTION_KEY=39fe16bb1f45837f8484e0039237c3e16bbbafe034b184cca9ae383cf7146f4e

RUN pnpm --filter @rakazo/web build

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 4 — runner: slim production image
# node:22-bookworm-slim is ~200MB vs ~1.1GB for full bookworm
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Copy uv + Devin CLI from tools stage (no re-download)
COPY --from=tools /root/.local/bin/uv /root/.local/bin/uv
COPY --from=tools /root/.local/bin/uvx /root/.local/bin/uvx
COPY --from=tools /root/.local/bin/devin /root/.local/bin/devin
COPY --from=tools /opt/dokploy-mcp /opt/dokploy-mcp
ENV PATH="/root/.local/bin:$PATH"
RUN ln -sf /root/.local/bin/devin /usr/local/bin/devin

# Devin MCP config
RUN mkdir -p /root/.config/devin
COPY infra/dokploy/mcp_config.json /root/.config/devin/mcp_config.json

# Enable pnpm (needed to run `pnpm --filter ... start`)
RUN corepack enable

WORKDIR /app

# Copy full workspace source + deps from builder (api/worker run via tsx — no
# ahead-of-time compile step, so source must be present at runtime)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/pnpm-lock.yaml \
                    /app/pnpm-workspace.yaml \
                    /app/package.json \
                    /app/turbo.json \
                    /app/tsconfig.base.json ./

ENV NODE_ENV=production
ENV DEVIN_CLI_PATH=/usr/local/bin/devin
ENV AGENT_RUNTIME=devin-cli
ENV SANDBOX_PROVIDER=fake
ENV WAKEUP_DRIVER=graphile

EXPOSE 3100 5173

# Default: run API. Docker Compose / Dokploy overrides CMD for worker/web.
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
