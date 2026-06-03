/**
 * 產品詳情頁 /gundam/:slug（PRD §5 模型詳情頁 v1）
 * SSR Pages Function：SEO 真 HTML + live D1 比價。共用殼見 _lib/page-shell。
 * 法律：HTML 不出現 source_url；前往走 /api/go/:id。
 */
import { renderShell, notFoundPage, esc, timeAgo, money, imgUrl } from '../_lib/page-shell';

export interface Env {
  DB: D1Database;
}
interface Catalog {
  id: string; slug: string; series: string; scale: string | null; full_name: string;
  name_jp: string | null; name_en: string | null; franchise: string | null;
  price_tw: number | null; price_jp: number | null; image_r2_key: string | null; dalong_link: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  let slug = String(context.params.slug || '').trim();
  try { slug = decodeURIComponent(slug); } catch { /* keep */ }
  if (!slug) return notFoundPage();

  const cat = await context.env.DB.prepare(
    `SELECT id, slug, series, scale, full_name, name_jp, name_en, franchise,
            price_tw, price_jp, image_r2_key, dalong_link
     FROM catalog WHERE slug = ? AND is_active = 1 LIMIT 1`
  ).bind(slug).first<Catalog>();
  if (!cat) return notFoundPage();

  const offers =
    (
      await context.env.DB.prepare(
        `SELECT fb.id, fb.price, fb.condition, fb.shipping_text, fb.meetup_text, fb.created_at, fb.batch_id, fb.is_legacy,
                CASE WHEN fb.source_url IS NOT NULL AND fb.source_url != '' THEN 1 ELSE 0 END AS has_link
         FROM fb_listings fb
         WHERE fb.product_id = ? AND fb.review_status = 'approved' AND fb.status = 'available'
         ORDER BY fb.is_legacy ASC, fb.price ASC`
      ).bind(cat.id).all<any>()
    ).results || [];

  // 封面
  const batchIds = [...new Set(offers.map((o) => o.batch_id).filter(Boolean))];
  const coverByBatch: Record<string, string> = {};
  const firstByBatch: Record<string, string> = {};
  if (batchIds.length > 0) {
    const ph = batchIds.map(() => '?').join(',');
    const imgs =
      (
        await context.env.DB.prepare(
          `SELECT batch_id, r2_key, is_cover FROM batch_images WHERE batch_id IN (${ph}) ORDER BY uploaded_at ASC`
        ).bind(...batchIds).all<{ batch_id: string; r2_key: string; is_cover: number }>()
      ).results || [];
    for (const im of imgs) {
      if (im.is_cover && !coverByBatch[im.batch_id]) coverByBatch[im.batch_id] = im.r2_key;
      if (!firstByBatch[im.batch_id]) firstByBatch[im.batch_id] = im.r2_key;
    }
  }

  const related =
    (
      await context.env.DB.prepare(
        `SELECT slug, full_name, image_r2_key FROM catalog WHERE series = ? AND id != ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 6`
      ).bind(cat.series, cat.id).all<{ slug: string; full_name: string; image_r2_key: string | null }>()
    ).results || [];

  const prices = offers.map((o) => o.price || 0).filter((p) => p > 0);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 0;
  const heroKey = cat.image_r2_key || (offers[0] && (coverByBatch[offers[0].batch_id] || firstByBatch[offers[0].batch_id])) || null;
  const heroImg = imgUrl(heroKey);
  const name = cat.full_name;

  // chips / msrp
  const chips = [cat.series, cat.scale, cat.franchise].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  const msrp: string[] = [];
  if (cat.price_tw) msrp.push(`台幣定價 NT$${money(cat.price_tw)}`);
  if (cat.price_jp) msrp.push(`日幣定價 ¥${money(cat.price_jp)}`);

  // 比價
  const priceSummary = offers.length
    ? `<div class="cmp-summary"><span class="cmp-low">最低 NT$${money(minP)}</span>${maxP !== minP ? `<span class="cmp-range">區間 NT$${money(minP)}–${money(maxP)}</span>` : ''}<span class="cmp-count">${offers.length} 個報價</span></div>`
    : '';
  const offerCards = offers.length
    ? offers.map((o) => {
        const im = imgUrl(coverByBatch[o.batch_id] || firstByBatch[o.batch_id]);
        const imgH = im ? `<img src="${esc(im)}" alt="${esc(name)}" loading="lazy" />` : `<span class="ph">🤖</span>`;
        const tags = [o.condition, o.is_legacy ? '歷史參考' : ''].filter(Boolean).map((t: string) => `<span class="chip chip-sm${t === '歷史參考' ? ' chip-legacy' : ''}">${esc(t)}</span>`).join('');
        const meta = [o.shipping_text ? `📦 ${esc(o.shipping_text)}` : '', o.meetup_text ? `📍 ${esc(o.meetup_text)}` : ''].filter(Boolean).join('　');
        const go = o.has_link ? `<a class="go" href="/api/go/${esc(o.id)}" target="_blank" rel="noopener nofollow">前往 →</a>` : '';
        return `<div class="offer"><div class="offer-img">${imgH}</div><div class="offer-body"><div class="offer-top"><div class="offer-price">NT$ ${money(o.price)}</div>${go}</div><div class="offer-tags">${tags}</div>${meta ? `<div class="offer-meta">${meta}</div>` : ''}<div class="offer-src">玩家社群參考價 · ${timeAgo(o.created_at)}</div></div></div>`;
      }).join('')
    : `<div class="empty">這盒目前還沒有玩家報價。<a href="/search">看看其他</a></div>`;

  // 外部資源
  const kw = encodeURIComponent(name);
  const ext = [
    cat.dalong_link ? `<a class="ext" href="${esc(cat.dalong_link)}" target="_blank" rel="noopener nofollow">📖 大龍開箱</a>` : '',
    `<a class="ext" href="https://shopee.tw/search?keyword=${kw}" target="_blank" rel="noopener nofollow">🛒 蝦皮搜尋</a>`,
    `<a class="ext" href="https://www.suruga-ya.jp/search?search_word=${kw}" target="_blank" rel="noopener nofollow">🇯🇵 駿河屋</a>`,
    `<a class="ext" href="https://bandai-hobby.net/" target="_blank" rel="noopener nofollow">🏭 Bandai Hobby</a>`,
  ].filter(Boolean).join('');

  const relHtml = related.length
    ? `<section class="block"><h2 class="block-title">同系列推薦</h2><div class="rel-grid">${related.map((r) => {
        const ri = imgUrl(r.image_r2_key);
        return `<a class="rel" href="/gundam/${esc(r.slug)}"><div class="rel-img">${ri ? `<img src="${esc(ri)}" alt="${esc(r.full_name)}" loading="lazy"/>` : `<span class="ph">🤖</span>`}</div><div class="rel-name">${esc(r.full_name)}</div></a>`;
      }).join('')}</div></section>`
    : '';

  const canonical = `https://plasoul.com/gundam/${encodeURIComponent(cat.slug)}`;
  const desc = offers.length
    ? `${name}｜${offers.length} 個賣家報價，最低 NT$${money(minP)}。普拉魂彙整玩家社群實際交易參考價。`
    : `${name}｜${cat.series}${cat.scale ? ' ' + cat.scale : ''}。普拉魂彙整玩家社群鋼普拉參考價。`;

  const jsonld: any = { '@context': 'https://schema.org', '@type': 'Product', name, category: cat.series };
  if (heroImg) jsonld.image = `https://plasoul.com${heroImg}`;
  if (offers.length) jsonld.offers = { '@type': 'AggregateOffer', priceCurrency: 'TWD', lowPrice: minP, highPrice: maxP, offerCount: offers.length };

  const body = `<main class="wrap">
  <nav class="crumb"><a href="/">首頁</a> › <a href="/gundam?series=${encodeURIComponent(cat.series)}">${esc(cat.series)}</a> › <span>${esc(name)}</span></nav>
  <section class="hero">
    <div class="hero-img">${heroImg ? `<img src="${esc(heroImg)}" alt="${esc(name)}" />` : `<span class="ph-lg">🤖</span>`}</div>
    <div class="hero-info">
      <h1 class="h1">${esc(name)}</h1>
      <div class="chips">${chips}</div>
      ${cat.name_jp ? `<div class="subname">${esc(cat.name_jp)}</div>` : ''}
      ${msrp.length ? `<div class="msrp">${msrp.map((m) => esc(m)).join('　·　')}</div>` : ''}
      ${offers.length ? `<a class="cta" href="#cmp">↓ 看 ${offers.length} 個報價（最低 NT$${money(minP)}）</a>` : ''}
    </div>
  </section>
  <section class="block" id="cmp">
    <h2 class="block-title">比價 · 玩家社群參考價</h2>
    ${priceSummary}
    <div class="offers">${offerCards}</div>
    <p class="legal-note">資料來自玩家社群觀察彙整，不保證交易可行性；點「前往」由系統轉址至來源。</p>
  </section>
  <section class="block"><h2 class="block-title">外部資源</h2><div class="ext-row">${ext}</div></section>
  ${relHtml}
</main>`;

  return new Response(
    renderShell({ title: `${name} 比價 · 普拉魂`, description: desc, canonical, ogImage: heroImg ? `https://plasoul.com${heroImg}` : null, jsonld, body }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' } }
  );
};
