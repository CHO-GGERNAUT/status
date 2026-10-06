# Ggernaut Status

Public status page deployed to Cloudflare Pages with Pages Functions and D1.

## Boundaries

- `src/server/domain`: pure status and availability rules. No Cloudflare, HTTP, or React imports.
- `src/server/application`: heartbeat and public-status use cases through domain ports.
- `src/server/infrastructure`: D1 and token-authentication adapters.
- `src/server/interface`: HTTP request/response mapping.
- `functions`: thin Cloudflare Pages Function entry points.
- `src/web`: React status dashboard.
- `infra/cloudflare`: long-lived Cloudflare resources managed by Terraform.
- `reporter`: portable host and K3S heartbeat clients.
- `scripts`: component-registration SQL and scoped reporter-token file generation; no automatic D1 writes.
- `homelab` installs a pinned checkout of this repository. Keep reporter source and behavior tests here.

## Invariants

- Reporters push outbound HTTPS heartbeats once per minute.
- A component is in outage after 180 seconds without a heartbeat.
- Components are independent; do not implement cascading or dependency-derived outages.
- Use Cloudflare receipt time as the authoritative availability timestamp.
- Never expose internal IPs, credentials, hardware details, or raw reporter payloads publicly.
- Store reporter token hashes in D1 and token plaintext only on the reporting host.

## Commands

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
pnpm check
```
