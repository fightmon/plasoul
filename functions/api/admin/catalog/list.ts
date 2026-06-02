/**
 * List catalog (search + paging)
 *
 * GET /api/admin/catalog?q=&limit=50&offset=0
 *
 * Returns: { ok: true, items: [...], total }
 */

import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;

  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  let where = `WHERE id != 'cat_unknown' AND is_active = 1`;
  const binds: any[] = [];
  if (q) {
    where += ` AND (full_name LIKE ? OR slug LIKE ? OR search_text LIKE ?)`;
    const pattern = `%${q}%`;
    binds.push(pattern, pattern, pattern);
  }

  const totalRow = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM catalog ${where}`
  )
    .bind(...binds)
    .first<{ n: number }>();

  const listResult = await context.env.DB.prepare(
    `SELECT id, slug, series, scale, full_name, name_jp, franchise, created_at
     FROM catalog
     ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all<any>();

  return new Response(
    JSON.stringify({
      ok: true,
      items: listResult.results || [],
      total: totalRow?.n || 0,
      limit,
      offset,
      q,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
};
