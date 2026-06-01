/**
 * Admin 登入 API
 *
 * POST /api/admin/login
 * Body: { email, password }
 *
 * 成功：set HttpOnly cookie + 回 { ok: true, redirect: '/admin/listings' }
 * 失敗：401 + { ok: false, message: '...' }
 *
 * 含 KV-based 失敗計數 lockout（15 分鐘鎖 5 次）
 */

import { verifyPassword, signJWT, makeAuthCookie } from '../../_lib/auth';
import { recordFailure, clearKey, rateLimitResponse, getClientId } from '../../_lib/ratelimit';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_SEC = 15 * 60;

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  role: string;
  deleted_at: number | null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { email?: string; password?: string };
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return jsonError('MISSING_FIELDS', '請填寫所有欄位', 400);
  }
  if (password.length > 200 || email.length > 200) {
    return jsonError('INVALID_FIELDS', '欄位過長', 400);
  }

  // 失敗計數 lockout 檢查
  const ip = getClientId(context.request);
  const lockoutKey = `rl:login:${email}:${ip}`;
  const stored = await context.env.KV.get(lockoutKey);
  const prevFailures = stored ? parseInt(stored, 10) : 0;
  if (prevFailures >= MAX_LOGIN_FAILURES) {
    return rateLimitResponse(LOGIN_LOCKOUT_SEC, '登入失敗次數過多，請 15 分鐘後再試');
  }

  // 找 user（COLLATE NOCASE 由 users.email index 處理）
  const user = await context.env.DB.prepare(
    `SELECT id, email, password_hash, role, deleted_at FROM users WHERE email = ?`
  )
    .bind(email)
    .first<UserRow>();

  // 統一錯誤訊息防 enumeration（無論帳號或密碼錯，回一樣訊息）
  if (!user || user.deleted_at !== null || !user.password_hash) {
    // 浪費一點時間做假雜湊，防 timing attack
    await verifyPassword(password, 'pbkdf2$100000$AAAA$AAAA').catch(() => null);
    await recordFailure(context.env.KV, lockoutKey, MAX_LOGIN_FAILURES, LOGIN_LOCKOUT_SEC);
    return jsonError('INVALID_CREDENTIALS', 'Email 或密碼錯誤', 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailure(context.env.KV, lockoutKey, MAX_LOGIN_FAILURES, LOGIN_LOCKOUT_SEC);
    return jsonError('INVALID_CREDENTIALS', 'Email 或密碼錯誤', 401);
  }

  // 登入成功，清掉失敗計數
  await clearKey(context.env.KV, lockoutKey).catch(() => null);

  // 簽 JWT
  const token = await signJWT(
    { sub: user.id, email: user.email, role: user.role },
    context.env.JWT_SECRET,
    86400 // 24h
  );

  // 更新 updated_at（簡化版，不另做 last_login_at 欄位）
  await context.env.DB.prepare(`UPDATE users SET updated_at = ? WHERE id = ?`)
    .bind(Date.now(), user.id)
    .run()
    .catch(() => null);

  // admin 直接進 /admin/listings；一般 user 進 /dashboard
  const redirect = user.role === 'admin' ? '/admin/listings' : '/dashboard';

  return new Response(JSON.stringify({ ok: true, redirect }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': makeAuthCookie(token, 86400),
      'Cache-Control': 'no-store',
    },
  });
};

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
