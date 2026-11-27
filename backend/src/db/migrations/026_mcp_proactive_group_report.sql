-- AI Connector round 4d (owner 2026-11-26 「加 全部一起做」).
--
-- D1 / D2 (morning brief email, urgent alerts), per person, opt-in, default OFF:
--   mcp_brief_subscriptions  one row per person who saved the settings on the AI Connector page.
--                            unsub_token = the random token in the emails' unsubscribe link.
--   mcp_proactive_keys       the debounce / idempotency ledger: person + key + Malaysia day.
--                            "brief" is a key too, so a second tick cannot send a second brief.
--                            INSERT ... ON CONFLICT DO NOTHING RETURNING = the claim.
--   mcp_proactive_sends      the send log (who, kind, how many items, status). NEVER the body.
--
-- D3 (group monthly report): the hub as an MCP CLIENT of each system's own connector, with
-- the admin's own OAuth grant there (services/group-report-*.ts, routes/groupReport.ts).
--   group_report_connections one row per system: the admin who connected it, the OAuth client
--                            the hub registered there, and the tokens AES-GCM encrypted with
--                            the GROUP_REPORT_KEY secret (never stored or logged in clear).
--   group_report_pending     a started "Connect": state hash, PKCE verifier (encrypted), 10 minutes.
--   group_reports            one row per report built; the HTML itself is in R2 (FILES)
--                            under group-reports/<id>.html. A scheduled report is unique per month.
--
-- Server-side only: RLS on, no policies.
-- REVERSAL: DROP TABLE IF EXISTS group_reports, group_report_pending, group_report_connections,
--           mcp_proactive_sends, mcp_proactive_keys, mcp_brief_subscriptions;
CREATE TABLE IF NOT EXISTS mcp_brief_subscriptions (
  user_id integer PRIMARY KEY,
  brief_enabled integer NOT NULL DEFAULT 0,
  brief_time text NOT NULL DEFAULT '08:00',
  brief_days text NOT NULL DEFAULT 'weekdays',
  alerts_enabled integer NOT NULL DEFAULT 0,
  unsub_token text NOT NULL UNIQUE,
  last_alert_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_proactive_keys (
  user_id integer NOT NULL,
  alert_key text NOT NULL,
  day text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_key, day)
);
CREATE TABLE IF NOT EXISTS mcp_proactive_sends (
  id text PRIMARY KEY,
  user_id integer NOT NULL,
  kind text NOT NULL,
  day text NOT NULL,
  items integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_proactive_sends_user_idx ON mcp_proactive_sends (user_id, created_at);

CREATE TABLE IF NOT EXISTS group_report_connections (
  system text PRIMARY KEY,
  user_id integer NOT NULL,
  mcp_url text NOT NULL,
  client_id text NOT NULL,
  token_endpoint text NOT NULL,
  access_enc text,
  access_expires_at timestamptz,
  refresh_enc text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error text
);
CREATE TABLE IF NOT EXISTS group_report_pending (
  state_hash text PRIMARY KEY,
  system text NOT NULL,
  user_id integer NOT NULL,
  verifier_enc text NOT NULL,
  client_id text NOT NULL,
  token_endpoint text NOT NULL,
  redirect_uri text NOT NULL,
  mcp_url text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS group_reports (
  id serial PRIMARY KEY,
  month text NOT NULL,
  kind text NOT NULL,
  built_by integer,
  built_at timestamptz NOT NULL DEFAULT now(),
  status_json text NOT NULL DEFAULT '[]',
  emailed_to text,
  emailed_at timestamptz,
  note text
);
CREATE UNIQUE INDEX IF NOT EXISTS group_reports_scheduled_month_uq ON group_reports (month) WHERE kind = 'scheduled';
CREATE INDEX IF NOT EXISTS group_reports_built_idx ON group_reports (built_at DESC);

ALTER TABLE mcp_brief_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_proactive_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_proactive_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_report_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_report_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_reports ENABLE ROW LEVEL SECURITY;
