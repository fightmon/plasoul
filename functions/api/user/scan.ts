/**
 * 拍盒辨識（使用者）— AI 認盒 → 對 catalog → 回傳可入庫的產品
 * POST /api/user/scan  Body: { images: [{ mime, base64 }] }（1~3 張）
 *
 * - requireUser
 * - 月額度（KV）：free 3 / premium 30 / pro 100（PRD §7.4）
 * - Groq Vision（沿用 admin 的 IMAGE_PROMPT / Worker）辨識型號
 * - 把辨識到的型號對到 catalog（LIKE），回傳 matched / unmatched
 * 法律：只辨識使用者自己的盒，不涉賣家資料
 */
import { requireUser } from '../../_lib/auth';
import { IMAGE_PROMPT } from '../../_lib/ai-prompts';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  GROQ_WORKER_URL?: string;
}

const WORKER = 'https://lingering-salad-b9dc.fightmon.workers.dev';
const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_BYTES = 4 * 1024 * 1024;
const MONTHLY: Record<string, number> = { free: 3, premium: 30, pro: 100 };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }
  const images: any[] = Array.isArray(body.images) ? body.images : [];
  if (!images.length) return err('NO_IMAGES', '請上傳照片', 400);
  if (images.length > 3) return err('TOO_MANY', '一次最多 3 張', 400);
  for (const im of images) {
    if (!im.base64 || !im.mime || !/^image\/(png|jpe?g|webp|gif)$/i.test(im.mime)) return err('INVALID_IMAGE', '圖片格式錯誤', 400);
    if ((im.base64.length * 3) / 4 > MAX_BYTES) return err('IMAGE_TOO_LARGE', '圖片太大（>4MB）', 400);
  }

  // 月額度（KV）
  const ur = await context.env.DB.prepare(`SELECT tier FROM users WHERE id = ?`).bind(auth.sub).first<{ tier: string }>();
  const tier = ur?.tier || 'free';
  const limit = MONTHLY[tier] ?? 3;
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const quotaKey = `scan:${auth.sub}:${month}`;
  const used = parseInt((await context.env.KV.get(quotaKey)) || '0', 10);
  if (used >= limit) {
    return err('QUOTA_EXCEEDED', `本月拍盒額度已用完（${limit} 次）。升級可用更多`, 402);
  }

  // 呼叫 Vision（每張並行）
  const workerUrl = context.env.GROQ_WORKER_URL || WORKER;
  const results = await Promise.all(images.map((im) => analyze(im, workerUrl)));
  const names: { name: string; series: string; scale: string }[] = [];
  const seen = new Set<string>();
  let aiErr = '';
  for (const r of results) {
    if (r.error) { aiErr = aiErr || r.error; continue; }
    for (const it of r.items) {
      const name = String(it.model || it.originalName || '').trim();
      if (!name) continue;
      const key = name.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ name, series: String(it.series || '').trim(), scale: String(it.scale || '').trim() });
    }
  }
  if (!names.length) return err('NO_RESULT', aiErr || 'AI 沒辨識到型號，換張清楚的照片試試', 502);

  // 對 catalog
  const matched: any[] = [];
  const unmatched: string[] = [];
  for (const n of names) {
    const like = `%${n.name}%`;
    const c = await context.env.DB.prepare(
      `SELECT slug, full_name, series, image_r2_key FROM catalog
       WHERE is_active = 1 AND id != 'cat_unknown' AND (full_name LIKE ? OR search_text LIKE ?)
       ORDER BY CASE WHEN series = ? THEN 0 ELSE 1 END, length(full_name) ASC LIMIT 1`
    ).bind(like, like, n.series).first<any>();
    if (c) matched.push({ identified: n.name, slug: c.slug, full_name: c.full_name, series: c.series, image_r2_key: c.image_r2_key });
    else unmatched.push(n.name);
  }

  // 扣額度（成功才扣）
  await context.env.KV.put(quotaKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 35 });

  return new Response(
    JSON.stringify({ ok: true, matched, unmatched, quota: { used: used + 1, limit }, partial_error: aiErr || undefined }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
};

async function analyze(img: any, workerUrl: string): Promise<{ items: any[]; error?: string }> {
  const content = [
    { type: 'text', text: IMAGE_PROMPT },
    { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } },
  ];
  let resp: Response;
  try {
    resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: 3000 }),
    });
  } catch (e: any) { return { items: [], error: 'AI 連線錯誤' }; }
  if (!resp.ok) return { items: [], error: `AI HTTP ${resp.status}` };
  let json: any;
  try { json = await resp.json(); } catch { return { items: [], error: 'AI 回傳非 JSON' }; }
  const c = json?.choices?.[0]?.message?.content || '';
  let parsed: any = null;
  try { parsed = JSON.parse(c); } catch { const m = c.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  if (!parsed) return { items: [], error: 'AI 回傳無法解析' };
  return { items: Array.isArray(parsed.items) ? parsed.items : [] };
}

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
