/**
 * 產品詳情頁 /gundam/:slug（PRD §5 模型詳情頁 v1）
 *
 * 用 Cloudflare Pages Function 伺服器端渲染 HTML：
 *   - SEO：真 HTML + <title>/<meta>/OG + schema.org Product JSON-LD
 *   - live D1 資料：catalog 基本資訊 + 該產品所有可購報價（比價區護城河）
 *   - 與現有 functions/ 共存（不動 Astro build，避免 _worker.js 吃掉 functions/）
 *
 * 法律紅線：HTML 不出現 source_url / 賣家 ID；前往一律走 /api/go/:id（302）。
 */

export interface Env {
  DB: D1Database;
}

interface Catalog {
  id: string;
  slug: string;
  series: string;
  scale: string | null;
  full_name: string;
  name_jp: string | null;
  name_en: string | null;
  franchise: string | null;
  price_tw: number | null;
  price_jp: number | null;
  image_r2_key: string | null;
  dalong_link: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const slug = String(context.params.slug || '').trim();
  if (!slug) return notFound();

  const cat = await context.env.DB.prepare(
    `SELECT id, slug, series, scale, full_name, name_jp, name_en, franchise,
            price_tw, price_jp, image_r2_key, dalong_link
     FROM catalog WHERE slug = ? AND is_active = 1 LIMIT 1`
  )
    .bind(slug)
    .first<Catalog>();

  if (!cat) return notFound();

  // 報價（可購、已審核），價格排序
  const offers =
    (
      await context.env.DB.prepare(
        `SELECT fb.id, fb.price, fb.condition, fb.status, fb.shipping_text, fb.meetup_text,
                fb.created_at, fb.batch_id, fb.is_legacy,
                CASE WHEN fb.source_url IS NOT NULL AND fb.source_url != '' THEN 1 ELSE 0 END AS has_link
         FROM fb_listings fb
         WHERE fb.product_id = ? AND fb.review_status = 'approved' AND fb.status = 'available'
         ORDER BY fb.is_legacy ASC, fb.price ASC`
      )
        .bind(cat.id)
        .all<any>()
    ).results || [];

  // 封面：依 batch_id 抓 batch_images（is_cover 優先，否則第一張）
  const batchIds = [...new Set(offers.map((o) => o.batch_id).filter(Boolean))];
  const coverByBatch: Record<string, string> = {};
  const firstByBatch: Record<string, string> = {};
  if (batchIds.length > 0) {
    const ph = batchIds.map(() => '?').join(',');
    const imgs =
      (
        await context.env.DB.prepare(
          `SELECT batch_id, r2_key, is_cover FROM batch_images WHERE batch_id IN (${ph}) ORDER BY uploaded_at ASC`
        )
          .bind(...batchIds)
          .all<{ batch_id: string; r2_key: string; is_cover: number }>()
      ).results || [];
    for (const im of imgs) {
      if (im.is_cover && !coverByBatch[im.batch_id]) coverByBatch[im.batch_id] = im.r2_key;
      if (!firstByBatch[im.batch_id]) firstByBatch[im.batch_id] = im.r2_key;
    }
  }

  // 相關推薦（同系列）
  const related =
    (
      await context.env.DB.prepare(
        `SELECT slug, full_name, series, image_r2_key FROM catalog
         WHERE series = ? AND id != ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 6`
      )
        .bind(cat.series, cat.id)
        .all<{ slug: string; full_name: string; series: string; image_r2_key: string | null }>()
    ).results || [];

  const prices = offers.map((o) => o.price || 0).filter((p) => p > 0);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 0;

  // 主圖：catalog 官圖 > 最低價報價封面 > 第一筆報價封面 > placeholder
  const heroKey =
    cat.image_r2_key ||
    (offers[0] && (coverByBatch[offers[0].batch_id] || firstByBatch[offers[0].batch_id])) ||
    null;

  const html = renderPage({ cat, offers, coverByBatch, firstByBatch, related, minP, maxP, heroKey });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  });
};

// ---------- helpers ----------
function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}
function timeAgo(ms: number): string {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return '今天';
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 個月前`;
  return `${Math.floor(d / 365)} 年前`;
}
function money(n: number): string {
  return (n || 0).toLocaleString('en-US');
}
function imgUrl(key: string | null): string | null {
  return key ? `/api/screenshot/${encodeURIComponent(key)}` : null;
}

function notFound(): Response {
  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>找不到這個產品 · 普拉魂</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#0C1018;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}a{color:#5B86FF}</style>
</head><body><div><div style="font-size:48px">🤖</div><h1>找不到這個產品</h1><p><a href="/search">← 回搜尋</a></p></div></body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderPage(d: {
  cat: Catalog;
  offers: any[];
  coverByBatch: Record<string, string>;
  firstByBatch: Record<string, string>;
  related: any[];
  minP: number;
  maxP: number;
  heroKey: string | null;
}): string {
  const { cat, offers, coverByBatch, firstByBatch, related, minP, maxP, heroKey } = d;
  const name = cat.full_name;
  const title = `${name} 比價 · 普拉魂`;
  const desc =
    offers.length > 0
      ? `${name}｜${offers.length} 個賣家報價，最低 NT$${money(minP)}。普拉魂彙整玩家社群實際交易參考價。`
      : `${name}｜${cat.series}${cat.scale ? ' ' + cat.scale : ''}。普拉魂彙整玩家社群鋼普拉參考價。`;
  const canonical = `https://plasoul.com/gundam/${encodeURIComponent(cat.slug)}`;
  const heroImg = imgUrl(heroKey);

  // schema.org Product JSON-LD
  const jsonld: any = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    category: cat.series,
  };
  if (heroImg) jsonld.image = `https://plasoul.com${heroImg}`;
  if (offers.length > 0) {
    jsonld.offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'TWD',
      lowPrice: minP,
      highPrice: maxP,
      offerCount: offers.length,
    };
  }

  // chips
  const chips = [cat.series, cat.scale, cat.franchise]
    .filter(Boolean)
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join('');

  // 定價
  const msrp: string[] = [];
  if (cat.price_tw) msrp.push(`台幣定價 NT$${money(cat.price_tw)}`);
  if (cat.price_jp) msrp.push(`日幣定價 ¥${money(cat.price_jp)}`);

  // 比價區
  const priceSummary =
    offers.length > 0
      ? `<div class="cmp-summary"><span class="cmp-low">最低 NT$${money(minP)}</span>${
          maxP !== minP ? `<span class="cmp-range">區間 NT$${money(minP)}–${money(maxP)}</span>` : ''
        }<span class="cmp-count">${offers.length} 個報價</span></div>`
      : '';

  const offerCards =
    offers.length > 0
      ? offers
          .map((o) => {
            const ck = coverByBatch[o.batch_id] || firstByBatch[o.batch_id] || null;
            const im = imgUrl(ck);
            const imgHtml = im
              ? `<img src="${esc(im)}" alt="${esc(name)}" loading="lazy" />`
              : `<span class="ph" aria-hidden="true">🤖</span>`;
            const tags = [o.condition, o.is_legacy ? '歷史參考' : '']
              .filter(Boolean)
              .map((t: string) => `<span class="chip chip-sm${t === '歷史參考' ? ' chip-legacy' : ''}">${esc(t)}</span>`)
              .join('');
            const meta = [
              o.shipping_text ? `📦 ${esc(o.shipping_text)}` : '',
              o.meetup_text ? `📍 ${esc(o.meetup_text)}` : '',
            ]
              .filter(Boolean)
              .join('　');
            const go = o.has_link
              ? `<a class="go" href="/api/go/${esc(o.id)}" target="_blank" rel="noopener nofollow">前往 →</a>`
              : '';
            return `<div class="offer">
              <div class="offer-img">${imgHtml}</div>
              <div class="offer-body">
                <div class="offer-top"><div class="offer-price">NT$ ${money(o.price)}</div>${go}</div>
                <div class="offer-tags">${tags}</div>
                ${meta ? `<div class="offer-meta">${meta}</div>` : ''}
                <div class="offer-src">玩家社群參考價 · ${timeAgo(o.created_at)}</div>
              </div>
            </div>`;
          })
          .join('')
      : `<div class="empty">這盒目前還沒有玩家報價。<a href="/search">看看其他</a></div>`;

  // 外部資源
  const ext: string[] = [];
  if (cat.dalong_link) ext.push(`<a class="ext" href="${esc(cat.dalong_link)}" target="_blank" rel="noopener nofollow">📖 大龍開箱</a>`);
  const kw = encodeURIComponent(name);
  ext.push(`<a class="ext" href="https://shopee.tw/search?keyword=${kw}" target="_blank" rel="noopener nofollow">🛒 蝦皮搜尋</a>`);
  ext.push(`<a class="ext" href="https://www.suruga-ya.jp/search?search_word=${kw}" target="_blank" rel="noopener nofollow">🇯🇵 駿河屋</a>`);
  ext.push(`<a class="ext" href="https://bandai-hobby.net/" target="_blank" rel="noopener nofollow">🏭 Bandai Hobby</a>`);

  // 相關推薦
  const relHtml = related.length
    ? `<section class="block"><h2 class="block-title">同系列推薦</h2><div class="rel-grid">${related
        .map((r) => {
          const ri = imgUrl(r.image_r2_key);
          return `<a class="rel" href="/gundam/${esc(r.slug)}">
            <div class="rel-img">${ri ? `<img src="${esc(ri)}" alt="${esc(r.full_name)}" loading="lazy"/>` : `<span class="ph">🤖</span>`}</div>
            <div class="rel-name">${esc(r.full_name)}</div></a>`;
        })
        .join('')}</div></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${heroImg ? `<meta property="og:image" content="https://plasoul.com${esc(heroImg)}">` : ''}
<meta name="theme-color" content="#0C1018">
<link rel="manifest" href="/manifest.json">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<script>(function(){try{var t=localStorage.getItem('ps_theme');if(!t)t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<style>${STYLES}</style>
</head>
<body>
<header class="hdr">
  <a class="brand" href="/">🐶 普拉魂</a>
  <form class="hdr-search" action="/search" method="get" role="search">
    <input type="search" name="q" placeholder="搜尋鋼模型號…" aria-label="搜尋" />
  </form>
  <button id="theme-toggle" class="theme-btn" aria-label="切換主題">🌓</button>
</header>

<main class="wrap">
  <nav class="crumb"><a href="/">首頁</a> › <a href="/search?series=${encodeURIComponent(cat.series)}">${esc(cat.series)}</a> › <span>${esc(name)}</span></nav>

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

  <section class="block">
    <h2 class="block-title">外部資源</h2>
    <div class="ext-row">${ext.join('')}</div>
  </section>

  ${relHtml}
</main>

<footer class="ftr">
  <p class="ftr-disc">資料來自玩家社群觀察，不保證交易可行性。本站為非官方鋼普拉資訊整合平台，不隸屬於 BANDAI SPIRITS。</p>
  <p class="ftr-links"><a href="/about">關於</a> · <a href="/terms">服務條款</a> · <a href="/privacy">隱私政策</a> · <a href="mailto:hello@plasoul.com">hello@plasoul.com</a></p>
</footer>

<script>
(function(){var b=document.getElementById('theme-toggle');if(!b)return;b.addEventListener('click',function(){var c=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',c);try{localStorage.setItem('ps_theme',c);}catch(e){}});})();
</script>
</body>
</html>`;
}

// 自帶樣式（複製需要的 design token 值；配色已定案，重複量小）
const STYLES = `
*,*::before,*::after{box-sizing:border-box}
:root{--primary:#1577E0;--primary-d:#0F5FC0;--accent:#E60012;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--text2:#5d5d64;--border:#d2d2d7;--border-s:rgba(0,0,0,.06);--r:16px;--r-sm:12px;--shadow:0 2px 12px rgba(0,0,0,.08);--shadow-s:0 1px 3px rgba(0,0,0,.04)}
[data-theme=dark]{--primary:#5B86FF;--primary-d:#87A9FF;--accent:#FF4D6A;--bg:#080c1a;--card:rgba(15,20,45,.85);--text:#e8ecf4;--text2:#7a84a0;--border:rgba(100,120,180,.2);--border-s:rgba(100,120,180,.12)}
html,body{margin:0;padding:0}
body{font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:16px;line-height:1.6}
a{color:inherit}
img{max-width:100%}
.hdr{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--border-s);backdrop-filter:blur(12px)}
.brand{font-weight:800;text-decoration:none;white-space:nowrap;letter-spacing:.04em}
.hdr-search{flex:1;min-width:0}
.hdr-search input{width:100%;padding:9px 14px;font-size:16px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--text);outline:none}
.hdr-search input:focus{border-color:var(--primary)}
.theme-btn{flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:999px;width:38px;height:38px;cursor:pointer;font-size:16px}
.wrap{max-width:920px;margin:0 auto;padding:18px 16px 64px}
.crumb{font-size:12.5px;color:var(--text2);margin-bottom:16px}
.crumb a{color:var(--text2);text-decoration:none}.crumb a:hover{color:var(--primary)}
.hero{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:28px}
.hero-img{flex:0 0 240px;width:240px;height:240px;border-radius:var(--r);overflow:hidden;background:var(--card);border:1px solid var(--border-s);display:flex;align-items:center;justify-content:center}
.hero-img img{width:100%;height:100%;object-fit:cover}
.ph-lg{font-size:64px;opacity:.4}
.hero-info{flex:1;min-width:240px}
.h1{font-size:clamp(22px,4vw,30px);font-weight:800;margin:0 0 12px;line-height:1.25}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;background:var(--primary);color:#fff}
.chip-sm{background:rgba(21,119,224,.12);color:var(--primary-d);font-size:11px;padding:2px 9px}
.chip-legacy{background:rgba(168,85,247,.15);color:#9b5de5}
.subname{color:var(--text2);font-size:14px;margin-bottom:8px}
.msrp{color:var(--text2);font-size:13px;margin-bottom:16px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px}
.block{margin:28px 0}
.block-title{font-size:18px;font-weight:800;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--border-s)}
.cmp-summary{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;margin-bottom:14px}
.cmp-low{font-size:24px;font-weight:800;color:var(--accent)}
.cmp-range,.cmp-count{font-size:13px;color:var(--text2)}
.offers{display:flex;flex-direction:column;gap:10px}
.offer{display:flex;gap:14px;background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm);padding:14px;box-shadow:var(--shadow-s)}
.offer-img{flex:0 0 84px;width:84px;height:84px;border-radius:10px;overflow:hidden;background:var(--bg);border:1px solid var(--border-s);display:flex;align-items:center;justify-content:center}
.offer-img img{width:100%;height:100%;object-fit:cover}.ph{font-size:26px;opacity:.4}
.offer-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.offer-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.offer-price{font-size:20px;font-weight:800;color:var(--accent)}
.go{flex-shrink:0;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:7px 14px;border-radius:999px}
.offer-tags{display:flex;flex-wrap:wrap;gap:6px}
.offer-meta{font-size:12.5px;color:var(--text2)}
.offer-src{font-size:11.5px;color:var(--text2)}
.empty{text-align:center;padding:36px;color:var(--text2);background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm)}
.empty a{color:var(--primary)}
.legal-note{font-size:11.5px;color:var(--text2);margin-top:12px}
.ext-row{display:flex;flex-wrap:wrap;gap:10px}
.ext{display:inline-block;background:var(--card);border:1px solid var(--border);border-radius:999px;padding:8px 16px;text-decoration:none;font-size:14px;font-weight:600}
.ext:hover{border-color:var(--primary);color:var(--primary)}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
.rel{text-decoration:none;background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm);overflow:hidden;display:block}
.rel-img{aspect-ratio:1;background:var(--bg);display:flex;align-items:center;justify-content:center}
.rel-img img{width:100%;height:100%;object-fit:cover}
.rel-name{padding:8px 10px;font-size:13px;font-weight:600;line-height:1.35}
.ftr{border-top:1px solid var(--border-s);padding:24px 16px;text-align:center;color:var(--text2);font-size:12px;line-height:1.7}
.ftr-links a{color:var(--text2);text-decoration:none;margin:0 2px}.ftr-links a:hover{color:var(--primary)}
@media(max-width:560px){.hero-img{flex-basis:100%;width:100%;height:auto;aspect-ratio:1}}
`;
