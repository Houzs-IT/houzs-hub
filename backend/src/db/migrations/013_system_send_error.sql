-- 013 — the last failed ticket send from each system, for the Integrations
-- page. Cleared by the next successful send.

ALTER TABLE systems ADD COLUMN last_send_error TEXT;
ALTER TABLE systems ADD COLUMN last_send_error_at TEXT;
