/**
 * Admin 登出 API
 *
 * POST /api/admin/logout
 * 清掉 cookie，回 { ok: true, redirect: '/admin/login' }
 */

import { makeLogoutCookie } from '../../_lib/auth';

export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true, redirect: '/admin/login' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': makeLogoutCookie(),
      'Cache-Control': 'no-store',
    },
  });
};
