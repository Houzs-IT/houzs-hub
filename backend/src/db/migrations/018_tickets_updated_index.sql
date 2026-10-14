-- 018 — the List's default sort is updated_at DESC, and "All statuses" views
-- cannot use the (status, updated_at) index.

CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at);
