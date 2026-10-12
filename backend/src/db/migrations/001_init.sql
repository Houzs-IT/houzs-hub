-- 001 — systems, developers, tickets, timeline, attachments.
-- Timestamps are ISO-8601 UTC strings written by the Worker; the SPA renders GMT+8.

CREATE TABLE systems (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE ticket_sequences (
  system_code TEXT PRIMARY KEY REFERENCES systems(code),
  next_n INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE developers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  legacy_code TEXT,
  system_code TEXT NOT NULL REFERENCES systems(code),
  type TEXT NOT NULL CHECK (type IN ('bug', 'development')),
  priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'on_hold', 'testing', 'waiting_reporter', 'resolved', 'closed', 'rejected')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  reporter_external_id TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT,
  reporter_phone TEXT,
  reporter_department TEXT,
  page_url TEXT,
  user_agent TEXT,
  app_version TEXT,
  assignee_id INTEGER REFERENCES developers(id),
  picked_up_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  -- Drives the unread badge in the reporting system: unread when a developer
  -- acted publicly after reporter_seen_at.
  last_public_activity_at TEXT NOT NULL,
  last_public_actor TEXT NOT NULL CHECK (last_public_actor IN ('reporter', 'developer', 'system')),
  reporter_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_status ON tickets(status, updated_at);
CREATE INDEX idx_tickets_reporter ON tickets(system_code, reporter_external_id, updated_at);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id, status);

CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('created', 'comment', 'status', 'assign', 'priority', 'type')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'internal')),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('reporter', 'developer', 'system')),
  author_name TEXT NOT NULL,
  developer_id INTEGER REFERENCES developers(id),
  body TEXT,
  from_value TEXT,
  to_value TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, id);

-- Every attachment hangs off an event so an internal note's files inherit
-- its visibility and never reach the reporter.
CREATE TABLE ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  event_id INTEGER NOT NULL REFERENCES ticket_events(id),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);
