/**
 * 使用者註冊（email + 密碼）
 * POST /api/user/register  Body: { email, password, display_name? }
 * 成功 → 建 users(tier=free, role=user) + 簽發 session cookie
 */
import { hashPassword, signJWT, makeAuthCookie } from '../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.display_name || '').trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('INVALID_EMAIL', '請輸入有效的 email', 400);
  if (password.length < 6) return err('WEAK_PASSWORD', '密碼至少 6 個字元', 400);
  if (password.length > 200) return err('WEAK_PASSWORD', '密碼過長', 400);

  const exists = await context.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: string }>();
  if (exists) return err('EMAIL_TAKEN', '這個 email 已經註冊過了', 409);

  const hash = await hashPassword(password);
  const id = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();
  try {
    await context.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, tier, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', 'user', ?, ?)`
    ).bind(id, email, hash, displayName, now, now).run();
  } catch (e: any) {
    return err('INSERT_FAILED', `註冊失敗: ${e?.message?.slice(0, 80) || 'unknown'}`, 500);
  }

  const token = await signJWT({ sub: id, email, role: 'user' }, context.env.JWT_SECRET);
  return new Response(JSON.stringify({ ok: true, user: { id, email, display_name: displayName, tier: 'free' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': makeAuthCookie(token), 'Cache-Control': 'no-store' },
  });
};

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
