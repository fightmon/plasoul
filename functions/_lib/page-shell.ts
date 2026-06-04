/**
 * 前台 SSR 頁面共用殼（產品頁 / 找鋼彈瀏覽頁共用）
 * 提供：HTML 殼 + header/footer + 設計 token 樣式 + 共用 helper。
 * 法律：footer 含免責；source_url 一律不進 HTML（呼叫端負責）。
 */

export function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}
export function timeAgo(ms: number): string {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return '今天';
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 個月前`;
  return `${Math.floor(d / 365)} 年前`;
}
export function money(n: number): string {
  return (n || 0).toLocaleString('en-US');
}
export function imgUrl(key: string | null | undefined): string | null {
  return key ? `/api/screenshot/${encodeURIComponent(key)}` : null;
}

export interface ShellOpts {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string | null;
  jsonld?: object | null;
  robots?: string; // 預設 index
  body: string; // <main> 內容（呼叫端組好）
}

export function renderShell(o: ShellOpts): string {
  const og = o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}">` : '';
  const canon = o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : '';
  const robots = o.robots ? `<meta name="robots" content="${esc(o.robots)}">` : '';
  const ld = o.jsonld ? `<script type="application/ld+json">${JSON.stringify(o.jsonld)}</script>` : '';
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${robots}${canon}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
${og}
<meta name="theme-color" content="#0C1018">
<link rel="manifest" href="/manifest.json">
${ld}
<script>(function(){try{var t=localStorage.getItem('ps_theme');if(!t)t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<style>${STYLES}</style>
</head>
<body>
<header class="hdr">
  <a class="brand" href="/">🐶 普拉魂</a>
  <form class="hdr-search" action="/search" method="get" role="search">
    <input type="search" name="q" placeholder="搜尋鋼模型號…" aria-label="搜尋" />
  </form>
  <a class="hdr-nav" href="/gundam">找鋼彈</a>
  <a class="hdr-nav" id="ps-acct" href="/account" title="登入 / 帳號">👤</a>
  <button id="theme-toggle" class="theme-btn" aria-label="切換主題">🌓</button>
</header>
${o.body}
<footer class="ftr">
  <p class="ftr-disc">資料來自玩家社群觀察，不保證交易可行性。本站為非官方鋼普拉資訊整合平台，不隸屬於 BANDAI SPIRITS。</p>
  <p class="ftr-links"><a href="/">首頁</a> · <a href="/gundam">找鋼彈</a> · <a href="/about">關於</a> · <a href="/terms">服務條款</a> · <a href="/privacy">隱私政策</a></p>
</footer>
<script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;b.addEventListener('click',function(){var c=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',c);try{localStorage.setItem('ps_theme',c);}catch(e){}});})();
fetch('/api/user/me',{credentials:'include'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(d&&d.ok){var a=document.getElementById('ps-acct');if(a){a.setAttribute('href','/garage');a.title='我的車庫';a.textContent='📦';}}}).catch(function(){});</script>
</body>
</html>`;
}

export function notFoundPage(): Response {
  const body = `<main class="wrap" style="text-align:center;padding:80px 16px"><div style="font-size:56px">🤖</div><h1>找不到這個頁面</h1><p><a href="/search">← 回搜尋</a> · <a href="/gundam">找鋼彈</a></p></main>`;
  return new Response(renderShell({ title: '找不到頁面 · 普拉魂', description: '找不到頁面', robots: 'noindex', body }), {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// 設計 token（複製自 global.css :root，配色已定案）+ 前台頁面樣式
export const STYLES = `
*,*::before,*::after{box-sizing:border-box}
:root{--primary:#1577E0;--primary-d:#0F5FC0;--accent:#E60012;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--text2:#5d5d64;--border:#d2d2d7;--border-s:rgba(0,0,0,.06);--r:16px;--r-sm:12px;--shadow:0 2px 12px rgba(0,0,0,.08);--shadow-s:0 1px 3px rgba(0,0,0,.04)}
[data-theme=dark]{--primary:#5B86FF;--primary-d:#87A9FF;--accent:#FF4D6A;--bg:#080c1a;--card:rgba(15,20,45,.85);--text:#e8ecf4;--text2:#7a84a0;--border:rgba(100,120,180,.2);--border-s:rgba(100,120,180,.12)}
html,body{margin:0;padding:0}
body{font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:16px;line-height:1.6}
a{color:inherit}img{max-width:100%}
.hdr{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--border-s);backdrop-filter:blur(12px)}
.brand{font-weight:800;text-decoration:none;white-space:nowrap;letter-spacing:.04em}
.hdr-search{flex:1;min-width:0}
.hdr-search input{width:100%;padding:9px 14px;font-size:16px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--text);outline:none}
.hdr-search input:focus{border-color:var(--primary)}
.hdr-nav{flex-shrink:0;text-decoration:none;font-weight:700;font-size:14px;color:var(--primary-d);padding:8px 10px;white-space:nowrap}
.theme-btn{flex-shrink:0;background:transparent;border:1px solid var(--border);border-radius:999px;width:38px;height:38px;cursor:pointer;font-size:16px}
.wrap{max-width:920px;margin:0 auto;padding:18px 16px 64px}
.crumb{font-size:12.5px;color:var(--text2);margin-bottom:16px}
.crumb a{color:var(--text2);text-decoration:none}.crumb a:hover{color:var(--primary)}
.chip{font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;background:var(--primary);color:#fff}
.chip-sm{background:rgba(21,119,224,.12);color:var(--primary-d);font-size:11px;padding:2px 9px}
.chip-legacy{background:rgba(168,85,247,.15);color:#9b5de5}
.ph{font-size:26px;opacity:.4}.ph-lg{font-size:64px;opacity:.4}
.block{margin:28px 0}
.block-title{font-size:18px;font-weight:800;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--border-s)}
.ftr{border-top:1px solid var(--border-s);padding:24px 16px;text-align:center;color:var(--text2);font-size:12px;line-height:1.7}
.ftr-links a{color:var(--text2);text-decoration:none;margin:0 2px}.ftr-links a:hover{color:var(--primary)}
/* 車庫 widget */
.gw{display:flex;flex-direction:column;gap:10px}
.gw-actions{display:flex;gap:10px;flex-wrap:wrap}
.gw-btn{padding:10px 18px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}
.gw-add{background:var(--primary);color:#fff;border-color:var(--primary)}
.gw-wish:hover{border-color:var(--primary);color:var(--primary)}
.gw-msg{font-size:13px;color:var(--text2)}.gw-msg.ok{color:#16a34a;font-weight:700}
/* 產品頁 */
.hero{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:28px}
.hero-img{flex:0 0 240px;width:240px;height:240px;border-radius:var(--r);overflow:hidden;background:var(--card);border:1px solid var(--border-s);display:flex;align-items:center;justify-content:center}
.hero-img img{width:100%;height:100%;object-fit:cover}
.hero-info{flex:1;min-width:240px}
.h1{font-size:clamp(22px,4vw,30px);font-weight:800;margin:0 0 12px;line-height:1.25}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.subname{color:var(--text2);font-size:14px;margin-bottom:8px}
.msrp{color:var(--text2);font-size:13px;margin-bottom:16px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px}
.cmp-summary{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;margin-bottom:14px}
.cmp-low{font-size:24px;font-weight:800;color:var(--accent)}
.cmp-range,.cmp-count{font-size:13px;color:var(--text2)}
.offers{display:flex;flex-direction:column;gap:10px}
.offer{display:flex;gap:14px;background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm);padding:14px;box-shadow:var(--shadow-s)}
.offer-img{flex:0 0 84px;width:84px;height:84px;border-radius:10px;overflow:hidden;background:var(--bg);border:1px solid var(--border-s);display:flex;align-items:center;justify-content:center}
.offer-img img{width:100%;height:100%;object-fit:cover}
.offer-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.offer-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.offer-price{font-size:20px;font-weight:800;color:var(--accent)}
.go{flex-shrink:0;background:var(--primary);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:7px 14px;border-radius:999px}
.offer-tags{display:flex;flex-wrap:wrap;gap:6px}
.offer-meta{font-size:12.5px;color:var(--text2)}.offer-src{font-size:11.5px;color:var(--text2)}
.empty{text-align:center;padding:36px;color:var(--text2);background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm)}.empty a{color:var(--primary)}
.legal-note{font-size:11.5px;color:var(--text2);margin-top:12px}
.ext-row{display:flex;flex-wrap:wrap;gap:10px}
.ext{display:inline-block;background:var(--card);border:1px solid var(--border);border-radius:999px;padding:8px 16px;text-decoration:none;font-size:14px;font-weight:600}
.ext:hover{border-color:var(--primary);color:var(--primary)}
.rel-grid,.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.rel,.cat{text-decoration:none;background:var(--card);border:1px solid var(--border-s);border-radius:var(--r-sm);overflow:hidden;display:block;transition:border-color .15s,box-shadow .15s}
.cat:hover,.rel:hover{border-color:var(--primary);box-shadow:var(--shadow-s)}
.rel-img,.cat-img{aspect-ratio:1;background:var(--bg);display:flex;align-items:center;justify-content:center}
.rel-img img,.cat-img img{width:100%;height:100%;object-fit:cover}
.rel-name,.cat-name{padding:8px 10px;font-size:13px;font-weight:600;line-height:1.35}
/* 找鋼彈瀏覽頁 */
.cat-hero{text-align:center;margin-bottom:8px}
.cat-hero h1{font-size:clamp(22px,4vw,30px);font-weight:800;margin:8px 0 6px}
.cat-hero p{color:var(--text2);font-size:14px;margin:0 0 16px}
.series-nav{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:24px}
.series-nav a{text-decoration:none;font-size:13px;font-weight:600;padding:6px 14px;border-radius:999px;background:var(--card);border:1px solid var(--border);color:var(--text)}
.series-nav a:hover,.series-nav a.on{background:var(--primary);color:#fff;border-color:var(--primary)}
.cat-price{padding:0 10px 8px;font-size:13px;font-weight:700;color:var(--accent)}
.cat-noprice{padding:0 10px 8px;font-size:12px;color:var(--text2)}
.series-sec{margin-bottom:28px}
.series-sec h2{font-size:16px;font-weight:800;margin:0 0 12px}
`;
