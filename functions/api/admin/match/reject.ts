/**
 * 略過（不對應）報價 — 把無法對應的（組合包/雜項/垃圾）移出待對應佇列
 * POST /api/admin/match/reject
 * body: { listing_ids: string[] }
 *
 * 作法：review_status = 'rejected' → 不再出現在待對應，也不會出現在前台搜尋/產品頁。
 * 可逆：之後若要救回，把 review_status 改回 'approved' 即可。
 * Returns: { ok, rejected_count }
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, message: '格式錯誤' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const ids: string[] = Array.isArray(body?.listing_ids) ? body.listing_ids.filter((x: any) => typeof x === 'string' && x) : [];
  if (!ids.length) {
    return new Response(JSON.stringify({ ok: false, message: '缺少 listing_ids' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const placeholders = ids.map(() => '?').join(',');
  const res = await context.env.DB.prepare(
    `UPDATE fb_listings SET review_status = 'rejected', updated_at = ?
     WHERE id IN (${placeholders}) AND product_id = 'cat_unknown'`
  ).bind(Date.now(), ...ids).run();

  const rejected_count = (res.meta && (res.meta as any).changes) || 0;

  return new Response(JSON.stringify({ ok: true, rejected_count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
