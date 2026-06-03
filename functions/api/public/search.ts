/**
 * 公開搜尋 API（找便宜 / 比價護城河）
 *
 * GET /api/public/search?q=&series=&sort=&limit=
 *
 * 回傳「賣家報價」平鋪清單（一筆 listing 一張卡），照價格排序。
 *
 * 資料現況：大多數 listing 尚未對應 catalog（product_id = cat_unknown），
 *   真正的品名在 fb_listings.raw_model_name。所以搜尋以 raw_model_name 為主、
 *   catalog（已對應者）為輔（LEFT JOIN）。已對應者才有 slug → 可連產品頁。
 *
 * 法律紅線：不回傳 source_url / 賣家 ID；來源只給去識別化標籤 + 日期。
 */

export interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const series = (url.searchParams.get('series') || '').trim();
  const sort = (url.searchParams.get('sort') || 'price').trim();
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10)));

  const term = (q || series).trim();
  if (!term) {
    return json({ ok: true, offers: [], total: 0, q, series });
  }

  const orderBy =
    sort === 'newest' ? 'fb.created_at DESC' : sort === 'price_desc' ? 'fb.price DESC' : 'fb.price ASC';
  const like = `%${term}%`;

  let rows: any[] = [];
  try {
    const stmt = context.env.DB.prepare(
      `SELECT
         fb.id AS listing_id,
         COALESCE(c.full_name, fb.raw_model_name) AS product_name,
         c.slug AS slug,
         COALESCE(c.series, '') AS series,
         c.scale AS scale,
         c.image_r2_key AS catalog_image,
         fb.price, fb.condition, fb.status, fb.shipping_text, fb.meetup_text, fb.created_at, fb.batch_id,
         CASE WHEN fb.source_url IS NOT NULL AND fb.source_url != '' THEN 1 ELSE 0 END AS has_link
       FROM fb_listings fb
       LEFT JOIN catalog c ON c.id = fb.product_id AND c.id != 'cat_unknown'
       WHERE fb.review_status = 'approved' AND fb.status = 'available'
         AND (
           fb.raw_model_name LIKE ? OR
           c.full_name LIKE ? OR
           c.search_text LIKE ? OR
           c.series LIKE ?
         )
       ORDER BY ${orderBy}
       LIMIT ?`
    );
    rows = (await stmt.bind(like, like, like, like, limit).all<any>()).results || [];
  } catch (e: any) {
    return json({ ok: false, code: 'QUERY_FAILED', message: e?.message?.slice(0, 120) || 'query failed' }, 500);
  }

  // 補封面：依 batch_id 抓 batch_images（is_cover 優先，否則第一張）
  const batchIds = [...new Set(rows.map((r) => r.batch_id).filter(Boolean))];
  const coverByBatch: Record<string, string> = {};
  const firstByBatch: Record<string, string> = {};
  if (batchIds.length > 0) {
    const ph = batchIds.map(() => '?').join(',');
    const imgs =
      (
        await context.env.DB.prepare(
          `SELECT batch_id, r2_key, is_cover FROM batch_images WHERE batch_id IN (${ph}) ORDER BY uploaded_at ASC`
        )
          .bind(...batchIds)
          .all<{ batch_id: string; r2_key: string; is_cover: number }>()
      ).results || [];
    for (const im of imgs) {
      if (im.is_cover && !coverByBatch[im.batch_id]) coverByBatch[im.batch_id] = im.r2_key;
      if (!firstByBatch[im.batch_id]) firstByBatch[im.batch_id] = im.r2_key;
    }
  }

  const offers = rows.map((r) => ({
    listing_id: r.listing_id,
    product_name: r.product_name || '未命名',
    slug: r.slug || null,
    series: r.series || '',
    scale: r.scale || null,
    price: r.price || 0,
    condition: r.condition || null,
    status: r.status,
    shipping_text: r.shipping_text || null,
    meetup_text: r.meetup_text || null,
    created_at: r.created_at,
    cover_key: r.catalog_image || coverByBatch[r.batch_id] || firstByBatch[r.batch_id] || null,
    has_link: r.has_link,
  }));

  return json({ ok: true, offers, total: offers.length, q, series, sort });
};

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
