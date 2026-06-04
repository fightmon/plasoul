/**
 * 從車庫移除項目
 * POST /api/user/garage/remove  Body: { id }
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }
  const id = String(body.id || '').trim();
  if (!id) return err('NO_ID', '缺少項目 id', 400);

  const res = await context.env.DB.prepare(`DELETE FROM garage_items WHERE id = ? AND user_id = ?`).bind(id, auth.sub).run();
  return new Response(JSON.stringify({ ok: true, removed: res.meta?.changes || 0 }), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
