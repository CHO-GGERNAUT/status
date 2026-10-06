# OpenWrt reporter

Install curl >= 7.55.0 and CA certificates using the package manager for your OpenWrt release.
Copy all files from `reporter/bin/` to `/usr/local/libexec/ggernaut-status/`, root-owned and 0755.
`status-common.sh` is required beside the reporter. Use cron independently of Docker/K3S.

Example root crontab:

```cron
* * * * * /usr/local/libexec/ggernaut-status/status-run-reporter /etc/ggernaut-status.env host
```

Create `/etc/ggernaut-status.env`, root:root and 0600, containing:

```text
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<openwrt reporter token>
STATUS_COMPONENT=openwrt
```

The wrapper loads the root-controlled shell file with `set -a`, so plain assignments are
exported to the child process. Sourcing it without export would not work. Never source a file
writable by an untrusted user. The token must already be registered in production D1 for `openwrt`.

Ensure root's cron has `/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin` in PATH (set PATH explicitly
in the crontab if needed). Add only one job using `crontab -e`; do not replace other jobs.
Run the wrapper once before enabling cron and check for `Heartbeat accepted (HTTP 202)` and
the `openwrt` component's `lastReceivedAt` in the public API. Do not disable TLS verification.

Verify the cron daemon is enabled/running with `/etc/init.d/cron status`, then use `logread`
for scheduling failures. The request itself is bounded to 10 seconds. Keep the script/config
paths in your router's upgrade backup plan and check they survive upgrades; custom files are
not guaranteed to be included automatically. Never publish token files with your router backup.
