-- 018 — sorting the List by Updated with "All statuses" cannot use the
-- (status, updated_at) index.

CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at);
