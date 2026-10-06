# Reporter operations

Reporters run on the host, outside Docker/Kubernetes. They send outbound HTTPS every minute;
there is no incoming listener, Authentik login, or PostgreSQL dependency. A host heartbeat
means this host can run the script and reach Cloudflare, not that every local application works.

## Token and destination

Configure the server-only `STATUS_ADMIN_TOKEN` Pages secret and the private management PC's
`local/admin.env` as described in the [status README](../README.md).
Add each host with one admin-authenticated `POST /api/v1/admin/reporters` containing
`{ "id": "nas", "name": "NAS" }`. The API registers the device and returns its individual token.
The CLI makes the same call: `pnpm token:create nas --name NAS --output-dir local/nas`.
Use the returned token and `STATUS_COMPONENT=nas` when installing this host's reporter.

For a reporter covering existing components, pass their slugs explicitly; register those
components first with `pnpm component:register local/components.json`.
The API registers the hash/permissions in D1; the CLI saves only `token.env` (0600) in a new
directory (0700). No SQL or plaintext token is printed. Install its value into the root-only reporter environment file.
Keep credentials in private `local/` configuration (gitignored) or an encrypted inventory.
Never put the admin Secret on a reporter or reuse production tokens in preview.
Existing IDs return 409. Explicitly rotate with `pnpm token:rotate <id> --output-dir local/<new-directory>`;
this revokes the previous token immediately. Update name/permissions/enabled state with
`pnpm reporter:update <id> <update.json>`; ordinary updates preserve the token.

Required environment:

```dotenv
STATUS_REPORTER_URL=https://status.example.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<registered-reporter-id.secret>
STATUS_COMPONENT=nas
```

Each component should have one writer. Configure enabled, registered slugs in the reporter environment file.
Devices need working DNS, CA trust, outbound TCP 443, an accurate clock and curl >= 7.55.0.
Credentials go to curl via stdin, not process arguments. HTTPS redirects are not followed;
only HTTP 202 counts as success. HTTP bodies and tokens are not logged.
Each transmission has a 10-second limit and no immediate retries: the next timer sends a fresh
sequence. Keep NTP enabled; a backwards clock or duplicate reporter can cause HTTP 409.

## Linux (Debian/Ubuntu, systemd)

From a reviewed status checkout, after installing curl and CA certificates, create a system group/user
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
already active reporter: explicitly disable its timer and disable it through the admin API when retiring it.

## Routers and verification

- [OPNsense configd/cron](opnsense/README.md)
- [OpenWrt cron](openwrt/README.md)

Check `journalctl -u status-host-reporter.service -n 20 --no-pager` for
`Heartbeat accepted (HTTP 202)`. Then confirm that the correct component's `lastReceivedAt`
advances at `https://status.example.com/api/v1/status`. An accepted heartbeat plus API state
is the live verification; script/unit installation alone is not. The public API can be cached.
401/403 means check token, DB environment and component permissions; 409 means clock/duplicate
sequence; transport failure means inspect DNS/TLS/egress. After 180 seconds without a heartbeat
a component is in outage, without inferring dependencies between components.

`pnpm check` includes offline shell tests with fake curl and temporary provisioning databases.
It does not register production tokens or demonstrate successful delivery from actual hardware.
