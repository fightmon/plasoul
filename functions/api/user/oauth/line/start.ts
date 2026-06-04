/**
 * LINE 登入 - 第 1 步：導去 LINE 授權頁
 * GET /api/user/oauth/line/start?next=/garage
 *
 * 需要 CF Pages env：LINE_CHANNEL_ID（LINE Login channel 的 Channel ID）
 * callback 設定：https://plasoul.com/api/user/oauth/line/callback
 */
export interface Env { LINE_CHANNEL_ID?: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cid = context.env.LINE_CHANNEL_ID;
  if (!cid) {
    return new Response('LINE 登入尚未設定（缺 LINE_CHANNEL_ID）', { status: 503 });
  }
  const url = new URL(context.request.url);
  const nextParam = url.searchParams.get('next') || '/garage';
  const next = nextParam.startsWith('/') ? nextParam : '/garage';

  const state = crypto.randomUUID().replace(/-/g, '');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const callback = `${url.origin}/api/user/oauth/line/callback`;

  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', cid);
  authorize.searchParams.set('redirect_uri', callback);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'profile openid email');
  authorize.searchParams.set('nonce', nonce);

  // state + next 存短期 cookie（callback 比對，防 CSRF）。SameSite=Lax 才會在 LINE 導回時帶上
  const cookie = `ps_oauth=${state}|${encodeURIComponent(next)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: authorize.toString(), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
};
