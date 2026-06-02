-- ==========================================================================
-- 0006 · Seed 'cat_unknown' 佔位 catalog row
-- 2026-06-01
-- ==========================================================================
-- 動機：
--   fb_listings.product_id NOT NULL + FK REFERENCES catalog(id)
--   當 AI 解析的型號 catalog 沒對應時，product_id 需要一個合法值。
--   設計成「特殊 cat_unknown row」+ is_active=0（不對外顯示）。
--   實際品名靠 fb_listings.raw_model_name 存。
--
--   未來 SEO 頁 /gundam/[slug] 用 catalog.is_active=1 過濾，
--   自然排除這些「未對應」listing 的展示路徑。
--   但 admin 後台、price aggregate 仍能看到（內部資料完整）。

INSERT OR IGNORE INTO catalog (
  id, slug, series, full_name, is_active, created_at, updated_at
) VALUES (
  'cat_unknown', '__unknown__', 'OTHER', '⚠️ 未對應型號', 0,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);
