-- Problems the hub has emailed about (or is about to). A row means the problem is open;
-- it goes when the problem is fixed and the "fixed" email has gone. See services/healthAlerts.ts.
CREATE TABLE health_alerts (
  key TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  what TEXT NOT NULL,
  since TEXT NOT NULL,
  emailed_at TEXT
);
ALTER TABLE health_alerts ENABLE ROW LEVEL SECURITY;
