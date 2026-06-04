/**
 * 加入車庫 / 加願望
 * POST /api/user/garage/add  Body: { slug? , product_id?, status?, purchase_price? }
 * status: backlog(山積) | building(組裝中) | done(完成) | sold(割愛) | wishlist(願望)
 * 同一產品已在車庫 → 改狀態（不重複建）。非 wishlist 受 tier 額度限制。
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const STATUSES = ['backlog', 'building', 'done', 'sold', 'wishlist'];
const LIMITS: Record<string, number> = { free: 5, premium: 30, pro: 100 };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }

  let productId = String(body.product_id || '').trim();
  const slug = String(body.slug || '').trim();
  if (!productId && slug) {
    const c = await context.env.DB.prepare(`SELECT id FROM catalog WHERE slug = ? AND is_active = 1`).bind(slug).first<{ id: string }>();
    productId = c?.id || '';
  }
  if (!productId) return err('NO_PRODUCT', '找不到這個產品', 404);

  const status = STATUSES.includes(body.status) ? body.status : 'backlog';
  const purchasePrice = body.purchase_price != null ? Math.max(0, Math.floor(Number(body.purchase_price) || 0)) : null;
  const now = Date.now();

  // 已在車庫 → 改狀態
  const existing = await context.env.DB.prepare(
    `SELECT id FROM garage_items WHERE user_id = ? AND product_id = ? LIMIT 1`
  ).bind(auth.sub, productId).first<{ id: string }>();
  if (existing) {
    await context.env.DB.prepare(`UPDATE garage_items SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, existing.id).run();
    return ok({ id: existing.id, product_id: productId, status, updated: true });
  }

  // tier 額度（只算非 wishlist 的「盒」）
  if (status !== 'wishlist') {
    const ur = await context.env.DB.prepare(`SELECT tier FROM users WHERE id = ?`).bind(auth.sub).first<{ tier: string }>();
    const limit = LIMITS[ur?.tier || 'free'] ?? 5;
    const cnt = await context.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM garage_items WHERE user_id = ? AND status != 'wishlist'`
    ).bind(auth.sub).first<{ n: number }>();
    if ((cnt?.n || 0) >= limit) {
      return err('LIMIT_REACHED', `車庫已達 ${limit} 盒上限，升級可放更多`, 402);
    }
  }

  const id = 'grg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  try {
    await context.env.DB.prepare(
      `INSERT INTO garage_items (id, user_id, product_id, condition, purchase_price, purchase_date, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?)`
    ).bind(id, auth.sub, productId, purchasePrice, status, now, now).run();
  } catch (e: any) {
    return err('INSERT_FAILED', `加入失敗: ${e?.message?.slice(0, 80) || 'unknown'}`, 500);
  }
  return ok({ id, product_id: productId, status, added: true });
};

function ok(data: any): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: hdr() });
}
function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: hdr() });
}
function hdr() { return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; }
