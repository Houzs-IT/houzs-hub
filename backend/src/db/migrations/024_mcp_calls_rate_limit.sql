-- AI Connector round 3 (owner 2026-11-26): per-person rate limit (30 tool calls a minute,
-- 600 a day) counted from mcp_calls on user + created_at (services/mcp-store.ts countRecentCalls).
-- REVERSAL: DROP INDEX IF EXISTS mcp_calls_user_created_idx;
CREATE INDEX IF NOT EXISTS mcp_calls_user_created_idx ON mcp_calls (user_id, created_at);
