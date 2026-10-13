-- 014 — "delete_tickets" permission: remove a ticket for good. Admin gets it;
-- other roles can be given it on the Roles page.

UPDATE roles
SET permissions = CASE WHEN permissions = '' THEN 'delete_tickets' ELSE permissions || ',delete_tickets' END
WHERE key = 'admin' AND ',' || permissions || ',' NOT LIKE '%,delete_tickets,%';
