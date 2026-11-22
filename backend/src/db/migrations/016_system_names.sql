-- The owner's list of systems (2026-11-22): names say what each system is (ERP or POS).
-- Codes stay as they are, so every existing request keeps its number (HK-0012 stays HK-0012).
-- Houzs Connect stays: it still has open requests.
-- Two new places to file requests: IT Support (general IT, not one system) and Carres POS.
UPDATE systems SET name = 'Hookka ERP' WHERE code = 'HK';
UPDATE systems SET name = 'Houzs ERP' WHERE code = 'HC';
UPDATE systems SET name = 'Theconts ERP' WHERE code = 'CONTS';
UPDATE systems SET name = 'Carres ERP' WHERE code = 'CARRES';
UPDATE systems SET name = '2990s POS system' WHERE code = '2990';
INSERT INTO systems (code, name) VALUES ('IT', 'IT Support'), ('CPOS', 'Carres POS system')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO ticket_sequences (system_code) VALUES ('IT'), ('CPOS')
  ON CONFLICT (system_code) DO NOTHING;
