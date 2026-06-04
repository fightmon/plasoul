/**
 * 更新車庫項目（改狀態 / 買價 / 備註）
 * POST /api/user/garage/update  Body: { id, status?, purchase_price?, notes? }
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }
const STATUSES = ['backlog', 'building', 'done', 'sold', 'wishlist'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }
  const id = String(body.id || '').trim();
  if (!id) return err('NO_ID', '缺少項目 id', 400);

  // 確認是本人的項目
  const own = await context.env.DB.prepare(`SELECT id FROM garage_items WHERE id = ? AND user_id = ?`).bind(id, auth.sub).first<{ id: string }>();
  if (!own) return err('NOT_FOUND', '找不到項目', 404);

  const sets: string[] = [];
  const binds: any[] = [];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return err('BAD_STATUS', '狀態值不合法', 400);
    sets.push('status = ?'); binds.push(body.status);
  }
  if (body.purchase_price !== undefined) {
    sets.push('purchase_price = ?'); binds.push(body.purchase_price == null ? null : Math.max(0, Math.floor(Number(body.purchase_price) || 0)));
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?'); binds.push(String(body.notes || '').trim() || null);
  }
  if (sets.length === 0) return err('NO_CHANGE', '沒有要更新的欄位', 400);

  sets.push('updated_at = ?'); binds.push(Date.now());
  binds.push(id);
  await context.env.DB.prepare(`UPDATE garage_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  return new Response(JSON.stringify({ ok: true, id }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
