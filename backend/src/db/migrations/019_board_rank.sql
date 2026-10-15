-- 019 — hand-sorted order of cards inside a Board column. NULL means not placed
-- yet (new tickets, or just moved to another column): those show on top.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS board_rank integer;
CREATE INDEX IF NOT EXISTS idx_tickets_status_board_rank ON tickets(status, board_rank);
