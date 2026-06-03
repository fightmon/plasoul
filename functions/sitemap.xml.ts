/**
 * /sitemap.xml — 動態產生（靜態頁 + 全部產品頁 /gundam/:slug）
 * 給 Google 索引全部 SEO 產品頁。
 */
export interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const base = 'https://plasoul.com';
  const rows =
    (
      await context.env.DB.prepare(
        `SELECT slug, updated_at FROM catalog WHERE is_active = 1 AND id != 'cat_unknown' ORDER BY updated_at DESC LIMIT 5000`
      ).all<{ slug: string; updated_at: number }>()
    ).results || [];

  const statics = ['/', '/gundam', '/search', '/about', '/terms', '/privacy'];
  const iso = (ms: number) => {
    try { return new Date(ms).toISOString().slice(0, 10); } catch { return ''; }
  };
  const urls = [
    ...statics.map((p) => `<url><loc>${base}${p}</loc></url>`),
    ...rows.map((r) => {
      const lm = r.updated_at ? `<lastmod>${iso(r.updated_at)}</lastmod>` : '';
      return `<url><loc>${base}/gundam/${encodeURIComponent(r.slug)}</loc>${lm}</url>`;
    }),
  ].join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
