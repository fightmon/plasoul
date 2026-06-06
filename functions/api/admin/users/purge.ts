/**
 * 永久刪除會員（admin，硬刪除，不可復原）
 * POST /api/admin/users/purge  body: { id, confirm }
 * - confirm 必須等於該會員的 email（前端要求輸入確認）
 * - 安全：不能刪自己、不能刪其他 admin（要先把對方降為 user 才能刪）
 * 連帶清除：arena_cards / arena_players / garage_items / price_alerts / subscriptions
 *           search_logs.user_id、fb_listings.contributor_user_id → NULL（保留社群/分析資料）
 * 註：卡片照片(R2)暫不清除，之後另做孤兒清理。
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any; try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const id = String(body?.id || '').trim();
  const confirm = String(body?.confirm || '').trim();
  if (!id) return bad('缺少會員 id');

  if (id === auth.sub) return bad('不能刪除自己的帳號');

  const u = await context.env.DB.prepare(`SELECT id, email, role FROM users WHERE id = ?`).bind(id).first<any>();
  if (!u) return bad('找不到該會員', 404);
  if (u.role === 'admin') return bad('不能刪除管理員，請先把對方降為一般會員');
  if (confirm !== u.email) return bad('確認文字與該會員 email 不符，已取消');

  const D = context.env.DB;
  await D.batch([
    D.prepare(`DELETE FROM arena_cards WHERE user_id = ?`).bind(id),
    D.prepare(`DELETE FROM arena_players WHERE user_id = ?`).bind(id),
    D.prepare(`DELETE FROM garage_items WHERE user_id = ?`).bind(id),
    D.prepare(`DELETE FROM price_alerts WHERE user_id = ?`).bind(id),
    D.prepare(`DELETE FROM subscriptions WHERE user_id = ?`).bind(id),
    D.prepare(`UPDATE search_logs SET user_id = NULL WHERE user_id = ?`).bind(id),
    D.prepare(`UPDATE fb_listings SET contributor_user_id = NULL WHERE contributor_user_id = ?`).bind(id),
    D.prepare(`DELETE FROM users WHERE id = ?`).bind(id),
  ]);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
