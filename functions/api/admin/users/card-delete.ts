/**
 * 刪/還原會員卡片（admin，軟刪除）
 * POST /api/admin/users/card-delete  body: { card_id, restore? }
 * restore 為真 → deleted_at = null（救回）；否則 deleted_at = now（軟刪）
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
  const cardId = String(body?.card_id || '').trim();
  if (!cardId) return bad('缺少卡片 id');

  const card = await context.env.DB.prepare(`SELECT id FROM arena_cards WHERE id = ?`).bind(cardId).first<any>();
  if (!card) return bad('找不到該卡片', 404);

  const val = body?.restore ? null : Date.now();
  await context.env.DB.prepare(`UPDATE arena_cards SET deleted_at = ? WHERE id = ?`).bind(val, cardId).run();

  return new Response(JSON.stringify({ ok: true, deleted: val != null }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
