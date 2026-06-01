-- ==========================================================================
-- 0004 · fb_listings 加 shipping_text + meetup_text 結構化欄位
-- 2026-06-01
-- ==========================================================================
-- 動機：
--   原本所有運送/面交/付款資訊都塞在 notes 字串裡用「、」分隔，
--   前台沒辦法 highlight「賣貨便+45」「面交：台南」這類關鍵決策資訊。
--   獨立 2 欄讓 PRD § 3.3 結果頁能清楚呈現，也為 v0.2+ geo 篩選預留。

ALTER TABLE fb_listings ADD COLUMN shipping_text TEXT;
ALTER TABLE fb_listings ADD COLUMN meetup_text TEXT;
