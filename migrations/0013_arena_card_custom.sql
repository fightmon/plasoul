-- 0013 · 創鬥卡 卡片自訂：語氣（單選）+ 招式（多掛）
-- tone_id: NULL = 用玩家預設語氣；否則對應 /data/tones.json 的 key
-- moves:   NULL = 該天性全部招式（全掛）；否則 JSON 字串陣列，啟用的招式 id
ALTER TABLE arena_cards ADD COLUMN tone_id TEXT;
ALTER TABLE arena_cards ADD COLUMN moves TEXT;
