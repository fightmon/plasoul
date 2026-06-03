/**
 * 對應整組報價 → catalog
 *
 * POST /api/admin/match/apply
 * Body 二選一：
 *   A. 建立新 catalog 並對應：{ listing_ids: string[], series, full_name, scale? }
 *   B. 對應到既有 catalog：   { listing_ids: string[], catalog_id }
 *
 * Returns: { ok, catalog_id, slug, linked_count }
 */

import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

// 中文名沒有英文 → 生 ASCII slug（取英數字，缺則用 series + 短碼）
function slugify(name: string, series: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^\w-]+/g, '-') // 非英數 → 連字號（中文會被去掉）
    .replace(/_+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s || s.length < 2) {
    const seriesPart = series.toLowerCase().replace(/[^\w]+/g, '') || 'item';
    s = `${seriesPart}-${crypto.randomUUID().slice(0, 6)}`;
  }
  return s.slice(0, 60);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return err('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const listingIds: string[] = Array.isArray(body.listing_ids)
    ? body.listing_ids.filter((x: any) => typeof x === 'string' && x)
    : [];
  if (listingIds.length === 0) return err('NO_LISTINGS', '沒有要對應的報價', 400);
  if (listingIds.length > 200) return err('TOO_MANY', '一次最多 200 筆', 400);

  const now = Date.now();
  let catalogId = String(body.catalog_id || '').trim();

  // 模式 A：建立新 catalog
  if (!catalogId) {
    const series = String(body.series || '').trim();
    const full_name = String(body.full_name || '').trim();
    const scale = String(body.scale || '').trim() || null;
    if (!series || !full_name) return err('MISSING_FIELDS', '必填：series / full_name', 400);

    // 生唯一 slug
    let slug = slugify(full_name, series);
    for (let i = 0; i < 5; i++) {
      const dup = await context.env.DB.prepare(`SELECT id FROM catalog WHERE slug = ?`).bind(slug).first();
      if (!dup) break;
      slug = `${slugify(full_name, series)}-${crypto.randomUUID().slice(0, 4)}`;
    }

    catalogId = 'cat_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const searchText = `${series} ${full_name}`.trim();
    try {
      await context.env.DB.prepare(
        `INSERT INTO catalog (
          id, slug, series, scale, full_name, name_jp, name_en, franchise,
          release_date, price_jp, price_tw, image_r2_key, dalong_link,
          search_text, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 1, ?, ?)`
      )
        .bind(catalogId, slug, series, scale, full_name, searchText, now, now)
        .run();
    } catch (e: any) {
      return err('INSERT_FAILED', `建立 catalog 失敗: ${e?.message?.slice(0, 100) || 'unknown'}`, 500);
    }
  } else {
    // 模式 B：確認既有 catalog 存在
    const exists = await context.env.DB.prepare(`SELECT slug FROM catalog WHERE id = ?`).bind(catalogId).first<{ slug: string }>();
    if (!exists) return err('CATALOG_NOT_FOUND', '指定的 catalog 不存在', 404);
  }

  // 對應 listings
  let linked = 0;
  try {
    const ph = listingIds.map(() => '?').join(',');
    const res = await context.env.DB.prepare(
      `UPDATE fb_listings SET product_id = ?, updated_at = ? WHERE id IN (${ph}) AND product_id = 'cat_unknown'`
    )
      .bind(catalogId, now, ...listingIds)
      .run();
    linked = res.meta?.changes || 0;
  } catch (e: any) {
    return err('LINK_FAILED', `對應失敗: ${e?.message?.slice(0, 100) || 'unknown'}`, 500);
  }

  const slugRow = await context.env.DB.prepare(`SELECT slug FROM catalog WHERE id = ?`).bind(catalogId).first<{ slug: string }>();

  return new Response(
    JSON.stringify({ ok: true, catalog_id: catalogId, slug: slugRow?.slug || null, linked_count: linked }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
