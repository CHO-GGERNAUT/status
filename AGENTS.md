# Ggernaut Status

Public status page deployed to Cloudflare Pages with Pages Functions and D1.

## Boundaries

- `src/server/domain`: pure status and availability rules. No Cloudflare, HTTP, or React imports.
- `src/server/application`: heartbeat, public-status and reporter-management use cases through domain ports.
- `src/server/infrastructure`: D1 and token-authentication adapters.
- `src/server/interface`: HTTP request/response mapping.
- `functions`: thin Cloudflare Pages Function entry points.
- `src/web`: React status dashboard.
- `infra/cloudflare`: long-lived Cloudflare resources managed by Terraform.
- `reporter`: portable device heartbeat clients.
- `scripts`: admin API clients and protected secret/token files. Registration writes D1 through the API; do not generate registration SQL.
- Keep reporter source, installation instructions and behavior tests in this repository.

## Invariants

- Reporters push outbound HTTPS heartbeats once per minute.
- Collect device heartbeats only; Kubernetes status collection is not supported.
- A component is in outage after 180 seconds without a heartbeat.
- Components are independent; do not implement cascading or dependency-derived outages.
- Use Cloudflare receipt time as the authoritative availability timestamp.
- Never expose internal IPs, credentials, hardware details, or raw reporter payloads publicly.
- Store reporter token hashes in D1 and token plaintext only on the reporting host.
- Authenticate management endpoints with the server-only `STATUS_ADMIN_TOKEN` Pages secret. Never distribute it to reporters or the public frontend.
- Management responses must use `Cache-Control: no-store`; missing admin configuration must fail closed.
- Token rotation revokes the old token; metadata/permission edits preserve tokens and status history.

## Commands

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
pnpm check
```
