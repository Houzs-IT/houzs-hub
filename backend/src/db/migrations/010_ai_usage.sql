-- AI cost per system. The company Anthropic organisation (it@) has a workspace per system;
-- the hub reads Anthropic's cost report once a day (services/anthropicUsage.ts) and keeps
-- the cost per workspace per day. A charge marked split_by_usage is shared across systems
-- each month by that month's cost, instead of a fixed % split.
CREATE TABLE vendor_workspaces (
  vendor TEXT NOT NULL,
  workspace_id TEXT NOT NULL, -- '' for the organisation's default workspace
  name TEXT NOT NULL DEFAULT '',
  system_code TEXT NOT NULL DEFAULT ''
    CHECK (system_code IN ('', 'CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB')),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (vendor, workspace_id)
);
ALTER TABLE vendor_workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE usage_costs (
  day TEXT NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  vendor TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  usd NUMERIC(14, 6) NOT NULL,
  PRIMARY KEY (day, vendor, workspace_id)
);
ALTER TABLE usage_costs ENABLE ROW LEVEL SECURITY;

ALTER TABLE charges ADD COLUMN split_by_usage INTEGER NOT NULL DEFAULT 0 CHECK (split_by_usage IN (0, 1));

-- The company organisation's API credit, separate from H01 (Wei Siang's own account,
-- which cannot report usage per system). Auto-reload tops it up on Card 6402.
INSERT INTO charges (register_id, company, vendor, service_type, used_for, plan, amount, currency, billed, card, status, key_name, split_by_usage, notes, created_at, updated_at, updated_by)
SELECT 'S08', 'Shared', 'Anthropic', 'AI',
  'API credit for the systems'' AI (scanning, assistant, agents...), split by each workspace''s usage',
  'Credit, auto-reload to $100 below $10', 108.00, 'USD', 'credit', 'Card 6402', 'confirmed',
  'Anthropic organisation Houzs Century (it@): workspaces Houzs ERP, Hookka', 1,
  'Split per system from Anthropic''s cost report each day. Needs the ANTHROPIC_ADMIN_KEY secret on the hub.',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'setup'
WHERE NOT EXISTS (SELECT 1 FROM charges WHERE register_id = 'S08');
