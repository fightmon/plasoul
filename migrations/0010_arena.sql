-- =================================================================
-- 0010 · 普拉魂創鬥卡 Arena（Phase 1 MVP）
-- 卡片 + 玩家（戰艦/零件/天梯分）。戰鬥為前端模擬，幽靈 = 玩家戰艦快照。
-- =================================================================

-- 機體卡（玩家拍成品 → AI 組裝）
CREATE TABLE arena_cards (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,                 -- FK → users.id（擁有者）
  name          TEXT NOT NULL,                 -- 原創呼號（非官方型號名）
  photo_r2_key  TEXT,                          -- 使用者模型照（R2: cards/...）

  -- 天性（固定）：射擊 ranged > 近身 melee > 閃躲 evade > 射擊
  type          TEXT NOT NULL DEFAULT 'ranged',-- 'ranged' | 'melee' | 'evade'

  -- 四圍（已正規化：固定總預算 → 公平。做工不影響。）
  hp            INTEGER NOT NULL,
  atk           INTEGER NOT NULL,
  def           INTEGER NOT NULL,
  mob           INTEGER NOT NULL,              -- 機動

  terrain       TEXT,                          -- 地形適性：宇宙/一般/水中/沙漠/森林/萬能
  special_name  TEXT,                          -- 必殺名（原創）
  special_desc  TEXT,                          -- 必殺描述
  flavor        TEXT,                          -- 一句機體介紹

  rarity        TEXT NOT NULL DEFAULT 'N',     -- N/R/SR/SSR（純亂數、純外觀、零戰力）

  -- 戰歷（外觀勳章用，零戰力）
  wins          INTEGER NOT NULL DEFAULT 0,
  battles       INTEGER NOT NULL DEFAULT 0,

  is_support    INTEGER NOT NULL DEFAULT 0,    -- 1 = 設為友軍支援卡（進公共池）
  is_seed       INTEGER NOT NULL DEFAULT 0,    -- 1 = 系統種子卡（starter/幽靈用）

  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER,

  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_arena_cards_user    ON arena_cards(user_id);
CREATE INDEX idx_arena_cards_support ON arena_cards(is_support);
CREATE INDEX idx_arena_cards_seed    ON arena_cards(is_seed);


-- 玩家（創鬥卡進度）
CREATE TABLE arena_players (
  user_id       TEXT PRIMARY KEY,
  parts         INTEGER NOT NULL DEFAULT 0,    -- 零件（組裝卡用）
  coins         INTEGER NOT NULL DEFAULT 0,    -- 金幣（買艦/格/外觀）
  rank_score    INTEGER NOT NULL DEFAULT 0,    -- 簡單天梯分（MVP 先用分數，之後做 F-SS）

  -- 戰艦（MVP 固定 3 格）
  ship_slots    INTEGER NOT NULL DEFAULT 3,
  ship_card_ids TEXT,                          -- JSON 陣列：出戰/防守(幽靈) 的卡 id
  ship_base_hp  INTEGER NOT NULL DEFAULT 800,

  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,

  is_seed       INTEGER NOT NULL DEFAULT 0,    -- 1 = 系統種子玩家（冷啟動幽靈）

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_arena_players_rank ON arena_players(rank_score);
CREATE INDEX idx_arena_players_seed ON arena_players(is_seed);
