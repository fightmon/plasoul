/**
 * 會員用量 GET /api/user/usage
 * → { ok, tier, since, garage:{used,limit}, scan:{used,limit} }
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; KV: KVNamespace; JWT_SECRET: string; }

const GARAGE_LIMIT: Record<string, number> = { free: 5, premium: 30, pro: 100 };
const SCAN_LIMIT: Record<string, number> = { free: 3, premium: 30, pro: 100 };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const u = await context.env.DB.prepare(`SELECT tier, created_at FROM users WHERE id = ?`).bind(auth.sub).first<{ tier: string; created_at: number }>();
  const tier = u?.tier || 'free';

  const g = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM garage_items WHERE user_id = ? AND status != 'wishlist'`
  ).bind(auth.sub).first<{ n: number }>();

  const month = new Date().toISOString().slice(0, 7);
  const scanUsed = parseInt((await context.env.KV.get(`scan:${auth.sub}:${month}`)) || '0', 10);

  return new Response(
    JSON.stringify({
      ok: true,
      tier,
      since: u?.created_at || null,
      garage: { used: g?.n || 0, limit: GARAGE_LIMIT[tier] ?? 5 },
      scan: { used: scanUsed, limit: SCAN_LIMIT[tier] ?? 3 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
