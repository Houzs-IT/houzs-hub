-- 010 — when each reporting system last called the API with a valid key,
-- for the admin Integrations page.

ALTER TABLE systems ADD COLUMN last_call_at TEXT;
