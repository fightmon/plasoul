# 普拉魂 PuraSoul · 交接書

**最後更新**：2026-06-03
**現任 PM / Owner**：大毛 (fightmon@gmail.com)
**Ship 目標**：2026-09-30 (PRD v2.1 鎖死)

---

## 1. 專案速覽

### 是什麼
**plasoul.com** — 鋼普拉 (Gundam plastic model) 玩家找便宜的工具站。

### 核心 USP
彙整 5 大 FB 鋼普拉社團的賣家自售價，讓玩家買鋼彈前 30 秒看到「同款在其他賣家是多少錢」。

### 商業模式
Freemium SaaS：
- 未登入：每日免費 3 次「前往社團」次數
- 登入：每日 5 次
- Pro 訂閱（LINE Pay）：無限 + 降價警報

### 法律紀律 (PRD § 5.2 必守)
1. 對外不能說「我們爬 FB」→ 寫「玩家社群實際交易參考價彙整」
2. 不存賣家任何個資
3. 不公開賣家 ID / contact
4. 不引導用戶聯絡截圖中的賣家
5. 服務條款明確寫「資料來自社群觀察，不保證交易可行性」

---

## 2. 對外連結 / 環境

| 項目 | 連結 / ID |
| --- | --- |
| Production URL | https://plasoul.com (Cloudflare Pages) |
| GitHub repo | https://github.com/fightmon/plasoul |
| Cloudflare Account ID | `9d1c433cd1765f0b56c251977a9ea28b` |
| D1 Database | `plasoul-db` (`a38d8f70-3e62-420c-aacb-d398cbd928ee`) |
| KV Namespace | `plasoul-kv` (`6c9516462c824b1c8fa7fd266e413bd5`) |
| R2 Bucket | `plasoul-assets` |
| Email Routing | hello@plasoul.com → fightmon@gmail.com |
| Groq Worker Proxy | `lingering-salad-b9dc.fightmon.workers.dev` (AI 解析用) |
| Admin Email | hello@plasoul.com (PRODUCTION) |

### CF Pages 環境變數
```
JWT_SECRET=IGRC4Fui7modW1/GKUgGyKQKZhJ993+H4V76gdf1jXtrKTt8NixvhyKbWDN/avOv
```

---

## 3. 技術 Stack

| 層 | 技術 |
| --- | --- |
| Frontend | Astro 6.3.3 (static SSG) + TypeScript |
| Styling | 自寫 CSS + CSS Variables (light/dark mode) — **無** Tailwind |
| Backend | Cloudflare Pages Functions (`functions/api/**.ts`) |
| Database | Cloudflare D1 (SQLite, edge) |
| Storage | Cloudflare R2 (screenshots, future image library) |
| Cache | Cloudflare KV (rate limit, stats cache) |
| Auth | PBKDF2-SHA256 password + HMAC-SHA256 JWT + HttpOnly cookie |
| AI | meta-llama/llama-4-scout-17b-16e-instruct (Groq) via Worker proxy |
| Extension | Chrome Manifest V3 |

**Architectural decision**：拔掉 Tailwind v4 因為跟 rolldown bundler 撞 bug。整個 codebase 0 utility class，全部用 component-scoped `<style>` + global CSS tokens。詳見 commit `83c07fa`。

---

## 4. 已完成功能 (W0 + W1 + W3)

### W0 · Foundation
- [x] 域名 plasoul.com 購買 (Cloudflare Registrar)
- [x] GitHub repo + CF Pages project + D1 + R2 + KV 建立
- [x] Email Routing hello@plasoul.com → fightmon@gmail.com
- [x] Migration 0001 — 7 表 schema (users, catalog, fb_listings, price_alerts, subscriptions, search_logs, garage_items)
- [x] Migration 0002 — 32 RG 鋼彈 seed (from 模物獵人 rg-products.json)
- [x] Migration 0006 — seed `cat_unknown` 佔位 (FK 用)

### W1 · 前台 Foundation
- [x] Apple Glass 風格 design tokens (light + dark mode CSS vars)
- [x] `Layout.astro` + `Header.astro` (sticky nav, search bar, 🌓 theme toggle) + `Footer.astro`
- [x] **首頁** `/` — Hero (GAME8LA 風 + 普拉犬 slogan) + Stats 4 格 + 系列按鈕 6 主 + 6 次 + 收起展開
- [x] **搜尋頁** `/search` — 空狀態 + autofocus；有 query 顯示「W2 上線中」placeholder
- [x] **靜態頁** `/about` `/terms` `/privacy` (含 PRD § 5.2 法律免責)
- [x] **公開 stats API** `/api/public/stats` (5min KV cache)
- [x] Migration 0008 — `catalog_fts` FTS5 virtual table + 3 triggers 同步 (trigram tokenizer 對中文友善)

### W3 · 後台 Admin Tools
- [x] **W3-A** Admin login (`/admin/login`) — PBKDF2 + JWT + HttpOnly cookie `ps_session`
- [x] **W3-B** `/admin/listings` 主頁 — 貼 FB 文字 + 觸發 AI 解析
- [x] **W3-C** AI parse endpoint `/api/ai/extract-listing` — text-based, 模物獵人 IMAGE_PROMPT
- [x] **W3-D** 多商品確認 UI + batch-save 寫 `fb_listings`
- [x] **W3-E1** 「最近記錄」section + 4 格統計 widget + `raw_model_name` fallback
- [x] **W3-E2** 簡化版 catalog CRUD — 從未對應 listings 一鍵建 catalog
- [x] **W3-F1** 截圖儲存 — R2 upload + `batch_images` 表 (1 batch 對 N 圖) + public serve endpoint
- [x] **W3-G1** Chrome Extension v1 — viewport-based DOM 偵測抓 FB 文字 + URL hash 傳到 listings
- [x] Ctrl+V 貼圖 → AI Vision 解析 (per-image parallel calls 避 max_tokens 截斷)
- [x] UI polish: rawHint 副標 + sold 灰化 + status emoji + 全選/全不選
- [x] 加 `shipping_text` + `meetup_text` 結構化欄位 (給未來地理篩選用)
- [x] 加 `screenshot_r2_key` 預留欄位 (未來打碼版用)
- [x] Admin 卡片顯示批次截圖 thumbnail (點開大圖)

---

## 5. 未完成 (按優先順序)

### 🔥 緊急 / 立刻能做
| ID | 描述 | 預估 | 備註 |
| --- | --- | --- | --- |
| W2-A | `/gundam/[slug]` SSG 結果頁 | 4 hr | 用戶 USP 第一次落地 |
| `/api/public/search.ts` | 接 FTS5 + `/search` 真正顯示結果 | 3 hr | W2 part 2 |
| ~~W3-cover~~ | ✅ 完成 (2026-06-03) — `batch_images.is_cover`，非 `fb_listings.cover_r2_key` | — | 見 §8.2；待套 migration 0009 + commit |
| #100 | 模物獵人 price records (3000+) 遷移 → D1 fb_listings | 3-4 hr | 補資料厚度 |
| #101 | Firebase gundam_catalog 合併匯入 catalog | 2 hr | 補品項厚度 |

### 🟡 中期 (W2 - W4)
| Epic | 內容 |
| --- | --- |
| W2 part 2 | `/search` 真正 query FTS5 + Amazon 風卡片 (左圖右資訊) |
| W2 part 3 | `/gundam/[slug]` SSG 結果頁 (Hero 圖 + 價格區 + 賣家清單去識別化 + 證據截圖) |
| W4 | Hero Live Demo + sitemap polish + meta tags + schema.org Product markup |
| W0-2 | 普拉魂品牌資產 (logo + 主色 + 字體 token) — **GP-DOG 吉祥物**仍待 user 給正圖 |
| W0-7 | R2 上傳模物獵人 images/gunplaList/ 圖庫 |

### 🟢 後期 (W5 - W10)
| Epic | 內容 |
| --- | --- |
| W5 | User 系統 (註冊 / 登入 / `/garage` 簡化版) |
| W6 | 降價警報 (`price_alerts` + Cron + LINE 推播) |
| W7 | LINE Pay v3 + 訂閱 tier + `/pricing` + 前往社團 quota middleware (未登入 3次/日, 登入 5次/日, Pro 無限) |
| W8 | RWD 雙端 polish + Lighthouse 90+ + a11y |
| W9 | Beta (5-10 鋼普拉好友試用 + Bug fix loop) |
| W10 | GA 上線 + 監測 + 文案 |

### 🛠️ Extension polish (可後做)
- W3-G2 Chrome Extension v2 — `chrome.tabs.captureVisibleTab` 一鍵截圖
- W3-G3 Chrome Extension v3 — 背景 POST + API token auth (跳過 admin/listings 直接送)

### ❌ Killed
- W3-F2 截圖自動打碼 — user 決定自行打碼 (memory: 「我會自行打碼，或避掉重要資訊」)

---

## 6. 檔案結構導覽

```
001_普拉魂/
├── README.md                         # 專案速覽
├── docs/
│   ├── ARCHITECTURE.md              # 7-section ADR (why Astro/mobile-first/no-native-app)
│   ├── SETUP_ADMIN.md               # 第一次設定 admin 帳號流程
│   └── HANDOFF.md                   # ← 本文件
├── package.json                      # 已拔掉 tailwind, 只剩 astro + @astrojs/cloudflare
├── astro.config.mjs                  # 簡化版，無 vite plugin
├── wrangler.toml                     # D1 + KV + R2 bindings
├── migrations/                       # D1 schema (順序 apply)
│   ├── 0001_init.sql                # 7 表
│   ├── 0002_seed_catalog.sql        # 32 RG
│   ├── 0004_listings_shipping_meetup.sql
│   ├── 0005_listings_raw_model_name.sql
│   ├── 0006_seed_unknown_catalog.sql
│   ├── 0007_batch_images.sql        # W3-F1 截圖儲存
│   └── 0008_catalog_fts.sql         # FTS5 全文搜尋
├── src/
│   ├── styles/global.css            # Apple Glass tokens (:root + [data-theme="dark"])
│   ├── layouts/Layout.astro         # 共享 shell + theme detection (anti-FOUC)
│   ├── components/
│   │   ├── Header.astro             # sticky nav + 搜尋 + 🌓 toggle
│   │   └── Footer.astro             # 含 PRD § 5.2 法律免責
│   └── pages/
│       ├── index.astro              # 首頁
│       ├── search.astro             # /search (client-side query parse)
│       ├── about.astro
│       ├── terms.astro
│       ├── privacy.astro
│       └── admin/
│           ├── login.astro          # bareLayout
│           └── listings.astro       # bareLayout, ~1700 行的 super-page
├── functions/                        # Cloudflare Pages Functions (API)
│   ├── _lib/
│   │   ├── auth.ts                  # PBKDF2 + JWT + cookie helpers
│   │   ├── ratelimit.ts             # KV-based rate limit
│   │   └── ai-prompts.ts            # AI_PROMPT (text) + IMAGE_PROMPT (vision)
│   ├── api/
│   │   ├── admin/
│   │   │   ├── login.ts             # POST email+pwd
│   │   │   ├── logout.ts
│   │   │   ├── me.ts                # GET 確認登入 (HttpOnly cookie 不能 JS 讀的解法)
│   │   │   ├── upload-screenshot.ts # W3-F1 R2 upload + batch_images insert
│   │   │   ├── catalog/
│   │   │   │   ├── create.ts        # POST + optional listing_id auto-link
│   │   │   │   └── list.ts          # GET q+limit+offset
│   │   │   └── listings/
│   │   │       ├── batch-save.ts    # POST items + image_r2_keys
│   │   │       └── recent.ts        # GET ?days=&limit= 含 batch_images JOIN
│   │   ├── ai/
│   │   │   ├── extract-listing.ts   # POST text → Groq Worker
│   │   │   └── extract-listing-from-image.ts  # POST images[] → per-image parallel
│   │   ├── public/
│   │   │   └── stats.ts             # GET 統計 (5min KV cache)
│   │   └── screenshot/
│   │       └── [[path]].ts          # Public serve from R2 (no auth, X-Robots-Tag noindex)
├── plasoul-extension/                # Chrome Extension MV3
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── icons/
│   └── README.md
└── scripts/
    ├── hash-password.mjs
    └── setup-admin.mjs               # 重設 admin 密碼用
```

---

## 7. 部署 / Dev 流程

### 第一次接手 — 跑起來
```bash
git clone https://github.com/fightmon/plasoul.git
cd plasoul
npm install
npm run dev                          # http://localhost:4321
```

### 本地測 admin 流程
本地 `npm run dev` 沒有 D1 / KV / R2，只能看 static 首頁。完整測試需要：
```bash
npx wrangler pages dev               # CF Pages local emulator + D1 + KV + R2 mock
```

### 部署到 production
```bash
git push                             # → 自動觸發 CF Pages build
```
CF Pages dashboard 連結 fightmon/plasoul，每次 push 自動 build + deploy。

### 跑 D1 migration (重要：CF Pages build 不會自動跑 migration)
```bash
npx wrangler d1 migrations apply plasoul-db --remote    # production
npx wrangler d1 migrations apply plasoul-db --local     # 本地
```

### 重設 admin 密碼
```bash
node scripts/setup-admin.mjs                            # 互動式
```

---

## 8. 核心資料模型：「一篇貼文 = 一個單位」+ 封面圖（2026-06-03 釐清）

### 8.1 關鍵心智模型（大毛確認）
**一篇 FB 貼文（= 一條連結）才是原子單位**，底下掛它包含的 N 項產品報價。
最小資料單位是一筆 `fb_listings`（某產品 × 某貼文 × 價格），它同時掛在一個**產品**和一個**貼文**底下。

同一份資料，兩個視角：
- **Admin 進資料**：以**貼文**分組 → 一貼文一張卡（封面 + 連結各出現一次），卡內列出 N 項。
- **前台搜尋**：以**產品**投影 → 搜「牛鋼」把每個賣家報價平鋪成一張卡（產品名／價格／資訊／按鈕→連結），照價格排序。同款不同賣家 = 多張卡多條連結（正確，因為是不同賣家/貼文）。

> 「一貼文 10 項炸成 10 連結」只發生在 admin 看單一貼文 → 分組要做在 admin。
> 搜尋頁天生無此問題（搜一個產品，每篇貼文最多貢獻一張卡）。
> 卡片「按鈕→連結」= 商業模式的「前往社團」動作（freemium 計次），指向該貼文 `source_url`。

### 8.2 封面圖功能 — ✅ 已完成（2026-06-03）
**設計決策**：封面本質是 **batch（貼文）層級**資料，存在已是 batch grain 的 `batch_images`、用 `is_cover` 旗標標記——
**不**反正規化到 `fb_listings` 每一列（推翻本節舊版「`fb_listings` 加 `cover_r2_key`」提案）。
理由見對話：旗標做法重用既有上傳 endpoint / relink / JOIN，且未來抽 `source_posts` 時無痛承接。

實作（已 ship 到 working tree，**尚未 commit / 尚未套 migration**）：
1. `migrations/0009_batch_images_cover.sql` — `batch_images` 加 `is_cover INTEGER NOT NULL DEFAULT 0` + index
2. `upload-screenshot.ts` — body 收 `is_cover`，寫入 batch_images
3. `admin/listings.astro` — 頂部「📷 封面圖」獨立區塊（點→Ctrl+V 貼，單張）；存檔時以 `is_cover=1` 上傳，r2_key 併入 `image_r2_keys` 讓 batch-save relink；最近卡片頂部顯示封面
4. `recent.ts` — 封面與一般圖分開回傳（`cover_r2_key` / `image_r2_keys`）

> ⚠️ **部署順序**：`recent.ts` 和 `upload-screenshot.ts` 都依賴 `is_cover` 欄位，欄位不存在會讓截圖上傳整個壞掉。
> 一定要「先 `wrangler d1 migrations apply plasoul-db --remote`、再 push 部署」。本地測同理用 `--local`。

前台優先序（W2 做前台時接）：`catalog.image_r2_key` > 貼文封面（`is_cover`）> 第一張來源圖 > placeholder。

### 8.3 未做：以貼文為單位的「分組顯示」+ source_posts 重構
封面只是第一步。真正完整解是把「貼文」抽成實體（`source_posts` 表），`source_url`/社團/封面歸給貼文，
`fb_listings` FK 到貼文；admin 顯示改成一貼文一張卡（內含 N 項）。

可選層次（待大毛拍板）：
- **完整**：開 `source_posts`（+ 視需要 `assets` / `source_groups`），fb_listings 換 FK，遷移 3000+ 筆 legacy，重寫 batch-save/recent/extension。最正規但成本最高。
- **折中**：只抽 `source_posts`（封面用 `source_posts.cover_asset_id`），assets/groups 暫不拆 → 拿 80% 好處、1/3 成本。
- **只顯示分組**：資料底層不動，admin 前端把同 `batch_id` 的卡併成一張顯示。最快、低風險，但連結底層仍重複存。

詳細推導（3NF 違反、為何 FK 勝過旗標、assets/source_groups 的價值）見 2026-06-03 對話。

---

## 9. 已知問題 / Tech Debt

| 嚴重度 | 問題 | 建議 |
| --- | --- | --- |
| 🟡 | `admin/listings.astro` 1700+ 行 super-page，沒拆 component | W2 後拆 component (Astro 元件化) |
| 🟡 | 統計 API 5min KV cache，新增 listing 後首頁要等 5min 才更新 | 改成「manual invalidate」(admin save 完 POST `/api/admin/cache/invalidate`) |
| 🟢 | 模物獵人 3000+ 筆 records 還沒遷進來 | #100 task |
| 🟢 | 模物獵人 gunplaList 圖庫還沒上 R2 | W0-7 task |
| 🟢 | GP-DOG mascot 4 個版本待 user 給正圖才能正式上 | user 自行處理 |
| 🟢 | Pre-existing dead code: `screenshot_r2_key` 欄位 (預留打碼版用，但 W3-F2 已 kill) | 下次 schema cleanup 一起 drop |

---

## 10. 重要 architectural decisions

### A. 為什麼用 Astro (不是 Next.js / Remix)
- 首頁 + /gundam/[slug] + /search 99% 是 SSG，SEO 主力 — Astro 是最輕的 SSG framework
- Cloudflare Pages 原生支援 Astro + Pages Functions 混合
- 詳見 `docs/ARCHITECTURE.md`

### B. 為什麼用 D1 (不是 Postgres / Planetscale)
- 邊緣讀取 < 10ms (D1 全球分佈)
- 32 RG catalog 規模 SQLite 完全夠用，到 100k 才需要換
- 同 ecosystem (CF Pages + D1 + R2 + KV) 一站式 + 同 billing
- 詳見 `docs/ARCHITECTURE.md`

### C. 為什麼用 PBKDF2 + 自寫 JWT (不是 BetterAuth / Lucia)
- Pages Functions 是 Cloudflare Workers runtime — 無 Node API
- BetterAuth / Lucia 多數依賴 Node 不能直接跑
- PBKDF2 + HMAC-SHA256 都是 Web Crypto API 原生支援，無 dep
- 詳見 `functions/_lib/auth.ts`

### D. 為什麼拔掉 Tailwind
- 跟 rolldown bundler 撞 plugin metadata bug，build 掛
- Audit 後發現 codebase 0 utility class，全部 component-scoped `<style>`
- 拔掉省 3 個 npm dependency + 1 個 build step
- 詳見 commit `83c07fa`

### E. 為什麼 AI 圖解析 per-image parallel
- 30+ 筆品項一張圖塞 Groq max_tokens 8000 會截斷
- 改成 `Promise.all([call1, call2, ...])` 每張圖獨立 call 後 merge dedup
- 詳見 `functions/api/ai/extract-listing-from-image.ts`

### F. 為什麼 Chrome Extension 用 viewport-based DOM 偵測
- FB 開 modal 時 selector-based 抓會抓到 sidebar 留言 (Alex Chen)，不是主 post (Yao Zhang)
- 改用 `getBoundingClientRect().top` 排序，找 viewport 中心的 story_message
- 詳見 `plasoul-extension/popup.js`

---

## 11. 對話進行中：首頁 hero 視覺迭代

User 在最新一輪 (對話結束前) **自己修改了** `src/pages/index.astro`，加了：
- `.ps-eyebrow` 章節小標 pill
- Hero 改兩欄 (左大字 + 右 `.ps-blob` 模型示意 placeholder)
- Stats 改 `.ps-stat-card--peach/mint/rose/amber` 4 色卡片 (後又改回平面 + emoji icon)
- 系列按鈕加 `.ps-series-desc` 副標 ("High Grade" 等英文全名)

接手者若要繼續 polish 首頁，記得 user 自己改過，**不要 revert** 他的設計。

---

## 12. 給接手者的話

普拉魂技術棧不複雜但 CF Pages + D1 + R2 邊緣運算特性要熟悉。前 2 週建議先：
1. 把 §7 dev 流程跑通，本地能跑 admin login
2. 把 §5 緊急清單前 3 項做完 (`/gundam/[slug]` + `/api/public/search` + 封面圖功能)
3. 開始 #100 Firebase 資料遷移，讓統計數字真正出來

有問題優先看 `docs/ARCHITECTURE.md` + commit history (`git log --oneline`)。每個 commit 訊息都寫清楚 why。

Good luck. ⚙️🐶
