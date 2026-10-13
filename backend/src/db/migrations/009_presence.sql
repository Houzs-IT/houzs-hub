-- 009 — the portal page each user last had open, for the "Online now" list.
-- Only trusted while last_seen_at is recent (see POST /presence in dev.ts).

ALTER TABLE users ADD COLUMN viewing_page TEXT;
