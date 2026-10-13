-- 008 — deleting a ticket takes its events and attachment rows with it.
-- The attachment files in R2 are not removed; delete those separately.

ALTER TABLE ticket_events
  DROP CONSTRAINT ticket_events_ticket_id_fkey,
  ADD CONSTRAINT ticket_events_ticket_id_fkey
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;

ALTER TABLE ticket_attachments
  DROP CONSTRAINT ticket_attachments_ticket_id_fkey,
  ADD CONSTRAINT ticket_attachments_ticket_id_fkey
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  DROP CONSTRAINT ticket_attachments_event_id_fkey,
  ADD CONSTRAINT ticket_attachments_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES ticket_events(id) ON DELETE CASCADE;
