/**
 * 修改會員（admin）
 * POST /api/admin/users/update
 * body: { id, tier?, tier_expires_at?(ms|null), role?, action?('suspend'|'restore') }
 *
 * - tier: 'free'|'premium'|'pro'（人工開通付費用，未接金流）
 * - tier_expires_at: 到期毫秒；null = 無期限（有帶 key 才更新）
 * - role: 'user'|'admin'
 * - action: 'suspend' → soft delete（deleted_at=now）；'restore' → deleted_at=null
 *
 * 安全：不能停權自己、不能把自己降成 user
 * Returns: { ok } 或 { ok:false, message }
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

const TIERS = ['free', 'premium', 'pro'];
const ROLES = ['user', 'admin'];

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return bad('格式錯誤');
  }

  const id = String(body?.id || '').trim();
  if (!id) return bad('缺少會員 id');

  const target = await context.env.DB.prepare(
    `SELECT id, role FROM users WHERE id = ?`
  ).bind(id).first<{ id: string; role: string }>();
  if (!target) return bad('找不到該會員', 404);

  const isSelf = id === auth.sub;

  const sets: string[] = [];
  const binds: any[] = [];

  if ('tier' in body) {
    if (!TIERS.includes(body.tier)) return bad('方案值不合法');
    sets.push('tier = ?');
    binds.push(body.tier);
  }

  if ('tier_expires_at' in body) {
    const v = body.tier_expires_at;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return bad('到期時間不合法');
    sets.push('tier_expires_at = ?');
    binds.push(v);
  }

  if ('role' in body) {
    if (!ROLES.includes(body.role)) return bad('角色值不合法');
    if (isSelf && body.role !== 'admin') return bad('不能把自己降為一般會員');
    sets.push('role = ?');
    binds.push(body.role);
  }

  if ('action' in body) {
    if (body.action === 'suspend') {
      if (isSelf) return bad('不能停權自己');
      sets.push('deleted_at = ?');
      binds.push(Date.now());
    } else if (body.action === 'restore') {
      sets.push('deleted_at = ?');
      binds.push(null);
    } else {
      return bad('action 不合法');
    }
  }

  if (!sets.length) return bad('沒有要更新的欄位');

  sets.push('updated_at = ?');
  binds.push(Date.now());
  binds.push(id);

  await context.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
