FROM node:22-bookworm

# Install system deps for Devin CLI sandbox (bubblewrap + socat)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bwrap socat curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install Devin CLI (Linux binary)
RUN curl -fsSL https://cli.devin.ai/install.sh | bash

# Enable pnpm
RUN corepack enable

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
