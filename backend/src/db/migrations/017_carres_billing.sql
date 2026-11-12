-- Carres becomes a billing system, so its AI usage (POST /api/v1/sys/ai-usage) is accepted and
-- an Anthropic workspace or charge can be set to it. Kept in step with BILLING_SYSTEMS in schema.ts.
-- The old system_code checks are dropped by what they say, not by name, then added back with CARRES.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE conrelid IN ('charges'::regclass, 'charge_splits'::regclass, 'vendor_workspaces'::regclass)
      AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%system_code%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE charges ADD CONSTRAINT charges_system_code_check
  CHECK (system_code IN ('', 'CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB', 'CARRES'));
ALTER TABLE charge_splits ADD CONSTRAINT charge_splits_system_code_check
  CHECK (system_code IN ('CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB', 'CARRES'));
ALTER TABLE vendor_workspaces ADD CONSTRAINT vendor_workspaces_system_code_check
  CHECK (system_code IN ('', 'CONTS', 'HC', 'HK', 'CONNECT', '2990', 'HUB', 'CARRES'));

-- Down: the same loop, then the three checks without 'CARRES' (only once no row uses CARRES).
