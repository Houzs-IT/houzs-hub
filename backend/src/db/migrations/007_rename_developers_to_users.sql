-- 007 — the accounts table is "users": it holds admins as well as developers.
-- Foreign keys (tickets.assignee_id, ticket_events), indexes and
-- row level security follow the table. ticket_events.developer_id becomes user_id.

ALTER TABLE developers RENAME TO users;
ALTER TABLE ticket_events RENAME COLUMN developer_id TO user_id;
