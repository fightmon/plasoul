-- ==========================================================================
-- 0005 · fb_listings ADD raw_model_name
-- 2026-06-01
-- ==========================================================================
-- 動機：
--   原本 product_id auto-match catalog；如果 catalog 沒有對應型號，
--   product_id='cat_unknown'，列表就看不到 admin 記了什麼名字。
--   加 raw_model_name 永遠存 AI 解析 / admin 編輯後的品名，
--   未來 catalog 改名 / merge 也能查歷史。

ALTER TABLE fb_listings ADD COLUMN raw_model_name TEXT;
CREATE INDEX idx_fb_listings_raw_model ON fb_listings(raw_model_name);
