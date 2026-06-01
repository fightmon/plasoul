-- ==========================================================================
-- 普拉魂 PuraSoul v0.1 — Initial Schema (0001)
-- Target:   Cloudflare D1 SQLite (plasoul-db)
-- Created:  2026-06-01
-- Tables:   7 (users / catalog / fb_listings / price_alerts /
--              subscriptions / search_logs / garage_items)
-- Design:   含 v0.2 預留欄位（contributor / review_status）
--           含 legacy migrate 欄位（is_legacy / batch_id / source_url）
-- ==========================================================================


-- =================================================================
-- 1. users — 訂閱用戶
-- =================================================================
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash   TEXT,                       -- NULL = Google OAuth only
  display_name    TEXT,
  tier            TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'premium' | 'pro'
  tier_expires_at INTEGER,                    -- ms, NULL = free forever
  line_user_id    TEXT,                       -- LINE Messaging API 綁定
  google_id       TEXT UNIQUE,                -- Google OAuth sub
  role            TEXT NOT NULL DEFAULT 'user',-- 'user' | 'admin' (大毛)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX idx_users_tier ON users(tier);
CREATE INDEX idx_users_line ON users(line_user_id);


-- =================================================================
-- 2. catalog — 鋼彈型錄（SEO 主力，每筆對應 /gundam/[slug]）
-- =================================================================
CREATE TABLE catalog (
  id              TEXT PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL COLLATE NOCASE,  -- 'rg-rx-78-2'
  series          TEXT NOT NULL,              -- 'RG' / 'MG' / 'HG' / 'PG' / 'SDX'...
  scale           TEXT,                       -- '1/144' / '1/100' / '1/60'
  full_name       TEXT NOT NULL,              -- 'RG 1/144 RX-78-2 鋼彈'
  name_jp         TEXT,
  name_en         TEXT,
  franchise       TEXT,                       -- 'UC' / 'SEED' / '00' / 'G'...
  release_date    TEXT,                       -- YYYY-MM
  price_jp        INTEGER,                    -- 原廠定價（日元）
  price_tw        INTEGER,                    -- 台版定價（NTD）
  image_r2_key    TEXT,                       -- R2 key of catalog image
  dalong_link     TEXT,                       -- 大龍 review URL
  search_text     TEXT,                       -- 預計算搜尋字串（給 LIKE 用）
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_catalog_series    ON catalog(series);
CREATE INDEX idx_catalog_franchise ON catalog(franchise);
CREATE INDEX idx_catalog_active    ON catalog(is_active);


-- =================================================================
-- 3. fb_listings — 真實 PO 紀錄（核心 moat 資料）
-- =================================================================
CREATE TABLE fb_listings (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL,              -- FK → catalog.id

  -- 來源資訊（模物獵人 link/group → 對應這 4 欄）
  source_platform     TEXT NOT NULL DEFAULT 'fb_group',
                                              -- 'fb_group' / 'plurk' / 'komica'
                                              -- 'discord' / 'shopee_2nd'
  source_group_name   TEXT,                   -- '鋼彈交易市集' (模物獵人 group)
  source_url          TEXT,                   -- FB 貼文 URL (模物獵人 link)
  batch_id            TEXT,                   -- 同貼文多商品的批次 ID

  -- 商品 + 狀態
  price           INTEGER NOT NULL,
  condition       TEXT,                       -- 'new' / 'used' / 'damaged_box'
  status          TEXT NOT NULL DEFAULT 'available',
                                              -- 'available' / 'sold' / 'pending'
  notes           TEXT,

  -- 截圖證明（PRD § 3.2 法律要件，legacy = NULL）
  screenshot_r2_key   TEXT,
  screenshot_taken_at INTEGER,

  -- 🔮 v0.2 預留：用戶貢獻 + 審核
  contributor_user_id TEXT,                   -- NULL = 大毛 admin
  review_status       TEXT NOT NULL DEFAULT 'approved',
                                              -- 'pending' / 'approved' / 'rejected'
  review_notes        TEXT,

  -- Legacy 標記（從模物獵人 migrate 的 3000+ 筆 = 1）
  is_legacy       INTEGER NOT NULL DEFAULT 0,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (product_id)          REFERENCES catalog(id),
  FOREIGN KEY (contributor_user_id) REFERENCES users(id)
);
CREATE INDEX idx_fb_listings_product       ON fb_listings(product_id);
CREATE INDEX idx_fb_listings_review_status ON fb_listings(review_status);
CREATE INDEX idx_fb_listings_status        ON fb_listings(status);
CREATE INDEX idx_fb_listings_contributor   ON fb_listings(contributor_user_id);
CREATE INDEX idx_fb_listings_created_at    ON fb_listings(created_at);
CREATE INDEX idx_fb_listings_batch         ON fb_listings(batch_id);


-- =================================================================
-- 4. price_alerts — 降價警報訂閱
-- =================================================================
CREATE TABLE price_alerts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  trigger_price   INTEGER NOT NULL,           -- 跌破此價通知
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_triggered_at INTEGER,                  -- 避免短時間重複推播
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (user_id)    REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES catalog(id),
  UNIQUE (user_id, product_id)                -- 同用戶同產品只能一個警報
);
CREATE INDEX idx_price_alerts_active ON price_alerts(is_active);
CREATE INDEX idx_price_alerts_user   ON price_alerts(user_id);


-- =================================================================
-- 5. subscriptions — 訂閱付款紀錄（LINE Pay）
-- =================================================================
CREATE TABLE subscriptions (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  tier                     TEXT NOT NULL,     -- 'premium' / 'pro'
  billing_cycle            TEXT NOT NULL,     -- 'monthly' / 'yearly'
  amount                   INTEGER NOT NULL,  -- NT$ 99 / 990 / 199 / 1990
  line_pay_transaction_id  TEXT,
  period_start             INTEGER NOT NULL,
  period_end               INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active',
                                              -- 'active' / 'cancelled'
                                              -- 'expired' / 'refunded'
  created_at               INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_subscriptions_user       ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status     ON subscriptions(status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(period_end);


-- =================================================================
-- 6. search_logs — 搜尋分析 + freemium quota 計算
-- =================================================================
CREATE TABLE search_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,                       -- NULL = 未登入訪客
  query           TEXT NOT NULL,
  result_count    INTEGER,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_search_logs_user_created ON search_logs(user_id, created_at);


-- =================================================================
-- 7. garage_items — 副入口車庫
-- =================================================================
CREATE TABLE garage_items (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  condition       TEXT,                       -- 'new' / 'opened' / 'built'
  purchase_price  INTEGER,                    -- 用戶買價（市值算用）
  purchase_date   TEXT,                       -- YYYY-MM
  status          TEXT NOT NULL DEFAULT 'owned',
                                              -- 'owned' / 'wishlist' / 'sold'
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (user_id)    REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES catalog(id)
);
CREATE INDEX idx_garage_user        ON garage_items(user_id);
CREATE INDEX idx_garage_user_status ON garage_items(user_id, status);
