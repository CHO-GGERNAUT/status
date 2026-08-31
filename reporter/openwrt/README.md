# OpenWrt reporter

Install `curl` and `status-host-reporter`, then invoke the reporter once per minute through cron or
a procd-supervised loop.

Example root crontab:

```cron
* * * * * . /etc/ggernaut-status.env && /usr/local/bin/status-host-reporter
```

The environment file must be readable only by root and contain:

```text
STATUS_REPORTER_URL=https://status.ggernaut.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<openwrt reporter token>
STATUS_COMPONENT=openwrt
```
