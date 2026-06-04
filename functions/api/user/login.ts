/**
 * 使用者登入（email + 密碼）
 * POST /api/user/login  Body: { email, password }
 */
import { verifyPassword, signJWT, makeAuthCookie } from '../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return err('MISSING_FIELDS', '請填 email 與密碼', 400);

  const u = await context.env.DB.prepare(
    `SELECT id, email, password_hash, display_name, tier, role, deleted_at FROM users WHERE email = ? LIMIT 1`
  ).bind(email).first<any>();

  // 統一錯誤訊息避免帳號列舉
  if (!u || u.deleted_at) return err('BAD_CREDENTIALS', 'email 或密碼錯誤', 401);
  if (!u.password_hash) return err('NO_PASSWORD', '此帳號未設定密碼（可能是第三方登入）', 401);
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) return err('BAD_CREDENTIALS', 'email 或密碼錯誤', 401);

  const token = await signJWT({ sub: u.id, email: u.email, role: u.role || 'user' }, context.env.JWT_SECRET);
  return new Response(
    JSON.stringify({ ok: true, user: { id: u.id, email: u.email, display_name: u.display_name, tier: u.tier, role: u.role } }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': makeAuthCookie(token), 'Cache-Control': 'no-store' } }
  );
};

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
