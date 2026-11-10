-- A user can hold several roles; their permissions are all of those roles' together.
CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL REFERENCES roles(key),
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX user_roles_role_key_idx ON user_roles (role_key);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO user_roles (user_id, role_key) SELECT id, role FROM users;

-- users.role is no longer read or written. It stays one release so a Worker still on the old
-- code keeps working while this deploys; its foreign key goes now so roles can be deleted.
-- Dropped by what it says rather than by name, as the table was once called developers.
-- ponytail: drop users.role in the next migration once this code is live.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (role) REFERENCES roles%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Notifications (bell, unread count, new ticket sounds) are for developers only.
UPDATE roles SET permissions = permissions || ',notifications' WHERE key = 'developer';

-- Down: UPDATE users SET role = COALESCE((SELECT min(role_key) FROM user_roles WHERE user_id = users.id), 'developer');
--   ALTER TABLE users ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(key);
--   DROP TABLE user_roles; UPDATE roles SET permissions = replace(permissions, ',notifications', '');
