/**
 * 找鋼彈瀏覽頁 /gundam（PRD 入口 4）
 * SSR：全產品按系列分組 → 連到各 /gundam/:slug。SEO 內部連結樞紐。
 * 可選 ?series= 篩選。
 */
import { renderShell, esc, money, imgUrl } from '../_lib/page-shell';

export interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const seriesFilter = (url.searchParams.get('series') || '').trim();

  const where = seriesFilter
    ? `c.is_active = 1 AND c.id != 'cat_unknown' AND c.series = ?`
    : `c.is_active = 1 AND c.id != 'cat_unknown'`;
  const stmt = context.env.DB.prepare(
    `SELECT c.id, c.slug, c.full_name, c.series, c.scale, c.image_r2_key,
            COUNT(fb.id) AS offer_count, MIN(fb.price) AS min_price
     FROM catalog c
     LEFT JOIN fb_listings fb ON fb.product_id = c.id AND fb.review_status = 'approved' AND fb.status = 'available'
     WHERE ${where}
     GROUP BY c.id
     ORDER BY c.series ASC, offer_count DESC, c.full_name ASC`
  );
  const products = (await (seriesFilter ? stmt.bind(seriesFilter) : stmt).all<any>()).results || [];

  // 每個產品一張代表圖（is_cover 優先）
  const coverByProduct: Record<string, string> = {};
  try {
    const covers =
      (
        await context.env.DB.prepare(
          `SELECT product_id, r2_key FROM (
             SELECT fb.product_id AS product_id, bi.r2_key AS r2_key,
                    ROW_NUMBER() OVER (PARTITION BY fb.product_id ORDER BY bi.is_cover DESC, bi.uploaded_at ASC) rn
             FROM fb_listings fb JOIN batch_images bi ON bi.batch_id = fb.batch_id
             WHERE fb.review_status = 'approved' AND fb.status = 'available'
           ) WHERE rn = 1`
        ).all<{ product_id: string; r2_key: string }>()
      ).results || [];
    for (const c of covers) coverByProduct[c.product_id] = c.r2_key;
  } catch { /* window fn 不支援時略過，用 placeholder */ }

  // 系列分組
  const bySeries = new Map<string, any[]>();
  for (const p of products) {
    const s = p.series || '其他';
    if (!bySeries.has(s)) bySeries.set(s, []);
    bySeries.get(s)!.push(p);
  }
  // 系列排序：常見序在前
  const ORDER = ['HG', 'RG', 'MG', 'MGEX', 'MGSD', 'PG', 'RE/100', 'SD', '30MF', 'FM', 'METAL BUILD', 'ROBOT魂'];
  const seriesKeys = [...bySeries.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  const card = (p: any) => {
    const im = imgUrl(p.image_r2_key || coverByProduct[p.id]);
    const price = p.offer_count > 0
      ? `<div class="cat-price">最低 NT$${money(p.min_price)} · ${p.offer_count} 報價</div>`
      : `<div class="cat-noprice">尚無報價</div>`;
    return `<a class="cat" href="/gundam/${esc(p.slug)}">
      <div class="cat-img">${im ? `<img src="${esc(im)}" alt="${esc(p.full_name)}" loading="lazy"/>` : `<span class="ph">🤖</span>`}</div>
      <div class="cat-name">${esc(p.full_name)}</div>${price}</a>`;
  };

  const sections = seriesFilter
    ? `<div class="cat-grid">${products.map(card).join('')}</div>`
    : seriesKeys.map((s) => `<section class="series-sec"><h2>${esc(s)}（${bySeries.get(s)!.length}）</h2><div class="cat-grid">${bySeries.get(s)!.map(card).join('')}</div></section>`).join('');

  const seriesNav = `<nav class="series-nav"><a href="/gundam"${!seriesFilter ? ' class="on"' : ''}>全部</a>${seriesKeys
    .map((s) => `<a href="/gundam?series=${encodeURIComponent(s)}"${seriesFilter === s ? ' class="on"' : ''}>${esc(s)}</a>`)
    .join('')}</nav>`;

  const total = products.length;
  const title = seriesFilter ? `${seriesFilter} 系列鋼普拉 · 普拉魂` : '找鋼彈 · 全系列鋼普拉比價 · 普拉魂';
  const desc = seriesFilter
    ? `${seriesFilter} 系列共 ${total} 款，普拉魂彙整玩家社群參考價。`
    : `瀏覽 ${total} 款鋼普拉，按系列分類，看各款玩家社群比價。`;

  const body = `<main class="wrap">
    <div class="cat-hero">
      <h1>找鋼彈</h1>
      <p>${seriesFilter ? esc(seriesFilter) + ' 系列' : '全系列'}共 ${total} 款 · 點進看比價</p>
    </div>
    ${seriesNav}
    ${total ? sections : '<div class="empty">這個系列還沒有產品。<a href="/gundam">看全部</a></div>'}
  </main>`;

  return new Response(
    renderShell({ title, description: desc, canonical: `https://plasoul.com/gundam${seriesFilter ? '?series=' + encodeURIComponent(seriesFilter) : ''}`, body }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=180' } }
  );
};
