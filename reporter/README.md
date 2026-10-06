# Reporter operations

Reporters run on the host, outside Docker/Kubernetes. They send outbound HTTPS every minute;
there is no incoming listener, Authentik login, or PostgreSQL dependency. A host heartbeat
means this host can run the script and reach Cloudflare, not that every local application works.

## Token and destination

From this status checkout, register components from a private JSON file with
`pnpm --silent component:register local/components.json`, apply the generated SQL to D1,
then generate one token per host with
`pnpm token:create <reporter-id> <component-slug> --output-dir local/<reporter-id>`.
For the one selected K3S server use a separate token with all four slugs:
`pnpm token:create k3s-main k3s-api k3s-nodes k3s-dns k3s-ingress`.
Apply the generated register.sql to the correct D1 database before installing the token.env
value into private homelab host_vars. For interactive mode without --output-dir, apply only the
printed SQL, not the whole terminal output (which includes the secret and labels).
Keep credentials in private `local/` configuration (gitignored) or an encrypted inventory.
Never reuse production tokens in preview. Re-running token creation for an existing ID does not
rotate the stored token; its INSERT must not be blindly repeated.

Required environment:

```dotenv
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<registered-reporter-id.secret>
STATUS_COMPONENT=ubuntu-main-server
```

Each component should have one writer. Map to enabled, registered slugs in your private inventory.
See the [homelab deployment guide](https://github.com/CHO-GGERNAUT/homelab/blob/main/docs/status-reporters.md).
Devices need working DNS, CA trust, outbound TCP 443, an accurate clock and curl >= 7.55.0.
Credentials go to curl via stdin, not process arguments. HTTPS redirects are not followed;
only HTTP 202 counts as success. HTTP bodies and tokens are not logged.
Each transmission has a 10-second limit and no immediate retries: the next timer sends a fresh
sequence. Keep NTP enabled; a backwards clock or duplicate reporter can cause HTTP 409.

## Linux (Debian/Ubuntu, systemd)

Preferred: use homelab's deployment guide and `make status-reporters NODE=<inventory-host>`
from the homelab checkout. Set `status_reporter_source_dir` to this status checkout and
`status_reporter_revision` to its full commit SHA. Homelab verifies the pinned commit and clean
reporter files before copying anything. It does not clone, switch branches or provision D1 tokens.
The groups are opt-in and do not change Docker/K3S stacks.

For manual installation, after installing curl and CA certificates, create a system group/user
named `status-reporter` with no login shell or home. As root, from this checkout:

```sh
install -d -m 0755 /usr/local/libexec/ggernaut-status
install -m 0755 reporter/bin/* /usr/local/libexec/ggernaut-status/
install -d -m 0700 /etc/ggernaut-status
# Create /etc/ggernaut-status/host.env with the values above, root:root, mode 0600.
install -m 0644 reporter/systemd/status-host-reporter.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now status-host-reporter.timer
```

systemd reads the root-only EnvironmentFile before dropping to the `status-reporter` user.
The oneshot service can be inactive after a successful run; inspect its exit status/journal and
the timer rather than expecting a long-running service process. Do not start a second copy
manually at the same second as the timer. Removing a host from inventory does not uninstall an
already active reporter: explicitly disable its timer and revoke its D1 token when retiring it.

## K3S server only

Use one existing K3S server, not an agent or a pod, with separate root-owned 0600 `k3s.env`.
Set the URL/token above (no STATUS_COMPONENT) and optional overrides:

```dotenv
STATUS_K3S_BIN=/usr/local/bin/k3s
STATUS_K3S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
STATUS_K3S_DNS_NAMESPACE=kube-system
STATUS_K3S_DNS_WORKLOAD=coredns
STATUS_K3S_INGRESS_NAMESPACE=platform-system
STATUS_K3S_INGRESS_WORKLOAD=traefik
```

Install the matching `status-k3s-reporter.service`/`.timer` and enable its timer.
It runs as root with an explicit local kubeconfig; it does not use ambient KUBECONFIG.
Each of four read-only queries has a 5-second request timeout; systemd bounds the whole service
at 45 seconds. Even when `/readyz` fails, the other components are checked independently.
CoreDNS and ingress checks inspect desired/ready Deployment replicas, not DNS queries or external
HTTP routing. Missing ready replicas count as zero; nodes without a Ready condition count as unready.

## Routers and verification

- [OPNsense configd/cron](opnsense/README.md)
- [OpenWrt cron](openwrt/README.md)

Check `journalctl -u status-host-reporter.service -n 20 --no-pager` (or the K3S unit) for
`Heartbeat accepted (HTTP 202)`. Then confirm that the correct component's `lastReceivedAt`
advances at `https://status.ggernaut.com/api/v1/status`. An accepted heartbeat plus API state
is the live verification; script/unit installation alone is not. The public API can be cached.
401/403 means check token, DB environment and component permissions; 409 means clock/duplicate
sequence; transport failure means inspect DNS/TLS/egress. After 180 seconds without a heartbeat
a component is in outage, without inferring dependencies between components.

`pnpm check` includes offline shell tests with fake curl/K3S and temporary provisioning databases.
It does not register production tokens,
contact the cluster or demonstrate successful delivery from actual hardware.
