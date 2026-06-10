-- DRAFT 未套用
-- =================================================================
-- 0014 · 創鬥卡 M1 · 幽靈池資料模型（async 天梯地基）
-- =================================================================
-- 設計目標（依《系統開發企劃》§2.1 / 策略藍圖 v2 §2、§5）：
--   1. 幽靈防守牌組「快照」表 → 對手是凍結的牌組副本，與玩家當前牌組脫鉤
--      （玩家改牌不影響別人正在打的幽靈；可定期重灌保持新鮮）。
--   2. 天梯階（F~SS）落地成欄位，供配對 / 資訊霧分階查詢，不用每次重算。
--   3. 配對權重欄：登入區域（城市級、opt-in）作「偏好權重非硬隔間」。
--   4. 好友關聯：好友碼 + 好友邊，好友防守牌組可優先灌進你遇到的幽靈池。
--
-- ⚠️ 本檔為草稿，未對線上 D1 套用。等大毛確認階數切法 / 更新頻率再套。
-- 相容性：純 ADD COLUMN + 新表，不改既有欄位語意，0010~0013 既有資料可平滑升級。
-- =================================================================


-- -----------------------------------------------------------------
-- A. 幽靈防守牌組快照
-- -----------------------------------------------------------------
-- 一筆 = 某玩家在某時刻的防守艦隊「凍結副本」。天梯配對只讀這張表，
-- 不直接讀 arena_players.ship_card_ids（那是玩家「當下」編成，會變動）。
-- 卡的數值也一起快照進 cards_json，避免對手改卡 / 刪卡導致歷史對戰崩掉。
CREATE TABLE arena_ghosts (
  id            TEXT PRIMARY KEY,              -- ghost_xxx
  user_id       TEXT NOT NULL,                 -- 來源玩家（FK → users.id）
  display_name  TEXT,                          -- 快照當下的暱稱（顯示用，免 JOIN）

  -- 牌組快照：完整卡資料陣列（name/type/hp/atk/def/mob/special_name/photo_r2_key/tone_id/moves/rarity）
  -- 凍結 → 來源玩家之後改卡不影響此快照。
  cards_json    TEXT NOT NULL,                 -- JSON array of card objects
  ship_base_hp  INTEGER NOT NULL DEFAULT 800,

  -- 配對用快照值（建檔當下複製，配對查詢免 JOIN arena_players）
  rank_score    INTEGER NOT NULL DEFAULT 0,
  tier_idx      INTEGER NOT NULL DEFAULT 0,    -- 0=F … 7=SS（與 battle.ts TIER_MIN 對齊）

  -- 配對權重：區域（opt-in、城市級；NULL = 未提供 → 只進全球池）
  region_country TEXT,                         -- ISO-3166-1 alpha-2，例 'TW'
  region_city    TEXT,                         -- 城市級字串，例 'Taipei'

  source        TEXT NOT NULL DEFAULT 'player',-- 'player' | 'seed'（種子幽靈）| 'friend_inject'
  is_active     INTEGER NOT NULL DEFAULT 1,    -- 0 = 退役（被新快照取代 / 來源玩家刪號）

  created_at    INTEGER NOT NULL,              -- 快照產生時間（新鮮度判定用）
  refreshed_at  INTEGER NOT NULL,             -- 最近一次重灌時間

  FOREIGN KEY (user_id) REFERENCES users(id)
);
-- 配對主索引：依階 + 分數撈同段對手
CREATE INDEX idx_arena_ghosts_tier   ON arena_ghosts(tier_idx, rank_score);
CREATE INDEX idx_arena_ghosts_active ON arena_ghosts(is_active, tier_idx);
CREATE INDEX idx_arena_ghosts_region ON arena_ghosts(region_country, tier_idx);
CREATE INDEX idx_arena_ghosts_user   ON arena_ghosts(user_id);
CREATE INDEX idx_arena_ghosts_fresh  ON arena_ghosts(refreshed_at);


-- -----------------------------------------------------------------
-- B. arena_players 擴充（天梯階快取 + 區域偏好 + 好友碼 + 防守快照指標）
-- -----------------------------------------------------------------
-- tier_idx：快取階級（贏一場才重算），供資訊霧分階判斷免每次跑 tierIdx()。
ALTER TABLE arena_players ADD COLUMN tier_idx INTEGER NOT NULL DEFAULT 0;

-- 區域偏好（opt-in、城市級；NULL = 不參與在地權重 → 只進全球池）。隱私：可清為 NULL = 刪除。
ALTER TABLE arena_players ADD COLUMN region_country TEXT;
ALTER TABLE arena_players ADD COLUMN region_city    TEXT;
ALTER TABLE arena_players ADD COLUMN region_opt_in  INTEGER NOT NULL DEFAULT 0;

-- 好友碼：可分享的短碼（QR / 連結 / LINE 分享都用這個）。NULL = 尚未產生。
ALTER TABLE arena_players ADD COLUMN friend_code TEXT;

-- 防守快照指標：指向 arena_ghosts 最新一筆（避免重撈）；灌池後更新。
ALTER TABLE arena_players ADD COLUMN active_ghost_id    TEXT;
ALTER TABLE arena_players ADD COLUMN ghost_refreshed_at INTEGER NOT NULL DEFAULT 0;

-- 好友碼唯一索引（部分索引：只在非 NULL 時唯一）
CREATE UNIQUE INDEX idx_arena_players_friend_code ON arena_players(friend_code) WHERE friend_code IS NOT NULL;


-- -----------------------------------------------------------------
-- C. 好友關聯邊
-- -----------------------------------------------------------------
-- 一筆 = 一條有向好友關係（A 加了 B）。雙向需兩筆，或查詢時 OR 兩端。
-- 用途：①好友防守牌組優先灌進對方幽靈池（async 相遇）②好友戰（未來）對象清單。
-- 不走 FB/IG 名單匯入（已死）；全靠好友碼 / QR / 分享連結建立。
CREATE TABLE arena_friends (
  user_id     TEXT NOT NULL,                   -- 擁有此好友的人
  friend_id   TEXT NOT NULL,                   -- 對方
  source      TEXT NOT NULL DEFAULT 'code',    -- 'code' | 'qr' | 'link'
  created_at  INTEGER NOT NULL,

  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id)
);
CREATE INDEX idx_arena_friends_friend ON arena_friends(friend_id);


-- -----------------------------------------------------------------
-- D. 幽靈相遇紀錄（可選；好友 async 相遇通知用）
-- -----------------------------------------------------------------
-- 玩家在天梯打到「某好友的防守幽靈」時記一筆 → 前端跳「你遇到了 XXX 的防守」。
-- 與計分無關（純通知 / 對抗感）；可後排，但 schema 先留位避免之後再 migrate。
CREATE TABLE arena_encounters (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,                   -- 進攻方
  ghost_id    TEXT NOT NULL,                   -- 被遇到的幽靈
  ghost_owner TEXT,                            -- 幽靈來源玩家（好友判定用）
  is_friend   INTEGER NOT NULL DEFAULT 0,      -- 1 = 來源是好友
  win         INTEGER,                         -- 1/0/NULL
  created_at  INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_arena_encounters_user ON arena_encounters(user_id, created_at);
