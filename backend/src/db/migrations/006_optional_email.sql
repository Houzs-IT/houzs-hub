-- 006 — email is optional; the username is the sign-in name. UNIQUE still holds
-- for the emails that are set (Postgres lets many rows be NULL).

ALTER TABLE developers ALTER COLUMN email DROP NOT NULL;
