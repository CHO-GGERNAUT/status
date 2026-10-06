# OPNsense reporter

OPNsense is FreeBSD-based and does not use systemd. Use the included configd action and the
OPNsense cron UI, separately from the homelab Linux Ansible role. This does not change Nginx,
firewall rules or routing. Requires working DNS, CA trust and outbound HTTPS.

Confirm curl >= 7.55.0 is available. Copy all files from `reporter/bin/` to
`/usr/local/libexec/ggernaut-status/`, root:wheel and 0755. Create a root:wheel 0700 directory
`/usr/local/etc/ggernaut-status` with a root:wheel 0600 `host.env` containing:

```text
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<opnsense reporter token>
STATUS_COMPONENT=opnsense
```

The token must already be registered for the `opnsense` component in production D1.
The wrapper exports the settings for the child reporter. This is a trusted shell file;
never make it writable by a non-root user or place it in a public repository.

Copy `actions_ggernautstatus.conf` from this directory to
`/usr/local/opnsense/service/conf/actions.d/actions_ggernautstatus.conf`, root:wheel and 0644.
Then, as root:

```sh
service configd restart
configctl ggernautstatus heartbeat
```

If successful, open **System → Settings → Cron**, add an enabled job with minutes `*`,
hours `*`, days/months/weekdays `*`, command **Ggernaut status heartbeat**, no parameters,
and save/apply. Avoid a second manual invocation in the same second as the scheduled job.
Check that `opnsense.lastReceivedAt` advances in the public API; configd success alone does
not prove the public page has refreshed. For direct output, run the wrapper with the env path
and `host` arguments once, outside the timer's scheduled invocation.

Keep custom scripts, action and protected env in a separate encrypted backup. A normal
OPNsense config.xml export does not contain these custom filesystem files. Recheck them
after upgrades. Do not put secrets into the configd action, cron arguments or Nginx configuration.

Action registration/reload follows the [official configd documentation](https://docs.opnsense.org/development/backend/configd.html).
