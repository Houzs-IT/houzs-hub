-- 015 — attachments are looked up by event when a comment is deleted, and
-- tickets are sorted by created_at for the new-ticket check.

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_event ON ticket_attachments(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
