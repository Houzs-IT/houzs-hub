-- 004 — roles. admin manages accounts on the Users page; developer works tickets only.
-- The first admin is made with: npm --prefix backend run user:set -- <email> <username> --admin

ALTER TABLE developers ADD COLUMN role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('admin', 'developer'));
