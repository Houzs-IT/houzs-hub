-- Carres ERP files IT requests here, like Hookka, Houzs ERP and 2990s. Requests read CARRES-0001.
-- No key is stored here: issue it with `node scripts/issue-api-key.mjs CARRES` and set it
-- on the Carres Worker as IT_HUB_API_KEY.
INSERT INTO systems (code, name) VALUES ('CARRES', 'Carres') ON CONFLICT (code) DO NOTHING;
INSERT INTO ticket_sequences (system_code) VALUES ('CARRES') ON CONFLICT (system_code) DO NOTHING;
