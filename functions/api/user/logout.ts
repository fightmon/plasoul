/**
 * 使用者登出
 * POST /api/user/logout  → 清除 session cookie
 */
import { makeLogoutCookie } from '../../_lib/auth';

export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': makeLogoutCookie(), 'Cache-Control': 'no-store' },
  });
};
