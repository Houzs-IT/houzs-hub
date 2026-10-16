-- Set when a developer edits their reply or internal note, so the timeline can say "edited".
ALTER TABLE ticket_events ADD COLUMN edited_at TEXT;
