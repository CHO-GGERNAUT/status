CREATE TABLE availability_initializations (
  component_id INTEGER PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  CHECK (ended_at > started_at)
);
