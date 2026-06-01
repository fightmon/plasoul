/**
 * 批量寫 fb_listings
 *
 * POST /api/admin/listings/batch-save
 * Body: {
 *   source_url?: string,
 *   source_group_name?: string,
 *   source_platform?: 'fb_group' | 'plurk' | 'komica' | 'discord' | 'shopee_2nd',
 *   items: [
 *     { model, series?, scale?, franchise?, price, condition?, status?, notes? }
 *   ]
 * }
 *
 * 對每筆 item：
 *   1. 嘗試對應 catalog（series + 部分品名 match）→ product_id
 *   2. 找不到 catalog 也照存（product_id = special placeholder 'cat_unknown'）
 *   3. INSERT fb_listings
 *
 * Dedup：同 source_url + 同 product_id + 同 price 視為重複，skip
 */

import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}

interface IncomingItem {
  model?: string;
  originalName?: string;
  series?: string;
  scale?: string;
  franchise?: string;
  price?: number;
  condition?: string;
  status?: string;
  shippingText?: string;
  meetupText?: string;
  notes?: string;
  catalogId?: string;  // 前端 review 時 admin 指定的 catalog
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const sourceUrl = String(body.source_url || '').trim() || null;
  const sourceGroupName = String(body.source_group_name || '').trim() || null;
  const sourcePlatform = String(body.source_platform || 'fb_group').trim();
  const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return jsonError('NO_ITEMS', '沒有要存的商品', 400);
  }
  if (items.length > 50) {
    return jsonError('TOO_MANY', '一次最多 50 筆', 400);
  }

  const now = Date.now();
  const batchId = `batch_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const saved: any[] = [];
  const skipped: { reason: string; model: string }[] = [];

  // 預先載 catalog 給 auto-match 用（簡化版：依 series + fuzzy match name）
  const catalogRows = await context.env.DB.prepare(
    `SELECT id, slug, series, full_name FROM catalog WHERE is_active = 1`
  ).all<{ id: string; slug: string; series: string; full_name: string }>();
  const allCatalog = catalogRows.results || [];

  for (const item of items) {
    const model = String(item.model || item.originalName || '').trim();
    if (!model) {
      skipped.push({ reason: '品名為空', model: '(empty)' });
      continue;
    }

    const price = Math.max(0, Math.floor(Number(item.price) || 0));
    const status = item.status === 'sold' ? 'sold' : 'available';
    if (status === 'available' && price < 50) {
      skipped.push({ reason: '可購買但無價格', model });
      continue;
    }

    // 對應 catalog
    let productId: string | null = item.catalogId || null;
    if (!productId) {
      productId = matchCatalog(allCatalog, item.series, model);
    }

    // Dedup: 同 source_url + product_id + price 已存在 → skip
    if (sourceUrl && productId) {
      const dup = await context.env.DB.prepare(
        `SELECT id FROM fb_listings WHERE source_url = ? AND product_id = ? AND price = ? LIMIT 1`
      )
        .bind(sourceUrl, productId, price)
        .first<{ id: string }>();
      if (dup) {
        skipped.push({ reason: '重複（同來源/商品/價格已存在）', model });
        continue;
      }
    }

    const listingId = `fbl_${now}_${Math.random().toString(36).slice(2, 10)}`;

    try {
      await context.env.DB.prepare(
        `INSERT INTO fb_listings (
          id, product_id, raw_model_name,
          source_platform, source_group_name, source_url, batch_id,
          price, condition, status, notes,
          shipping_text, meetup_text,
          screenshot_r2_key, screenshot_taken_at,
          contributor_user_id, review_status, review_notes,
          is_legacy, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'approved', NULL, 0, ?, ?)`
      )
        .bind(
          listingId,
          productId || 'cat_unknown',
          model,
          sourcePlatform,
          sourceGroupName,
          sourceUrl,
          batchId,
          price,
          (item.condition || '全新').trim(),
          status,
          (item.notes || '').trim() || null,
          (item.shippingText || '').trim() || null,
          (item.meetupText || '').trim() || null,
          now,
          now
        )
        .run();

      saved.push({
        id: listingId,
        model,
        product_id: productId,
        price,
        status,
      });
    } catch (e: any) {
      skipped.push({
        reason: `寫入錯誤: ${e?.message?.slice(0, 80) || 'unknown'}`,
        model,
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      batch_id: batchId,
      saved_count: saved.length,
      skipped_count: skipped.length,
      saved,
      skipped,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
};

/**
 * 簡化版 catalog match：series 對齊 + full_name 包含品名關鍵字
 * 找不到回 null（前端可手動指定 catalogId）
 */
function matchCatalog(
  catalog: { id: string; slug: string; series: string; full_name: string }[],
  series: string | undefined,
  model: string
): string | null {
  if (!model) return null;
  const seriesNorm = (series || '').trim().toUpperCase();
  const modelNorm = model.toLowerCase().trim();

  // 1. series + full_name 包含
  if (seriesNorm) {
    for (const c of catalog) {
      if (c.series.toUpperCase() === seriesNorm && c.full_name.toLowerCase().includes(modelNorm)) {
        return c.id;
      }
    }
  }

  // 2. 全 catalog 找 full_name 包含
  for (const c of catalog) {
    if (c.full_name.toLowerCase().includes(modelNorm)) return c.id;
  }

  return null;
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
