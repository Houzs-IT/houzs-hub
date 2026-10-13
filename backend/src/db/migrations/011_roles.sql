-- 011 — roles become rows admins can add, rename and give permissions to.
-- users.role stays the role key (Workers deployed before this one still read
-- it). Permissions are comma-joined keys, see services/perms.ts.
-- perm_allow / perm_deny override the role for one user; deny wins.

CREATE TABLE roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

INSERT INTO roles (key, name, permissions) VALUES
  ('admin', 'Admin', 'users,roles,integrations'),
  ('developer', 'Developer', '');

ALTER TABLE users
  DROP CONSTRAINT developers_role_check,
  ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(key),
  ADD COLUMN perm_allow TEXT NOT NULL DEFAULT '',
  ADD COLUMN perm_deny TEXT NOT NULL DEFAULT '';
