-- ==========================================================================
-- 0009 · batch_images 加 is_cover（封面圖旗標）
-- 2026-06-03
-- ==========================================================================
-- 動機：
--   一篇 FB 貼文（batch）可指定一張「封面圖」當代表圖，跟 AI 解析來源圖獨立。
--   封面本質是 batch 層級資料 → 存在已是 batch grain 的 batch_images，用旗標標記，
--   不反正規化到 fb_listings 每一列。
--
--   未來抽出 source_posts 實體時，batch_id → source_post_id，封面圖隨之承接，無痛。
--
--   一個 batch 只應有一張封面：目前由 admin UI 保證（一次只上傳一張封面）。
--   未來要 DB 層強制可加（現階段不加，避免 live 進資料時被約束打斷）：
--     CREATE UNIQUE INDEX idx_batch_cover_uniq ON batch_images(batch_id) WHERE is_cover = 1;

ALTER TABLE batch_images ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_batch_images_cover ON batch_images(batch_id, is_cover);
