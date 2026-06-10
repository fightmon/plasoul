/**
 * 創鬥卡 · M1 骨架 · 好友碼（取得 / 產生我的可分享 ID；用對方好友碼加好友）
 * GET  /api/card/friend/code            → { ok, friend_code }（無則產生）
 * POST /api/card/friend/code  { code }  → 用對方好友碼建立好友邊（含好友幽靈灌池）
 *
 * ⚠️ 骨架未接線：不寫/讀 DB、不依賴 0014 migration（草稿未套用）。
 *
 * 設計（依《系統開發企劃》§2.4、策略藍圖 v2 §5）：
 *  - 不走 FB/IG 名單匯入（已死）。好友碼是零依賴最穩的主路徑；QR / 分享連結共用此碼。
 *  - friend_code：短、可讀、不易撞（例 6~8 碼 base32，存 arena_players.friend_code，唯一索引）。
 *  - 加好友後：把對方防守幽靈優先灌進我的池（arena_ghosts source='friend_inject'）→ 爬天梯會 async 相遇。
 *  - 好友戰（未來）不計天梯 / 不給獎勵（策略藍圖 v2 §2.4）。
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  // TODO(M4 實作): 讀 arena_players.friend_code；無則產生唯一短碼並寫回
  return notImpl();
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  // TODO(M4 實作): 解析 body.code → 查擁有者 → 寫 arena_friends（雙向或單向）→ 灌好友幽靈進我的池
  return notImpl();
};

function notImpl(): Response {
  return new Response(
    JSON.stringify({ ok: false, code: 'NOT_IMPLEMENTED', message: 'friend code 骨架（0014 未套用）' }),
    { status: 501, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
