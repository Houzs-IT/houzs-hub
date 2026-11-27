-- AI Connector round 4b (owner 2026-11-26): write actions with confirmation.
-- mcp_settings        the admin switches on Admin > AI Connector: "actions_enabled" (the main
--                     "Allow AI actions" switch) and one per action ("action_ticket",
--                     "action_ticket_comment", "action_ticket_update"). No row = OFF.
-- mcp_pending_actions one row per propose_* call: single use, 10 minutes, same token + person.
--                     payload_json is blanked once the action ran or was cancelled.
-- Server-side only: RLS on, no policies. See backend/src/services/mcp-write-actions.ts.
-- REVERSAL: DROP TABLE IF EXISTS mcp_pending_actions, mcp_settings;
CREATE TABLE IF NOT EXISTS mcp_settings (
  key text PRIMARY KEY,
  enabled integer NOT NULL DEFAULT 0,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_pending_actions (
  id text PRIMARY KEY,
  token_id text NOT NULL,
  user_id integer NOT NULL,
  kind text NOT NULL,
  payload_json text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  cancelled_at timestamptz,
  result_status integer,
  result_note text
);
CREATE INDEX IF NOT EXISTS mcp_pending_actions_user_used_idx ON mcp_pending_actions (user_id, used_at);
ALTER TABLE mcp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_pending_actions ENABLE ROW LEVEL SECURITY;
