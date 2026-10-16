-- Notifications read one by one above users.notifications_seen_id.
-- "Mark all as read" moves that mark and clears these rows, so the table stays small.
CREATE TABLE notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, event_id)
);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
