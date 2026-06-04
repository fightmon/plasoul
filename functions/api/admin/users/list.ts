/**
 * 會員清單（admin）
 * GET /api/admin/users/list?q=&limit=50&offset=0
 *
 * 回傳每位會員：email / 暱稱 / 方案 / 到期 / 角色 / 登入方式 / 車庫盒數 / 註冊日 / 是否停權
 * Returns: { ok, total, users:[...] }
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const like = `%${q}%`;
  const where = q ? `WHERE (u.email LIKE ? OR u.display_name LIKE ?)` : '';
  const whereBinds = q ? [like, like] : [];

  const total =
    ((await context.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`)
      .bind(...whereBinds)
      .first<{ n: number }>())?.n) || 0;

  const rows =
    (await context.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.tier, u.tier_expires_at, u.role,
              u.created_at, u.deleted_at,
              CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pw,
              CASE WHEN u.line_user_id  IS NOT NULL THEN 1 ELSE 0 END AS has_line,
              CASE WHEN u.google_id     IS NOT NULL THEN 1 ELSE 0 END AS has_google,
              (SELECT COUNT(*) FROM garage_items g WHERE g.user_id = u.id AND g.status != 'wishlist') AS garage_count
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...whereBinds, limit, offset)
      .all<any>()).results || [];

  const users = rows.map((r) => ({
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    tier: r.tier,
    tier_expires_at: r.tier_expires_at,
    role: r.role,
    created_at: r.created_at,
    suspended: r.deleted_at != null,
    methods: {
      email: !!r.has_pw,
      line: !!r.has_line,
      google: !!r.has_google,
    },
    garage_count: r.garage_count || 0,
  }));

  return new Response(
    JSON.stringify({ ok: true, total, limit, offset, users }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
