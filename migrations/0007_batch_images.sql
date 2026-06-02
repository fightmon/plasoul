-- ==========================================================================
-- 0007 · batch_images 表
-- 2026-06-01
-- ==========================================================================
-- 動機：
--   AI 解析後保存 listings 時，原始上傳的圖（FB 截圖 / 商品照）要存證據。
--   一張圖可解析出多筆 listings → 用 batch_id 關聯，1 對 N。
--
--   設計：fb_listings.batch_id 已存在（每次保存的同一篇貼文共用），
--        batch_images.batch_id 對應同一個 batch_id → 多對多自然關聯。
--
--   注意：跟 fb_listings.screenshot_r2_key 不同：
--     - screenshot_r2_key: 個別 listing 的「證據截圖」（未來打碼版用，1 對 1）
--     - batch_images: 原始上傳圖（解析來源、未打碼，1 batch 對 N 圖）

CREATE TABLE batch_images (
  id           TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER,
  width        INTEGER,
  height       INTEGER,
  uploaded_by  TEXT,                       -- user_id (admin)
  uploaded_at  INTEGER NOT NULL
);
CREATE INDEX idx_batch_images_batch ON batch_images(batch_id);
CREATE INDEX idx_batch_images_uploaded_at ON batch_images(uploaded_at);
