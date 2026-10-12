-- 002 — the systems that can file tickets. API keys are issued separately by
-- scripts/issue-api-key.mjs so no secret material lives in a migration.

INSERT INTO systems (code, name) VALUES
  ('HK', 'Hookka'),
  ('HC', 'Houzs Century'),
  ('2990', '2990s');

INSERT INTO ticket_sequences (system_code, next_n) VALUES
  ('HK', 1),
  ('HC', 1),
  ('2990', 1);
