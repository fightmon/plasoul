/**
 * 「前往社群」轉址（Gate 機制雛形）
 *
 * GET /api/go/:id  → 302 轉到該 listing 的 source_url
 *
 * 目的：
 *   - 法律紅線：source_url 不出現在前台 HTML，使用者點擊才由伺服器轉址
 *   - 未來接點數系統時，在這裡做扣點 / 登入 gate（PRD §6.6 Redirect Gate）
 *
 * 現階段（無使用者系統）：直接轉址，不扣點。
 */

export interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string;
  if (!id) return new Response('Not found', { status: 404 });

  const row = await context.env.DB.prepare(
    `SELECT source_url FROM fb_listings WHERE id = ? AND review_status = 'approved' LIMIT 1`
  )
    .bind(id)
    .first<{ source_url: string | null }>();

  const target = row?.source_url;
  if (!target) {
    // 沒有來源連結 → 導回搜尋頁，不報錯
    return Response.redirect(new URL('/search', context.request.url).toString(), 302);
  }

  // TODO（接點數系統後）：在此驗證登入 + 扣 5 點，額度不足回 402 / 導去 /pricing
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store',
      // 不讓搜尋引擎跟著轉址索引外部連結
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
};
