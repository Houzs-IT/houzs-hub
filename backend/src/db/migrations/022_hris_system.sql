-- Houzs HRIS joins Meetings (owner 2026-11-25): HR staff book rooms and meetings from the HRIS back office.
-- api_key_hash is the SHA-256 of a random 256-bit key that lives only as the HRIS Worker's IT_HUB_API_KEY
-- secret; a hash of a random key reveals nothing, so it is safe to keep here. Rotate it with
-- `node scripts/issue-api-key.mjs HR`. HRIS has no mail provider: its meeting emails go via Houzs ERP (viaFor).
-- REVERSAL: DELETE FROM ticket_sequences WHERE system_code = 'HR'; DELETE FROM systems WHERE code = 'HR';
INSERT INTO systems (code, name, api_key_hash) VALUES ('HR', 'Houzs HRIS', '3d02f900cb90fe501c28d79e82c8fe217651ec47a841a0e02704dc7f245d0182') ON CONFLICT (code) DO NOTHING;
INSERT INTO ticket_sequences (system_code) VALUES ('HR') ON CONFLICT (system_code) DO NOTHING;
