# OPNsense reporter

OPNsense does not use systemd. Install `status-host-reporter` and register it as a configd action,
then run that action once per minute through the OPNsense cron UI.

The reporter requires `curl` and these environment values:

```text
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<opnsense reporter token>
STATUS_COMPONENT=opnsense
```

Keep the token in a root-readable file and never place it in the public repository.
