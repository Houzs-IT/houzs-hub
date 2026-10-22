// The last 24 hours as 96 blocks of 15 minutes, oldest first, so a day of
// 5-minute checks (288) draws as a strip that always fits its card. Each block
// keeps its worst item (highest rank); a block with nothing in it has none.
export const BLOCKS = 96;
const BLOCK_MS = 15 * 60_000;

export type Block<T> = { from: number; worst: T | null; count: number };

export function toBlocks<T>(items: T[], at: (x: T) => string, rank: (x: T) => number, now = Date.now()): Block<T>[] {
  const start = now - BLOCKS * BLOCK_MS;
  const blocks: Block<T>[] = Array.from({ length: BLOCKS }, (_, i) => ({ from: start + i * BLOCK_MS, worst: null, count: 0 }));
  for (const x of items) {
    const i = Math.floor((Date.parse(at(x)) - start) / BLOCK_MS);
    const b = blocks[i];
    if (!b) continue;
    b.count += 1;
    if (!b.worst || rank(x) > rank(b.worst)) b.worst = x;
  }
  return blocks;
}
