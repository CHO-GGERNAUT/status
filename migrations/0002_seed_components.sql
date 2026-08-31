INSERT INTO components
  (slug, group_key, display_name, description, stale_after_seconds, sort_order, monitoring_started_at)
VALUES
  ('opnsense', 'devices', 'OPNsense', 'Gateway and firewall', 180, 10, unixepoch()),
  ('openwrt', 'devices', 'OpenWrt', 'Wireless network', 180, 20, unixepoch()),
  ('ubuntu-main-server', 'devices', 'Main Server', 'Primary compute node', 180, 30, unixepoch()),
  ('ubuntu-sub-server', 'devices', 'Sub Server', 'Secondary compute node', 180, 40, unixepoch()),
  ('rpi5-0', 'devices', 'Raspberry Pi', 'Edge compute node', 180, 50, unixepoch()),
  ('k3s-api', 'k3s', 'Kubernetes API', 'K3S control plane readiness', 180, 10, unixepoch()),
  ('k3s-nodes', 'k3s', 'K3S Nodes', 'Kubernetes node readiness', 180, 20, unixepoch()),
  ('k3s-dns', 'k3s', 'Cluster DNS', 'CoreDNS availability', 180, 30, unixepoch()),
  ('k3s-ingress', 'k3s', 'Ingress', 'Traefik availability', 180, 40, unixepoch())
ON CONFLICT(slug) DO UPDATE SET
  group_key = excluded.group_key,
  display_name = excluded.display_name,
  description = excluded.description,
  stale_after_seconds = excluded.stale_after_seconds,
  sort_order = excluded.sort_order,
  enabled = 1;
