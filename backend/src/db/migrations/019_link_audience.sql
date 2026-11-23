-- Guest booking links, second shape (owner, 2026-11-23): the person with the link picks the room
-- and the time range themselves. length_min now means the longest booking allowed; host_keys are
-- the people told about each booking and may be empty. audience: 'anyone' (visitors type their
-- own company) or 'staff' (the company must be one of ours; staff without an ERP login).
-- REVERSAL: ALTER TABLE meeting_links DROP COLUMN audience;
ALTER TABLE meeting_links ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'anyone';
ALTER TABLE meeting_links DROP CONSTRAINT IF EXISTS meeting_links_audience_check;
ALTER TABLE meeting_links ADD CONSTRAINT meeting_links_audience_check CHECK (audience IN ('anyone', 'staff'));
