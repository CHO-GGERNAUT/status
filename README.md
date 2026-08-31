# Ggernaut Status

Public availability dashboard for homelab devices and K3S, served at
`https://status.ggernaut.com` with Cloudflare Pages, Pages Functions, and D1.

## Architecture

Each reporter sends an outbound HTTPS heartbeat once per minute. Components are independent and
become unavailable when no heartbeat has been received for 180 seconds. The service stores only
the latest component state and outage transitions; it does not retain every raw heartbeat.

```text
Ubuntu / Raspberry Pi systemd ─┐
OPNsense cron/configd ─────────┤
OpenWrt cron/procd ────────────┼─> Pages Functions ─> D1 ─> Pages dashboard
K3S host reporter ─────────────┘
```

## Local development

```bash
pnpm install
pnpm db:migrate:local
pnpm build
pnpm dev
```

The local Pages server includes the Functions routes and the same locally persisted D1 database
initialized by `db:migrate:local`. Open the URL printed by Wrangler. The standalone
`pnpm dev:web` command serves only the frontend and does not provide the API.

Run all checks with:

```bash
pnpm check
```

## Reporter provisioning

Create a token for one component:

```bash
pnpm token:create ubuntu-main ubuntu-main-server
```

Create a K3S reporter allowed to update all K3S components:

```bash
pnpm token:create k3s-main k3s-api k3s-nodes k3s-dns k3s-ingress
```

The command prints the plaintext token once and SQL containing only its SHA-256 hash. Apply the SQL
to D1, then store the plaintext token in Ansible Vault or the router's root-only configuration.

Linux systemd units and reporter scripts live under `reporter/`. The host reporter needs:

```text
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<reporter-id.secret>
STATUS_COMPONENT=ubuntu-main-server
```

Install the Linux reporter with Ansible in `homelab-infra` for real hosts. That repository should
copy the matching script and systemd units, render the environment file with mode `0600`, and
enable the timer. Keep these values in inventory/Vault rather than this public repository:

```yaml
status_reporter_url: https://status.ggernaut.com/api/v1/heartbeat
status_reporter_component: ubuntu-main-server
vault_status_reporter_token: <reporter-id.secret>
```

For a one-off Linux test, install `status-host-reporter` under
`/usr/local/libexec/ggernaut-status/`, the matching service and timer under `/etc/systemd/system/`,
and a root-owned `/etc/ggernaut-status/host.env`. Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now status-host-reporter.timer
sudo systemctl start status-host-reporter.service
sudo systemctl status status-host-reporter.service
```

Use the K3S reporter only on a server node with `/usr/local/bin/k3s`; it submits the API, node,
CoreDNS, and Traefik observations together. OPNsense and OpenWrt do not use systemd, so their
installation notes are under `reporter/opnsense/` and `reporter/openwrt/`.

## Cloudflare infrastructure

Terraform owns the two D1 databases, the Direct Upload Pages project, the production and preview
D1 bindings, and `status.ggernaut.com`.

```bash
cd infra/cloudflare
cp example.tfvars terraform.tfvars
terraform init
terraform plan
terraform apply
```

Set `CLOUDFLARE_API_TOKEN` in the shell. Configure a remote Terraform backend before the first
production apply; never commit Terraform state.

D1 schema migrations and application deployments remain application release steps:

```bash
pnpm wrangler d1 migrations apply status-production --remote
pnpm build
pnpm wrangler pages deploy dist --project-name=ggernaut-status
```

## GitHub Actions configuration

Repository secrets:

- `CLOUDFLARE_API_TOKEN`: Pages Edit and D1 Edit for application deployment

Repository variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `STATUS_PROJECT_NAME` = `ggernaut-status`
- `STATUS_D1_DATABASE_NAME` = `status-production`

Pushes to `main` run checks, apply pending D1 migrations, and deploy through Wrangler. Terraform
remains a manual operation from a trusted workstation with a configured remote backend; an
application release cannot accidentally create, destroy, or replace infrastructure.
