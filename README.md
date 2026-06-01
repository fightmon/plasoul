# 普拉魂 PuraSoul

> 拍張鋼彈，AI 30 秒找你便宜 NT$300 的賣家。

訂閱制 SaaS — 從 FB 社團真實玩家拍賣價，普拉魂幫你找最便宜的鋼普拉。

## 設計原則

- **Mobile-first**：所有 UI 從 375px 寫起，`md:` `lg:` 才加強桌機
- **PWA**：加到主畫面 + LINE 推播 + 離線快取
- **SEO 主力**：per-product URL `/gundam/[slug]` + schema.org Product markup
- **Touch target ≥ 44px**（iOS HIG）
- **iOS input ≥ 16px** 防 auto-zoom

詳見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## Stack
- Astro 6 + Tailwind v4 + TypeScript
- Cloudflare Pages + D1 SQLite + R2 + KV
- Pages Functions（API + LINE Pay v3 + Cron）

## 開發

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # build → dist/
```

## D1 操作

```bash
# 跑 migration（remote）
npx wrangler d1 migrations apply plasoul-db --remote

# 跑 migration（local）
npx wrangler d1 migrations apply plasoul-db --local

# 直接執行 SQL
npx wrangler d1 execute plasoul-db --remote --command "SELECT COUNT(*) FROM catalog"
```

## 部署

push 到 `main` → Cloudflare Pages 自動 deploy。

## 路徑

```
src/
  layouts/     Astro layouts（Layout.astro 共用 shell）
  pages/       靜態頁（/, /search, /gundam/[slug], /pricing, /garage, /alerts）
  components/  reusable Astro components
  styles/      global.css（Tailwind v4 + design tokens）
functions/     Pages Functions（/api/*, /admin/*）
  _lib/        JWT / D1 helpers
migrations/    D1 schema（0001_init.sql ...）
public/        靜態資產（tailwind.css、manifest.json、icons/）
docs/          架構決策紀錄（ARCHITECTURE.md）
```
