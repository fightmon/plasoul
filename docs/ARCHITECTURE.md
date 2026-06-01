# 普拉魂 PuraSoul · 架構決策紀錄

> 紀錄 v0.1 設計階段的重大決策與「為什麼」。
> 未來想改方向前，先讀這份檔案理解原始 trade-off。

---

## 1. Stack 選型（2026-06-01 鎖定）

### 選用：Astro 6 + Tailwind v4 + Cloudflare Pages + D1

| 候選 | 結論 | 理由 |
|---|---|---|
| ✅ **Astro + Cloudflare** | 選用 | SEO 強、stack 跟樂創一致、cost ≈ 0、學習曲線 0 |
| ❌ Next.js + Vercel | 不選 | SEO 同強但 cost 較高、stack 不對齊 |
| ❌ 保留模物獵人 Firebase | 不選 | SPA 對 SEO 弱、技術債深、未來維護分裂 |

---

## 2. 設計思維：Mobile-first（2026-06-01 鎖定）

PRD § 8.2 Hero「拍張鋼彈 30 秒」是手機操作。TA 70-80% 手機造訪。

### 寫法準則

- `global.css` base font-size **16px**（手機）
- `@media (min-width: 768px)` 才放大到 17px（桌機）
- 所有 Tailwind responsive class 用 mobile-first（base + `md:` `lg:` 漸進加強）
- Touch target ≥ **44px**（iOS HIG）— 由 component 自負責
- iOS input `font-size: 16px` 防 auto-zoom
- `env(safe-area-inset-*)`（iPhone notch）

---

## 3. 純 Web 不做 Native App（2026-06-01 鎖定）

### 對標案例

| 公司 | 性質 | 路線 | 結果 |
|---|---|---|---|
| **Discogs**（最像 plasoul）| 黑膠收藏 + 比價 | 25 年純 Web | 估值 NT$48 億 |
| **Honey**（PRD 對標）| 找便宜瀏覽器插件 | Web + Extension | PayPal USD 4 億收購 |
| **Yiqi**（PRD § 1.2 對標師父）| 對帳 SaaS | 純 Web | 持續成長 |

### 純 Web 的優勢

1. **SEO 是 plasoul 核心獲客**（PRD § 10），Native App 為 0
2. **LINE Pay 訂閱避開 Apple/Google 30% 抽成**
3. **LINE 推播比 iOS Web Push 對台灣 TA 更貼**
4. 改版即時生效不過審
5. 學習曲線 0（沿用樂創 stack）

### PWA 補強

- 加到主畫面 icon = 視覺上跟 App 一樣（透過 `manifest.json`）
- Service Worker 離線快取（v0.2 加強）
- 推播走 LINE Messaging API（不靠 Web Push）

### 未來門

Capacitor 是後備選項。同 Astro code base 隨時可包成 hybrid app。不被綁死。

### TA 不要求 App
鋼普拉玩家 25-45 男性收藏家，2026-06-01 大毛判斷「他們在乎能不能找到便宜，不是有沒有 App」。

---

## 4. 跟樂創（LeVibe）的關係

| 抄了什麼 | 沒抄什麼 |
|---|---|
| ✅ deps 版本（Astro 6.3.3 / Tailwind v4.3 / TS 6.0） | ❌ 業務邏輯（活動 / 抽獎 / super-tenant） |
| ✅ build pipeline（`tailwind:build` + `astro build`） | ❌ D1 schema（plasoul 7 表完全不同） |
| ✅ `.gitattributes` 防 CRLF | ❌ render-shell / wheel / scratch UI |
| ✅ wrangler.toml D1/KV/R2 binding 模板 | ❌ 樂創 admin role-based UI |
| ✅ D1 migration 經驗（小心 SELECT 三處同步） | ❌ ECPay 金流邏輯 |

---

## 5. v0.1 7 表 schema 設計

詳見 `migrations/0001_init.sql`。重點：

### `fb_listings` 預留欄位（v0.2 開放用戶貢獻）

- `contributor_user_id`（NULL = 大毛 admin 加的）
- `review_status`（'pending' / 'approved' / 'rejected'）
- `review_notes`（拒絕原因）

v0.2 開放用戶貢獻只要 8-12 hr，不是 30+ hr 重構。

### `is_legacy` 標記

模物獵人 Firebase 帶過來的 3000+ 筆紀錄標 `is_legacy=1`，**只進「30 天均價區間」計算**，不單獨呈現為「PO 證據」（PRD § 3.4 期待管理）。

---

## 6. 既有資產整合策略

### 沿用（不重寫）
- Cloudflare Workers `lingering-salad-b9dc`（Groq AI proxy）
- Cloudflare Workers `polished-grass-f3f9`（Shopee search proxy）

### 從模物獵人 copy-paste
- `AI_PROMPT` / `IMAGE_PROMPT`（最值錢的 prompt 調教成果）
- `parseBundleSale` / `parseParallelSections` / `parseSoldStatus` 邏輯
- `rg-products.json` → seed catalog
- `images/gunplaList/` → 進 R2

### 從鋼彈山積（B 專案）參考
- LINE Pay v3 整合邏輯（Firebase Functions → 移植 Pages Functions）
- 不抄 admin 後台 / 公告 / setup wizard（個人 SaaS 用不到）

---

## 7. 法律紅線（PRD § 5.2）

1. ❌ 對外不能說「我們爬 FB」 → ✅ 寫「玩家社群實際交易參考價彙整」
2. ❌ 不存賣家任何個資
3. ❌ 不公開賣家 ID / contact（前台不顯示 source_url）
4. ❌ 不引導用戶聯絡截圖中的賣家
5. ✅ 服務條款明確寫「資料來自社群觀察，不保證交易可行性」

Chrome Extension（W3）上 Chrome Web Store 必須寫「Personal Gundam price tracker」，不能寫「FB scraping」。
