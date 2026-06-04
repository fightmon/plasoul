/**
 * 後台總覽數據
 * GET /api/admin/stats
 *
 * 回傳「目前記錄了多少東西」的總覽：會員數、品項數、連結數、待對應數、分規格、分方案
 * Returns: { ok, members, members_by_tier, products, listings, listings_available,
 *            unmatched, products_by_series:[{series,count}] }
 */
import { requireAdmin } from '../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const db = context.env.DB;
  const one = async (sql: string): Promise<number> =>
    ((await db.prepare(sql).first<{ n: number }>())?.n) || 0;

  const [members, products, listings, listingsAvail, unmatched] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL`),
    one(`SELECT COUNT(*) AS n FROM catalog WHERE is_active = 1`),
    one(`SELECT COUNT(*) AS n FROM fb_listings WHERE review_status = 'approved'`),
    one(`SELECT COUNT(*) AS n FROM fb_listings WHERE review_status = 'approved' AND status = 'available'`),
    one(`SELECT COUNT(*) AS n FROM fb_listings WHERE product_id = 'cat_unknown' AND review_status = 'approved'`),
  ]);

  const tierRows =
    (await db.prepare(
      `SELECT tier, COUNT(*) AS n FROM users WHERE deleted_at IS NULL GROUP BY tier`
    ).all<{ tier: string; n: number }>()).results || [];
  const members_by_tier: Record<string, number> = { free: 0, premium: 0, pro: 0 };
  for (const r of tierRows) members_by_tier[r.tier] = r.n;

  const seriesRows =
    (await db.prepare(
      `SELECT series, COUNT(*) AS n FROM catalog WHERE is_active = 1 GROUP BY series ORDER BY n DESC`
    ).all<{ series: string; n: number }>()).results || [];

  return new Response(
    JSON.stringify({
      ok: true,
      members,
      members_by_tier,
      products,
      listings,
      listings_available: listingsAvail,
      unmatched,
      products_by_series: seriesRows.map((r) => ({ series: r.series, count: r.n })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
