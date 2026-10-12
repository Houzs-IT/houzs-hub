-- 003 — developers sign in with username or email + password (replaces Cloudflare Access).
-- Rows are created by scripts/set-password.mjs; a NULL password_hash cannot sign in.

ALTER TABLE developers ADD COLUMN username TEXT;
ALTER TABLE developers ADD COLUMN password_hash TEXT;
ALTER TABLE developers ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE developers ADD COLUMN locked_until TEXT;
CREATE UNIQUE INDEX idx_developers_username ON developers(username);
