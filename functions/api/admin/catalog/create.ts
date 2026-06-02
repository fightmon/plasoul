/**
 * 新增 catalog（含可選的「同時 link 到既有 listing」）
 *
 * POST /api/admin/catalog/create
 * Body: {
 *   series: string,
 *   slug: string,
 *   full_name: string,
 *   scale?: string,
 *   name_jp?: string,
 *   name_en?: string,
 *   franchise?: string,
 *   listing_id?: string  // 若提供，建好 catalog 後自動 UPDATE fb_listings.product_id
 * }
 *
 * Returns: { ok: true, catalog: {...}, linked_listing?: string }
 */

import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const series = String(body.series || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase();
  const full_name = String(body.full_name || '').trim();
  const scale = String(body.scale || '').trim() || null;
  const name_jp = String(body.name_jp || '').trim() || null;
  const name_en = String(body.name_en || '').trim() || null;
  const franchise = String(body.franchise || '').trim() || null;
  const listingId = String(body.listing_id || '').trim() || null;

  if (!series || !slug || !full_name) {
    return jsonError('MISSING_FIELDS', '必填：series / slug / full_name', 400);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return jsonError(
      'INVALID_SLUG',
      'slug 只能含 a-z 0-9 - 開頭必須字母或數字（例：mg-rx-78-2）',
      400
    );
  }

  // Check slug 是否已存在
  const existing = await context.env.DB.prepare(
    `SELECT id FROM catalog WHERE slug = ?`
  )
    .bind(slug)
    .first<{ id: string }>();
  if (existing) {
    return jsonError(
      'DUPLICATE_SLUG',
      `slug 「${slug}」已存在（${existing.id}），請換一個`,
      409
    );
  }

  const id = 'cat_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const now = Date.now();
  const searchText = `${series} ${full_name} ${name_jp || ''} ${name_en || ''} ${franchise || ''}`.trim();

  try {
    await context.env.DB.prepare(
      `INSERT INTO catalog (
        id, slug, series, scale, full_name, name_jp, name_en, franchise,
        release_date, price_jp, price_tw, image_r2_key, dalong_link,
        search_text, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, 1, ?, ?)`
    )
      .bind(id, slug, series, scale, full_name, name_jp, name_en, franchise, searchText, now, now)
      .run();
  } catch (e: any) {
    return jsonError('INSERT_FAILED', `寫入失敗: ${e?.message || 'unknown'}`, 500);
  }

  // 若指定 listingId，自動 link
  let linkedListing = null;
  if (listingId) {
    try {
      const result = await context.env.DB.prepare(
        `UPDATE fb_listings SET product_id = ?, updated_at = ? WHERE id = ?`
      )
        .bind(id, now, listingId)
        .run();
      if (result.meta?.changes && result.meta.changes > 0) {
        linkedListing = listingId;
      }
    } catch {
      // link 失敗不影響 catalog 建立
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      catalog: { id, slug, series, full_name, scale, franchise },
      linked_listing: linkedListing,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
};

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
