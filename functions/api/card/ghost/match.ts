/**
 * 創鬥卡 · M1 骨架 · 從幽靈池抓對手候選（async 天梯配對）
 * GET /api/card/ghost/match
 *
 * ⚠️ 骨架未接線：不寫/讀 DB、不依賴 0014 migration（草稿未套用）。
 *    現行配對暫時仍走 functions/api/card/ladder.ts（讀 arena_players 即時牌組）。
 *    本端點是 M2 要取代 ladder 候選邏輯的「打幽靈快照」版本。
 *
 * 設計（依《系統開發企劃》§2.1、§5-M2、migrations/0014_arena_ghost_pool.sql）：
 *  - 同戰力配對（鐵則）：tier_idx 相同 + rank_score 接近（±窗口）。
 *  - 區域權重「偏好非硬隔間」：先撈同國/同城同段，不足回退全球池（台灣小，硬切會空城）。
 *  - 好友優先：若 arena_friends 內好友有同段在池幽靈 → 提權重 / 插隊（製造 async 相遇）。
 *  - 資訊霧（依 fogLevel(myTierIdx)）：
 *      open        → 回傳對手 fleet（含天性，可挑）
 *      hidden_fleet→ 不回 fleet，只回對手存在 + 分數
 *      hidden_type → 連天性都不回（S 階）
 *  - 反洗分：候選不可被無限重撈挑軟柿子（沿用 ladder 的 RANDOM + 分數下限思路）。
 */
import { requireUser } from '../../../_lib/auth';
import { tierIdx, fogLevel } from '../../../_lib/arena-tier';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  // 規則骨架（先不查 DB，只把分階意圖固定下來）
  void tierIdx; void fogLevel;

  // TODO(M2 實作):
  //   1. 讀 me.rank_score → myTier = tierIdx(score)
  //   2. fog = fogLevel(myTier)
  //   3. 候選查詢：arena_ghosts WHERE is_active=1 AND tier_idx=myTier AND rank_score 接近
  //      → 區域權重：同國/同城優先；好友幽靈優先；不足回退全球
  //   4. 依 fog 決定回傳欄位（open 回 fleet / hidden_fleet 藏牌組 / hidden_type 連天性都藏）
  //   5. 命中好友幽靈 → 寫 arena_encounters（通知用）
  return new Response(
    JSON.stringify({ ok: false, code: 'NOT_IMPLEMENTED', message: 'ghost match 骨架（0014 未套用，暫用 /api/card/ladder）' }),
    { status: 501, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
