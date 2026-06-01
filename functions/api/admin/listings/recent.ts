/**
 * 最近 listings + 統計
 *
 * GET /api/admin/listings/recent?days=7&limit=50
 *
 * Returns:
 *   {
 *     ok: true,
 *     stats: {
 *       month_count, month_distinct_products, month_distinct_groups,
 *       today_count
 *     },
 *     items: [{ id, model, series, price, condition, status,
 *               shipping_text, meetup_text, source_url, source_group_name,
 *               created_at }]
 *   }
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
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10)));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

  const now = Date.now();
  const cutoff = now - days * 86400_000;
  const monthCutoff = now - 30 * 86400_000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCutoffMs = todayStart.getTime();

  // 列表（含 catalog JOIN）— 用 raw_model_name 當 fallback
  const listResult = await context.env.DB.prepare(
    `SELECT
       fb.id,
       COALESCE(c.full_name, fb.raw_model_name, '未對應') AS model,
       COALESCE(c.series, '') AS series,
       fb.price,
       fb.condition,
       fb.status,
       fb.shipping_text,
       fb.meetup_text,
       fb.notes,
       fb.source_url,
       fb.source_group_name,
       fb.product_id,
       fb.is_legacy,
       fb.created_at
     FROM fb_listings fb
     LEFT JOIN catalog c ON c.id = fb.product_id
     WHERE fb.created_at >= ?
       AND fb.review_status = 'approved'
     ORDER BY fb.created_at DESC
     LIMIT ?`
  )
    .bind(cutoff, limit)
    .all<any>();

  const items = listResult.results || [];

  // 統計（近 30 天）
  const statsResult = await context.env.DB.prepare(
    `SELECT
       COUNT(*) AS month_count,
       COUNT(DISTINCT product_id) AS month_distinct_products,
       COUNT(DISTINCT source_group_name) AS month_distinct_groups,
       SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today_count
     FROM fb_listings
     WHERE created_at >= ? AND review_status = 'approved'`
  )
    .bind(todayCutoffMs, monthCutoff)
    .first<any>();

  return new Response(
    JSON.stringify({
      ok: true,
      stats: {
        month_count: statsResult?.month_count || 0,
        month_distinct_products: statsResult?.month_distinct_products || 0,
        month_distinct_groups: statsResult?.month_distinct_groups || 0,
        today_count: statsResult?.today_count || 0,
      },
      items,
      days,
      limit,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
};
