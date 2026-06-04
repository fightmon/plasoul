/**
 * 我的車庫清單
 * GET /api/user/garage/list → { ok, items[], counts{} }
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const items =
    (
      await context.env.DB.prepare(
        `SELECT g.id, g.product_id, g.status, g.purchase_price, g.condition, g.notes, g.created_at, g.updated_at,
                c.full_name, c.slug, c.series, c.image_r2_key
         FROM garage_items g
         LEFT JOIN catalog c ON c.id = g.product_id
         WHERE g.user_id = ?
         ORDER BY g.updated_at DESC`
      ).bind(auth.sub).all<any>()
    ).results || [];

  const counts: Record<string, number> = { backlog: 0, building: 0, done: 0, sold: 0, wishlist: 0, total: 0 };
  for (const it of items) {
    if (counts[it.status] != null) counts[it.status]++;
    if (it.status !== 'wishlist') counts.total++;
  }

  return new Response(JSON.stringify({ ok: true, items, counts }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
