/**
 * 取得當前 admin user 資訊
 *
 * GET /api/admin/me
 *
 * 成功：{ ok: true, user: { id, email, role } }
 * 未登入：401 { ok: false, code: 'UNAUTHORIZED' }
 *
 * Frontend 用這個 endpoint check 登入狀態（HttpOnly cookie 沒辦法被 JS 讀）
 */

import { requireAdmin } from '../../_lib/auth';

export interface Env {
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: user.sub,
        email: user.email,
        role: user.role,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
};
