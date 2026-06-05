/**
 * 使用者用：依名稱搜型錄（拍盒辨識認錯時手動找正確型號 → 加入車庫）
 * GET /api/user/catalog-search?q=薩克
 * → { ok, results: [{ slug, full_name, series, image_r2_key }] }
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const q = (new URL(context.request.url).searchParams.get('q') || '').trim();
  if (q.length < 1) return json({ ok: true, results: [] });

  const like = `%${q}%`;
  const rows = (await context.env.DB.prepare(
    `SELECT slug, full_name, series, image_r2_key FROM catalog
     WHERE is_active = 1 AND id != 'cat_unknown'
       AND (full_name LIKE ? OR search_text LIKE ? OR series LIKE ?)
     ORDER BY length(full_name) ASC
     LIMIT 12`
  ).bind(like, like, like).all<any>()).results || [];

  return json({ ok: true, results: rows });
};

function json(o: any): Response {
  return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
