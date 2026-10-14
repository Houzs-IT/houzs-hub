-- 017 — Houzs Connect (chat.houzscentury.com, the WhatsApp platform) joins as a reporting
-- system. Its key is issued separately by scripts/issue-api-key.mjs CONNECT; request codes
-- read CONNECT-0001.

INSERT INTO systems (code, name) VALUES ('CONNECT', 'Houzs Connect');
INSERT INTO ticket_sequences (system_code, next_n) VALUES ('CONNECT', 1);
