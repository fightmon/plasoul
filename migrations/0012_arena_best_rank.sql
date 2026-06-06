-- 0012 · 天梯牌位：記錄歷史最高分（首達牌位獎用）
ALTER TABLE arena_players ADD COLUMN best_rank INTEGER NOT NULL DEFAULT 0;
