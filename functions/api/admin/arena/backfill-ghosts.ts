/**
 * 創鬥卡 · M2 · 幽靈池冷啟動 backfill（admin）
 * POST /api/admin/arena/backfill-ghosts   body: { force?: boolean }
 * → { ok, total, built, skipped }
 *
 * 用途：arena_ghosts 是 M1 新表、初始為空 → ghost/match 撈不到人。
 *       此端點把「現有有防守牌組的玩家＋種子玩家」逐筆用 buildGhostSnapshot 灌進池，
 *       讓天梯幽靈配對一開機就有對手。冷啟動跑一次即可；之後靠玩家自刷（決策案 1）維持。
 *
 * - force=false（預設）：只灌「還沒有 active 幽靈」的玩家（active_ghost_id IS NULL）→ 可安全重跑、不重複。
 * - force=true：全部重灌（退役舊快照、插最新）→ 改了卡正規化規則等需整池刷新時用。
 *
 * 重用 _lib/arena-ghost.ts 的共用邏輯，與玩家自刷同一條路徑，避免兩處漂移。
 * 注意：逐筆 sequential 寫入；玩家量大時應改批次/分頁（冷啟動量小，先簡單）。
 */
import { requireAdmin } from '../../../_lib/auth';
import { buildGhostSnapshot } from '../../../_lib/arena-ghost';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const hdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;

  let body: any = {}; try { body = await context.request.json(); } catch {}
  const force = body?.force === true;

  // 有防守牌組的玩家；非 force 時跳過已有 active 幽靈者
  const where = force
    ? `ship_card_ids IS NOT NULL AND ship_card_ids != '[]'`
    : `ship_card_ids IS NOT NULL AND ship_card_ids != '[]' AND active_ghost_id IS NULL`;
  const rows = (await DB.prepare(
    `SELECT user_id FROM arena_players WHERE ${where}`,
  ).all<any>()).results || [];

  const now = Date.now();
  let built = 0, skipped = 0;
  for (const r of rows) {
    const snap = await buildGhostSnapshot(DB, r.user_id, now);
    if (snap) built++; else skipped++;   // 牌組卡已刪等 → 灌不成，略過
  }

  return new Response(
    JSON.stringify({ ok: true, total: rows.length, built, skipped }),
    { status: 200, headers: hdr },
  );
};
