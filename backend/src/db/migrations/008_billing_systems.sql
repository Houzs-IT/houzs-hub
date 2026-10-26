-- System billing by system: each charge belongs to one system, or is shared across
-- systems by a percentage. Billing systems are a fixed list kept here and in
-- schema.ts (BILLING_SYSTEMS); they are not the ticket systems table, so adding
-- the IT Hub here does not give it a ticket queue.
ALTER TABLE charges
  ADD COLUMN system_code TEXT NOT NULL DEFAULT ''
    CHECK (system_code IN ('', 'CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB')),
  ADD COLUMN project_ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN module TEXT NOT NULL DEFAULT '';

-- Per credit: paid up front as top-ups (AI credit). Per use: billed after for what was used.
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_billed_check;
ALTER TABLE charges ADD CONSTRAINT charges_billed_check CHECK (billed IN ('', 'monthly', 'yearly', 'credit', 'usage'));

-- A shared charge has no system_code and two or more splits adding up to 100.
CREATE TABLE charge_splits (
  charge_id INTEGER NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
  system_code TEXT NOT NULL CHECK (system_code IN ('CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB')),
  percent NUMERIC(5, 2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  PRIMARY KEY (charge_id, system_code)
);
ALTER TABLE charge_splits ENABLE ROW LEVEL SECURITY;

-- The sheet's free-text System, moved to a system where it names one. "Houzs ERP + Hookka",
-- "Company-wide" and "Personal use" stay unassigned for a person to set. The old text is kept.
UPDATE charges SET system_code = CASE system
    WHEN 'Property OS' THEN 'CONTS'
    WHEN 'Supply chain' THEN 'CONTS'
    WHEN 'Houzs ERP' THEN 'HC'
    WHEN 'Hookka system' THEN 'HK'
    WHEN 'Houzs Connect' THEN 'CONNECT'
    WHEN 'Houzs IT Hub' THEN 'HUB'
    ELSE '' END;
UPDATE charges SET module = 'Supply chain' WHERE system = 'Supply chain';
