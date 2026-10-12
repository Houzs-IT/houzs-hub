-- 003 — Conts (The Conts, Property OS) joins as a reporting system. Its key is issued separately by
-- scripts/issue-api-key.mjs CONTS; request codes read CONTS-0001.

INSERT INTO systems (code, name) VALUES ('CONTS', 'Conts');
INSERT INTO ticket_sequences (system_code, next_n) VALUES ('CONTS', 1);
