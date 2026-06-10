/**
 * 創鬥卡 · M1 骨架 · 灌幽靈池（把玩家近期防守牌組快照進 arena_ghosts）
 * POST /api/card/ghost/refresh
 *
 * ⚠️ 骨架未接線：不寫 DB、不依賴 0014 migration（草稿未套用）。等大毛確認後再實作。
 *
 * 設計（依《系統開發企劃》§2.1、migrations/0014_arena_ghost_pool.sql）：
 *  - 觸發時機（待大毛決策更新頻率）：
 *      A) 玩家編成 / 出擊後順手灌（最即時，但寫入頻繁）
 *      B) 定時批次（cron / 後台），抓近期活躍玩家重灌（省寫入，但有延遲）
 *      C) 混合：出擊時標記 dirty，批次只重灌 dirty 的（建議）
 *  - 流程：
 *      1. 讀 arena_players.ship_card_ids + arena_cards 組出完整牌組
 *      2. 凍結成 cards_json（含數值快照），連同 rank_score/tier_idx/region 寫入 arena_ghosts
 *      3. 舊快照 is_active=0（退役），新快照 is_active=1
 *      4. 回寫 arena_players.active_ghost_id / ghost_refreshed_at
 *  - 公平：快照不含任何付費加成；數值即玩家當前正規化四圍。
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  // TODO(M1 實作): 讀玩家牌組 → 凍結快照 → upsert arena_ghosts → 退役舊快照 → 回寫指標
  // TODO(M2): 區域權重欄位（region_country/city）一併快照
  return new Response(
    JSON.stringify({ ok: false, code: 'NOT_IMPLEMENTED', message: 'ghost refresh 骨架（0014 未套用）' }),
    { status: 501, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
