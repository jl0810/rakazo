FROM node:22-bookworm

# Install system deps:
# - bwrap + socat: Devin CLI sandbox
# - curl + git: Devin CLI install + cloning MCP repos
# - python3 + pip: postgres-mcp via uvx
# - ca-certificates: TLS for API calls
RUN apt-get update && apt-get install -y --no-install-recommends \
    bwrap socat curl ca-certificates git \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install uv (provides uvx for postgres-mcp)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install Devin CLI (Linux binary)
RUN curl -fsSL https://cli.devin.ai/install.sh | bash

# Enable pnpm
RUN corepack enable

# Clone and build dokploy-mcp from sysadmin repo
RUN git clone --depth 1 https://github.com/jl0810/sysadmin.git /opt/sysadmin \
    && cd /opt/sysadmin && npm install && npm run build \
    && chmod 755 build/index.js

# Write Devin MCP config with Linux paths
RUN mkdir -p /root/.config/devin
COPY infra/dokploy/mcp_config.json /root/.config/devin/mcp_config.json

WORKDIR /app

# Copy lockfile and workspace config first for cache
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY infra/ ./infra/

# Install deps
RUN pnpm install --frozen-lockfile=false

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
