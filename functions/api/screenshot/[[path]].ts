/**
 * Serve R2 image (public, 沒有 auth)
 *
 * GET /api/screenshot/{r2_key}
 *   r2_key 例：screenshots/20260601/1780xxx_xxxx.png
 *
 * 用戶決定：「我會自行打碼，存原圖、別人也可讀」
 * → public access，無 auth 擋
 * → 但加 X-Robots-Tag: noindex 避免被 Google 收錄
 */

export interface Env {
  R2: R2Bucket;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // [[path]] catch-all 拿到 array
  const params = context.params as { path?: string | string[] };
  let key: string;
  if (Array.isArray(params.path)) {
    key = params.path.join('/');
  } else {
    key = params.path || '';
  }

  if (!key) {
    return new Response('Missing key', { status: 400 });
  }

  // 安全：只允許 screenshots/ 開頭，避免 path traversal
  if (!key.startsWith('screenshots/')) {
    return new Response('Forbidden', { status: 403 });
  }

  const obj = await context.env.R2.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(obj.body, { status: 200, headers });
};
