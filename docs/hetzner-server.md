# Hetzner Server Inventory

Live reference for the Hetzner dedicated server managed via Dokploy.
Re-verify with SSH + Dokploy MCP before acting on anything below.

## Host

- **Hostname:** `ubuntu-16gb-nbg1-1`
- **SSH alias:** `hetzner` (configured in `~/.ssh/config`)
- **Arch:** aarch64 (ARM Neoverse-N1, 16 cores @ 2.0GHz)
- **RAM:** 30 GB (6.4 GB used, 24 GB available)
- **Swap:** 4 GB file-backed (1.6 GB used)
- **Disk:** 150 GB on `/dev/sda1` — **116 GB used (81%)** — needs attention
- **OS:** Ubuntu, kernel 6.8.0-137-generic
- **Docker:** 29.1.3
- **Tailscale:** running (port 41641)

## PaaS

- **Dokploy** v0.29.14 (container `dokploy.1.*`, image `dokploy/dokploy:v0.29.14`)
- **Traefik** v2.11 (container `dokploy-traefik.1.*`)
- **Dokploy Postgres** 16-alpine (container `dokploy-postgres.1.*`) — Dokploy's own DB
- **Dokploy Redis** 8 (container `dokploy-redis.1.*`)
- Dokploy organization ID: `8eCPWW6XiTjNwVRdqJFmo`
- Single project **"Main"** (`RYZgceiBqu06rWMTeyOlO`), single environment **"production"** (`0OptFxZpQqUKuoyWtcfPZ`)

## Dokploy services (production environment)

### Applications (8)
| Name | Application ID | Status |
|------|---------------|--------|
| TAAforthemasses | `YeXBtE5pY-Iwa6H5Vyao7` | done |
| FakeSharp | `app_fakesharp_unified` | done |
| CardsGoneCrazy | `MIny4k4Q_TRzlBlpJhhQS` | done |
| OIB Realty Engine | `618wp1QwxA1J_yReIUVXC` | done |
| RouteMyRetirement | `app_retire_web` | done |
| AeroEdge | `a3DrLJ5V00fJeXXmPaBn0` | done |
| TradeMyTheme | `app_trademytheme` | done |
| notify | `cYROhXnYWGdd8DkCbiKH1` | done |

### Databases
- **Postgres (2):** `3ulUXU88pz0nUEfVgB_X9`, `KEBPkmh1G4VXZ8zpgrl5E`
- **Redis (1):** `qOoPkvVT_z10SvNG71SFb`

### Compose stacks (6)
| Name | Compose ID | Status |
|------|-----------|--------|
| Langfuse | `FS7hff0e2QyxK0qtaWbXh` | done |
| SearXNG | `8oHgf9SoiKUzLSq6LyymQ` | done |
| Cloudflared | `cloudflared-tunnel-001` | done |
| ETF Platform | `7XMhmnRFPXp2uj-f4BYm_` | done |
| usesend | `6GFuqRPqFtMPIRLlYPnqF` | done |
| LiteLLM | `stDudp3El8oHrLxUYBTwy` | done |

## Notable standalone containers (not all via Dokploy)
- `postgres-central-0cqkco.1.*` — `raydoug/postgres-central:16-3.4-pgv` (multi-tenant Postgres)
- `main-jeff-lawson-jtsuvl.1.*` — `postgres:18` (tenant DB)
- `netdata` — monitoring (healthy)
- `uptime-kuma` — uptime monitoring (healthy)
- `local-registry` — Docker registry:2

## Observability notes
- **Load average:** ~8.38 (high). `containerd` at 129% CPU and `dockerd` at 115% CPU are the top consumers — investigate.
- **Disk:** 81% full. Docker volumes = 19 GB, container logs = 151 MB.
- **Backups:** `restic` is running (`forget --prune`, keep-daily 14 / weekly 8 / monthly 12 / last 5).

## MCP access
- Two Dokploy MCP servers are configured: `dokploy` (working) and `dokploy-mcp` (broken — `project-all` returns `projects.map is not a function`). Use `dokploy`.
- Other MCP servers available: `postgres`, `postgres-trade`, `postgres-etf`, `signoz`, `rakazo-connectors`, `kaggle`, `colab`, `plaid`, `plaid-dashboard`.
