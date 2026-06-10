/**
 * 創鬥卡 · 幽靈池共用工具（M2）
 *
 * 一個地方定義「把玩家防守牌組凍結成 arena_ghosts 一筆」的邏輯，供：
 *   - functions/api/card/ghost/refresh.ts（玩家自刷：改牌組 / 打完一場時呼叫 = 決策案 1）
 *   - 未來 backfill（把既有種子 / 活躍玩家補進池）共用，避免兩處漂移。
 *
 * 公平鐵則 v2：快照只複製玩家「當前正規化四圍」，不含任何付費加成；
 * 數值即 arena_cards 的固定總預算正規化值，與 battle.ts 結算讀到的一致。
 */
import { tierIdx } from './arena-tier';

/** 凍結進 cards_json 的單卡形狀（與 battle.ts 模擬器吃的欄位對齊）。 */
export interface GhostCard {
  name: string;
  type: string;                 // ranged | melee | evade
  hp: number; atk: number; def: number; mob: number;
  special_name: string | null;
  photo_r2_key: string | null;  // 存 key（非 URL）→ 顯示時才組 /api/screenshot/<key>
  tone_id: string | null;
  moves: string | null;
  rarity: string;
}

export interface SnapshotResult {
  ghostId: string;
  tierIdx: number;
  cardCount: number;
}

/**
 * 把某玩家「當前防守牌組」凍結成一筆新的 active 幽靈快照。
 *
 * 流程（單一 DB.batch 原子寫入）：
 *   1. 讀 arena_players 防守牌組 + 區域偏好；JOIN users 拿暱稱。
 *   2. 撈出牌組各卡的完整數值 → 凍結成 cards_json。
 *   3. 退役該玩家舊的 active 幽靈（is_active=0）。
 *   4. INSERT 新快照（is_active=1，帶 rank_score/tier_idx/region 快照）。
 *   5. 回寫 arena_players.active_ghost_id / ghost_refreshed_at / tier_idx（快取）。
 *
 * @returns SnapshotResult；玩家沒有可出戰牌組時回 null（不灌池）。
 */
export async function buildGhostSnapshot(
  DB: D1Database,
  userId: string,
  now: number,
): Promise<SnapshotResult | null> {
  const prow = await DB.prepare(
    `SELECT p.ship_card_ids, p.ship_base_hp, p.rank_score,
            p.region_country, p.region_city, p.region_opt_in,
            u.display_name
     FROM arena_players p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ?`,
  ).bind(userId).first<any>();
  if (!prow) return null;

  let ids: string[] = [];
  try { ids = prow.ship_card_ids ? JSON.parse(prow.ship_card_ids) : []; } catch {}
  if (!ids.length) return null;

  const ph = ids.map(() => '?').join(',');
  const rows = (await DB.prepare(
    `SELECT id, name, type, hp, atk, def, mob, special_name, photo_r2_key, tone_id, moves, rarity
     FROM arena_cards WHERE user_id = ? AND id IN (${ph}) AND deleted_at IS NULL`,
  ).bind(userId, ...ids).all<any>()).results || [];
  if (!rows.length) return null;

  // 依 ship_card_ids 的順序重排（撈出來的順序不保證 = 出戰順序）
  const byId: Record<string, any> = {};
  for (const r of rows) byId[r.id] = r;
  const cards: GhostCard[] = ids.map((id) => byId[id]).filter(Boolean).map((c: any) => ({
    name: c.name,
    type: c.type,
    hp: c.hp, atk: c.atk, def: c.def, mob: c.mob,
    special_name: c.special_name ?? null,
    photo_r2_key: c.photo_r2_key ?? null,
    tone_id: c.tone_id ?? null,
    moves: c.moves ?? null,
    rarity: c.rarity ?? 'N',
  }));
  if (!cards.length) return null;

  const score = prow.rank_score || 0;
  const tIdx = tierIdx(score);
  const baseHp = prow.ship_base_hp || 800;

  // 區域只在 opt-in 時快照（隱私：未同意 → NULL → 只進全球池）
  const optIn = !!prow.region_opt_in;
  const country = optIn ? (prow.region_country ?? null) : null;
  const city = optIn ? (prow.region_city ?? null) : null;

  const ghostId = `ghost_${crypto.randomUUID()}`;
  const cardsJson = JSON.stringify(cards);

  await DB.batch([
    DB.prepare(`UPDATE arena_ghosts SET is_active = 0 WHERE user_id = ? AND is_active = 1`).bind(userId),
    DB.prepare(
      `INSERT INTO arena_ghosts
         (id, user_id, display_name, cards_json, ship_base_hp, rank_score, tier_idx,
          region_country, region_city, source, is_active, created_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', 1, ?, ?)`,
    ).bind(ghostId, userId, prow.display_name ?? null, cardsJson, baseHp, score, tIdx, country, city, now, now),
    DB.prepare(
      `UPDATE arena_players
         SET active_ghost_id = ?, ghost_refreshed_at = ?, tier_idx = ?
       WHERE user_id = ?`,
    ).bind(ghostId, now, tIdx, userId),
  ]);

  return { ghostId, tierIdx: tIdx, cardCount: cards.length };
}

/**
 * 把 arena_ghosts.cards_json 解析回卡陣列（battle.ts 用幽靈當對手時吃這個）。
 * 容錯：壞 JSON → 空陣列（呼叫端自行 fallback 隨機幽靈）。
 */
export function parseGhostCards(cardsJson: string | null | undefined): GhostCard[] {
  if (!cardsJson) return [];
  try {
    const a = JSON.parse(cardsJson);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
