FROM node:22-bookworm

# Install system deps:
# - curl + git: Devin CLI install + cloning MCP repos
# - python3 + pip: postgres-mcp via uvx
# - ca-certificates: TLS for API calls
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install uv (provides uvx for postgres-mcp)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install Devin CLI (Linux binary) — strip interactive setup call from installer
RUN curl -fsSL https://cli.devin.ai/install.sh -o /tmp/devin-install.sh \
    && sed -i 's|.*COMPILED_BIN_NAME. setup||g' /tmp/devin-install.sh \
    && bash /tmp/devin-install.sh \
    && rm /tmp/devin-install.sh \
    && ln -sf /root/.local/bin/devin /usr/local/bin/devin

# Enable pnpm
RUN corepack enable

# Build dokploy-mcp from local copy
COPY infra/dokploy/dokploy-mcp/ /opt/dokploy-mcp/
RUN cd /opt/dokploy-mcp && npm install && npm run build \
    && chmod 755 build/index.js

# Write Devin MCP config with Linux paths
RUN mkdir -p /root/.config/devin
COPY infra/dokploy/mcp_config.json /root/.config/devin/mcp_config.json

WORKDIR /app

# Copy lockfile and workspace config first for cache
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY infra/ ./infra/

# Install deps
RUN pnpm install --frozen-lockfile=false

# Build-time env vars needed by vite config (secrets guard)
ENV BETTER_AUTH_SECRET=3b9f04db62f81dd223d3f23eee073321572d64d9f0876d77b29c3e4b03f1e8fe
ENV ENCRYPTION_KEY=39fe16bb1f45837f8484e0039237c3e16bbbafe034b184cca9ae383cf7146f4e

# Build web
RUN pnpm --filter @rakazo/web build

# Generate Prisma client
RUN pnpm --filter @rakazo/db generate

ENV NODE_ENV=production
ENV DEVIN_CLI_PATH=/usr/local/bin/devin
ENV AGENT_RUNTIME=devin-cli
ENV SANDBOX_PROVIDER=fake
ENV WAKEUP_DRIVER=graphile

EXPOSE 3100 5173

# Default: run API. Worker overrides command.
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
