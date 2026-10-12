-- 005 — a password an admin handed out works once: the next sign-in must choose
-- a new one. Set by account create / reset (Users page and set-password.mjs),
-- cleared when the user sets their own password.

ALTER TABLE developers ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
