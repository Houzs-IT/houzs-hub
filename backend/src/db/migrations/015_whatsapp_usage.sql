-- WhatsApp cost per company. Houzs Connect runs one Meta WhatsApp Business Account for several
-- companies (Houzs Century, Hookka, 2990s), one number each. Once a day Connect sends what Meta
-- charged each company's numbers this month and last (POST /api/v1/sys/usage-costs), kept in
-- usage_costs like Anthropic's cost per workspace; each Connect company is a workspace.
-- Meta bills in ringgit, so usage_costs now says which currency its amount is in (the column
-- keeps its old name, usd).
ALTER TABLE usage_costs ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';

-- The bill itself, shared between the systems by that usage. Card is left blank until IT
-- confirms which card pays Meta.
INSERT INTO charges (register_id, company, vendor, service_type, used_for, plan, amount, currency, billed, card, status, key_name, split_by_usage, notes, created_at, updated_at, updated_by)
SELECT (SELECT 'S' || lpad((COALESCE(max(substring(register_id FROM '^S(\d+)$')::int), 0) + 1)::text, 2, '0') FROM charges),
  'Shared', 'Meta (WhatsApp Business)', 'Messaging',
  'WhatsApp messages from Houzs Connect (chat.houzscentury.com), split by each company''s numbers',
  'Per message', NULL, 'MYR', 'usage', '', 'confirmed',
  'WhatsApp Business Account used by Houzs Connect', 1,
  'Split per company from Meta''s charges on each company''s numbers, sent by Houzs Connect every day.',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'setup'
WHERE NOT EXISTS (SELECT 1 FROM charges WHERE vendor = 'Meta (WhatsApp Business)' AND split_by_usage = 1);
