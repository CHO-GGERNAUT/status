PRAGMA foreign_keys = ON;

CREATE TABLE components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL CHECK (group_key IN ('devices', 'k3s')),
  display_name TEXT NOT NULL,
  description TEXT,
  stale_after_seconds INTEGER NOT NULL DEFAULT 180 CHECK (stale_after_seconds >= 60),
  sort_order INTEGER NOT NULL DEFAULT 0,
  monitoring_started_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE reporters (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE reporter_components (
  reporter_id TEXT NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (reporter_id, component_id)
);

CREATE TABLE current_states (
  component_id INTEGER PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  reported_status TEXT NOT NULL CHECK (reported_status IN ('operational', 'degraded', 'outage')),
  message TEXT,
  observed_at INTEGER,
  received_at INTEGER NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES reporters(id),
  sequence INTEGER NOT NULL
);

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cause TEXT NOT NULL CHECK (cause IN ('reported', 'stale')),
  summary TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX idx_incidents_open_component
  ON incidents(component_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_incidents_component_started
  ON incidents(component_id, started_at DESC);

CREATE INDEX idx_incidents_ended
  ON incidents(ended_at);
