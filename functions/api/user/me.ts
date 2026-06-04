/**
 * 取得目前登入使用者
 * GET /api/user/me  → { ok, user } 或 401
 * （HttpOnly cookie 不能被 JS 讀，前端靠這支判斷登入狀態）
 */
import { getAuthUser } from '../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await getAuthUser(context.request, context.env.JWT_SECRET);
  if (!auth) return unauth();

  const u = await context.env.DB.prepare(
    `SELECT id, email, display_name, tier, role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(auth.sub).first<any>();
  if (!u) return unauth();

  return new Response(JSON.stringify({ ok: true, user: u }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};

function unauth(): Response {
  return new Response(JSON.stringify({ ok: false, code: 'UNAUTHORIZED' }), {
    status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
