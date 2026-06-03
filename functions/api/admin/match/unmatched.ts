/**
 * 待對應報價（按正規化品名分組）
 *
 * GET /api/admin/match/unmatched
 *
 * 把 product_id = cat_unknown 的 listing 依「正規化品名」(去空白+小寫)分組，
 * 同名（含「MGEX攻擊自由」=「MGEX 攻擊自由」）合併成一組，方便一次對應整組。
 *
 * Returns: { ok, groups: [{ key, display_name, series_guess, count, listing_ids, price_min, price_max }], total_listings }
 */

import { requireAdmin } from '../../../_lib/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

// 已知系列前綴（偵測用；偵測不到 → 其他）
const SERIES = [
  'MGEX', 'MGSD', 'MG Ver.Ka', 'MG', 'RG', 'HG', 'PG', 'RE/100', 'SD',
  'METAL ROBOT魂', 'ROBOT魂', 'METAL BUILD', 'GFFMC', 'GFFN', 'SHCM PRO',
  '超合金', '好微笑', '30MF', '30MP', 'FM', 'FRS', 'FW', 'BB', 'EW-RG', 'GQQ',
];

function guessSeries(name: string): string {
  const upper = name.toUpperCase();
  for (const s of SERIES) {
    if (upper.startsWith(s.toUpperCase())) return s;
  }
  return '其他';
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;

  const rows =
    (
      await context.env.DB.prepare(
        `SELECT id, raw_model_name, price
         FROM fb_listings
         WHERE product_id = 'cat_unknown' AND review_status = 'approved'
         ORDER BY raw_model_name`
      ).all<{ id: string; raw_model_name: string; price: number }>()
    ).results || [];

  const map = new Map<
    string,
    { display: Record<string, number>; ids: string[]; min: number; max: number }
  >();

  for (const r of rows) {
    const name = (r.raw_model_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, '');
    let g = map.get(key);
    if (!g) {
      g = { display: {}, ids: [], min: r.price, max: r.price };
      map.set(key, g);
    }
    g.display[name] = (g.display[name] || 0) + 1; // 統計原始寫法，取最常見當顯示名
    g.ids.push(r.id);
    if (r.price < g.min) g.min = r.price;
    if (r.price > g.max) g.max = r.price;
  }

  const groups = [...map.entries()]
    .map(([key, g]) => {
      const display_name = Object.entries(g.display).sort((a, b) => b[1] - a[1])[0][0];
      return {
        key,
        display_name,
        series_guess: guessSeries(display_name),
        count: g.ids.length,
        listing_ids: g.ids,
        price_min: g.min,
        price_max: g.max,
      };
    })
    .sort((a, b) => b.count - a.count || a.display_name.localeCompare(b.display_name));

  return new Response(
    JSON.stringify({ ok: true, groups, group_count: groups.length, total_listings: rows.length }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};
