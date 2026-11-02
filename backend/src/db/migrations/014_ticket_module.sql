-- The part of the reporting system a ticket is about (e.g. Sales Order, Delivery), so
-- Reports can show which module has the most problems. Systems send it with the ticket
-- (POST /api/v1/sys/tickets, field `module`); IT can set or correct it on the ticket page.
ALTER TABLE tickets ADD COLUMN module TEXT;

-- Changing the module writes a timeline event of kind 'module'. The kind check is dropped by
-- what it says rather than by name, in case the live database named it differently.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'ticket_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%' AND pg_get_constraintdef(oid) NOT LIKE '%author_kind%'
  LOOP
    EXECUTE format('ALTER TABLE ticket_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_kind_check
  CHECK (kind IN ('created', 'comment', 'status', 'assign', 'priority', 'type', 'module'));
