/**
 * Google 登入 - 第 1 步：導去 Google 授權頁
 * GET /api/user/oauth/google/start?next=/garage
 *
 * 需要 CF Pages env：GOOGLE_CLIENT_ID
 * callback 設定：https://plasoul.com/api/user/oauth/google/callback
 */
export interface Env { GOOGLE_CLIENT_ID?: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cid = context.env.GOOGLE_CLIENT_ID;
  if (!cid) {
    return new Response('Google 登入尚未設定（缺 GOOGLE_CLIENT_ID）', { status: 503 });
  }
  const url = new URL(context.request.url);
  const nextParam = url.searchParams.get('next') || '/garage';
  const next = nextParam.startsWith('/') ? nextParam : '/garage';

  const state = crypto.randomUUID().replace(/-/g, '');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const callback = `${url.origin}/api/user/oauth/google/callback`;

  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', cid);
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('scope', 'openid email profile');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  authorize.searchParams.set('access_type', 'online');
  authorize.searchParams.set('prompt', 'select_account');

  // state + next 存短期 cookie（callback 比對，防 CSRF）。SameSite=Lax 才會在 Google 導回時帶上
  const cookie = `ps_oauth=${state}|${encodeURIComponent(next)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: authorize.toString(), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
};
