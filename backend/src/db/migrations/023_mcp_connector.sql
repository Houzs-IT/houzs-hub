-- AI Connector (MCP), owner 2026-11-25 「把全部系统的mcp都complete掉」: IT staff ask Claude / ChatGPT
-- about the hub with their own login, read-only; an admin (Manage users) approves each person, sees
-- every lookup and can disconnect anyone. Tokens are stored as SHA-256 hashes only. Server-side only:
-- RLS on, no policies. See backend/src/routes/mcp.ts.
-- REVERSAL: DROP TABLE IF EXISTS mcp_calls, mcp_tokens, mcp_oauth_codes, mcp_auth_requests,
--   mcp_oauth_clients, mcp_access_requests, mcp_access;
CREATE TABLE IF NOT EXISTS mcp_access (
  user_id integer PRIMARY KEY,
  approved_by integer,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_access_requests (
  id text PRIMARY KEY,
  user_id integer NOT NULL,
  reason text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by integer,
  decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text,
  redirect_uris text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_auth_requests (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  state text,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  user_id integer NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id text PRIMARY KEY,
  user_id integer NOT NULL,
  client_id text NOT NULL,
  access_hash text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_hash text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_tokens_access_idx ON mcp_tokens (access_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_refresh_idx ON mcp_tokens (refresh_hash);
CREATE TABLE IF NOT EXISTS mcp_calls (
  id text PRIMARY KEY,
  token_id text,
  user_id integer NOT NULL,
  client_id text,
  tool text NOT NULL,
  target text,
  status integer,
  ok integer NOT NULL,
  note text,
  ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_calls_created_idx ON mcp_calls (created_at);
ALTER TABLE mcp_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_calls ENABLE ROW LEVEL SECURITY;
