-- 016 — notifications are ticket events; each user has read up to one event id.
-- NULL until the first visit, which starts it at the newest event.

ALTER TABLE users ADD COLUMN notifications_seen_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ticket_events_kind ON ticket_events(kind, id);
