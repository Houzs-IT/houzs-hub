-- Meeting emails go out through each company's own Mail Center (owner 2026-11-25): the hub writes the email,
-- the ERP the meeting was made in collects it (POST /mail/claim) and sends it with its own mail provider and
-- domain, then reports back (POST /mail/results). via = the ERP that sends it; IT Support meetings go via Houzs.
-- claimed_at: when an ERP took it; a claim with no report after 10 minutes is offered again (up to 5 tries).
-- REVERSAL: DROP INDEX IF EXISTS idx_meeting_mail_via; ALTER TABLE meeting_mail DROP COLUMN claimed_at; ALTER TABLE meeting_mail DROP COLUMN via;
ALTER TABLE meeting_mail ADD COLUMN IF NOT EXISTS via TEXT;
ALTER TABLE meeting_mail ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
UPDATE meeting_mail mm SET via = CASE WHEN m.created_in = 'IT' THEN 'HC' ELSE m.created_in END
  FROM meetings m WHERE m.id = mm.meeting_id AND mm.via IS NULL;
UPDATE meeting_mail SET via = 'HC' WHERE via IS NULL;
ALTER TABLE meeting_mail ALTER COLUMN via SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_mail_via ON meeting_mail (via, id) WHERE sent_at IS NULL;
