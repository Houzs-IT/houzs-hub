-- AI cost per module, as estimated by the systems themselves. Houzs ERP logs every AI call
-- with its feature and company and sends a daily summary with its hub key
-- (POST /api/v1/sys/ai-usage). The hub never treats these estimates as money: they only
-- split the real cost Anthropic reports for the sender's workspace (usage_costs) between
-- modules, and between the companies (systems) the sender serves, e.g. Houzs and 2990s.
CREATE TABLE module_usage (
  day TEXT NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  vendor TEXT NOT NULL,
  source_system TEXT NOT NULL, -- the system that sent it; its workspace's cost is the one split
  system_code TEXT NOT NULL,   -- the system (company) the calls were for
  module TEXT NOT NULL,        -- the sender's own feature name, e.g. scan_so, assistant
  usd NUMERIC(14, 6) NOT NULL, -- the sender's estimate, used as a share only
  calls INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY (day, vendor, source_system, system_code, module)
);
ALTER TABLE module_usage ENABLE ROW LEVEL SECURITY;
