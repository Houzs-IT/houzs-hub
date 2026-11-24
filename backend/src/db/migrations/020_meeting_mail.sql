-- Meeting emails (owner 2026-11-24): invitations, changes, cancellations, reminders and guest confirmations,
-- sent from the no-reply@ address of the company whose ERP the meeting (or guest link) was made in, through Resend. meeting_mail is the outbox (a failed send is retried by the 5-minute cron,
-- at most 5 times); meeting_reminders_sent remembers which reminder of which start time already went out, so a
-- moved meeting reminds again and a reminder is never sent twice.
-- meetings.guest_emails: people outside the ERPs invited by email; they get the same emails as everyone else.
-- REVERSAL: DROP TABLE meeting_reminders_sent; DROP TABLE meeting_mail; ALTER TABLE meetings DROP COLUMN guest_emails; ALTER TABLE meeting_rooms DROP COLUMN address;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS guest_emails TEXT[] NOT NULL DEFAULT '{}';
-- meeting_rooms.address: the full street address for visitors, shown with a map link in emails.
ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS meeting_mail (
  id BIGSERIAL PRIMARY KEY,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  to_emails TEXT[] NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_meeting_mail_unsent ON meeting_mail (created_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS meeting_reminders_sent (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, minutes, starts_at)
);
ALTER TABLE meeting_mail ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_reminders_sent ENABLE ROW LEVEL SECURITY;
