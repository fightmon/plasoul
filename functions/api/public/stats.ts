/**
 * 公開統計 endpoint · 首頁用
 *
 * GET /api/public/stats
 * Cache: 5 min (KV)
 *
 * Returns:
 *   {
 *     ok: true,
 *     counts: { HG, RG, MG, MGSD, PG, SD, ... },
 *     source_count, total_count,
 *     cached_at
 *   }
 */

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

const CACHE_KEY = 'public:stats:v1';
const CACHE_TTL = 300; // 5 min

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 嘗試從 KV cache 拿
  try {
    const cached = await context.env.KV.get(CACHE_KEY);
    if (cached) {
      return jsonOk(cached);
    }
  } catch {}

  // 不在 cache → query D1
  const totalRow = await context.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT source_url) AS source_count
     FROM fb_listings
     WHERE review_status = 'approved'`
  ).first<{ total: number; source_count: number }>();

  const seriesRows = await context.env.DB.prepare(
    `SELECT c.series AS series, COUNT(*) AS cnt
     FROM fb_listings fb
     LEFT JOIN catalog c ON c.id = fb.product_id
     WHERE fb.review_status = 'approved'
     GROUP BY c.series`
  ).all<{ series: string | null; cnt: number }>();

  const counts: Record<string, number> = {};
  (seriesRows.results || []).forEach((row) => {
    const k = (row.series || 'OTHER').toUpperCase();
    counts[k] = (counts[k] || 0) + row.cnt;
  });

  const payload = {
    ok: true,
    counts,
    source_count: totalRow?.source_count || 0,
    total_count: totalRow?.total || 0,
    cached_at: Date.now(),
  };
  const body = JSON.stringify(payload);

  // 寫 cache
  try {
    await context.env.KV.put(CACHE_KEY, body, { expirationTtl: CACHE_TTL });
  } catch {}

  return jsonOk(body);
};

function jsonOk(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
