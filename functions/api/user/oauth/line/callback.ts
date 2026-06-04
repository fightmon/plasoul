/**
 * LINE 登入 - 第 2 步：LINE 導回 → 換 token → 找/建帳號 → 簽發 session
 * GET /api/user/oauth/line/callback?code=&state=
 *
 * 需要 CF Pages env：LINE_CHANNEL_ID + LINE_CHANNEL_SECRET
 */
import { signJWT, makeAuthCookie } from '../../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || !state) return back('登入已取消');

  // 驗 state（CSRF）
  const cookie = context.request.headers.get('Cookie') || '';
  const m = cookie.match(/ps_oauth=([^;]+)/);
  if (!m) return back('登入逾時，請重試');
  const [savedState, nextEnc = ''] = m[1].split('|');
  if (savedState !== state) return back('登入驗證失敗');
  const next = nextEnc ? safeNext(decodeURIComponent(nextEnc)) : '/garage';

  const cid = context.env.LINE_CHANNEL_ID, secret = context.env.LINE_CHANNEL_SECRET;
  if (!cid || !secret) return back('LINE 登入尚未設定');

  // 換 token
  const callback = `${url.origin}/api/user/oauth/line/callback`;
  let tok: any;
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback, client_id: cid, client_secret: secret }),
    });
    if (!r.ok) return back('LINE token 交換失敗');
    tok = await r.json();
  } catch { return back('LINE 連線錯誤'); }

  const profile = decodeJwt(tok.id_token);
  if (!profile || !profile.sub) return back('讀取 LINE 資料失敗');
  const lineId = String(profile.sub);
  const name = String(profile.name || '').trim() || null;
  const email = String(profile.email || '').trim().toLowerCase();

  // 找/建帳號
  const now = Date.now();
  let user = await context.env.DB.prepare(
    `SELECT id, email, tier, role FROM users WHERE line_user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(lineId).first<any>();

  if (!user && email) {
    // 同 email 既有帳號 → 綁定 LINE
    const byEmail = await context.env.DB.prepare(`SELECT id, email, tier, role FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`).bind(email).first<any>();
    if (byEmail) {
      await context.env.DB.prepare(`UPDATE users SET line_user_id = ?, updated_at = ? WHERE id = ?`).bind(lineId, now, byEmail.id).run();
      user = byEmail;
    }
  }

  if (!user) {
    const id = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const finalEmail = email || `${lineId}@line.local`; // LINE 未給 email 時用合成值（email 欄 NOT NULL）
    try {
      await context.env.DB.prepare(
        `INSERT INTO users (id, email, display_name, line_user_id, tier, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'free', 'user', ?, ?)`
      ).bind(id, finalEmail, name, lineId, now, now).run();
    } catch { return back('建立帳號失敗（email 可能已存在）'); }
    user = { id, email: finalEmail, tier: 'free', role: 'user' };
  }

  const token = await signJWT({ sub: user.id, email: user.email, role: user.role || 'user' }, context.env.JWT_SECRET);
  const h = new Headers();
  h.append('Set-Cookie', makeAuthCookie(token));
  h.append('Set-Cookie', 'ps_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  h.set('Location', next);
  h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers: h });
};

function back(msg: string): Response {
  return new Response(null, { status: 302, headers: { Location: '/account?oauth_error=' + encodeURIComponent(msg), 'Cache-Control': 'no-store' } });
}
function safeNext(n: string): string { return n && n.startsWith('/') ? n : '/garage'; }
function decodeJwt(jwt: string): any {
  try {
    let b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch { return null; }
}
