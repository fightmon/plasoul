/**
 * 創鬥卡 · 卡片生成
 * POST /api/card/generate  Body: { image: { mime, base64 } }
 *
 * 拍成品照 → Groq Vision（ARENA_CARD_PROMPT）→ 後端正規化「固定總預算」四圍（公平、做工不影響）
 * → 隨機稀有度（純外觀）→ 存照片(R2) + 卡(D1) → 回卡。
 * 法律：只處理使用者自己的照片；AI 不輸出官方型號/角色/招式名（prompt 已限制）。
 */
import { requireUser } from '../../_lib/auth';
import { ARENA_CARD_PROMPT, type ArenaType } from '../../_lib/arena-prompt';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  GROQ_WORKER_URL?: string;
}

const WORKER = 'https://lingering-salad-b9dc.fightmon.workers.dev';
const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_BYTES = 4 * 1024 * 1024;

// 公平核心：四圍固定總預算 → 每張卡總和相同（做工/課金都不影響）。數值待模擬微調。
const STAT_BASE = 100;
const STAT_POOL = 400; // 每圍 ≈ 100~500，總和 ≈ 800
const TERRAINS = ['宇宙', '一般', '水中', '沙漠', '森林', '萬能'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return err('INVALID_REQUEST', '請求格式錯誤', 400); }
  const img = body?.image;
  if (!img?.base64 || !img?.mime || !/^image\/(png|jpe?g|webp)$/i.test(img.mime)) return err('INVALID_IMAGE', '圖片格式錯誤（png/jpg/webp）', 400);
  if ((img.base64.length * 3) / 4 > MAX_BYTES) return err('IMAGE_TOO_LARGE', '圖片太大（>4MB）', 400);

  // 呼叫 Vision
  const gen = await analyze(img, context.env.GROQ_WORKER_URL || WORKER);
  if (!gen) return err('AI_FAILED', 'AI 沒生成成功，換張清楚的照片再試', 502);

  // 正規化四圍（固定總預算）
  const stats = normalize(gen.focus);
  const type: ArenaType = (['ranged', 'melee', 'evade'] as const).includes(gen.type) ? gen.type : 'ranged';
  const terrain = TERRAINS.includes(String(gen.terrain)) ? String(gen.terrain) : '萬能';
  const rarity = rollRarity();
  const name = clip(gen.name, 16) || '無名機體';

  const id = 'ac_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();

  // 存照片到 R2
  let photoKey: string | null = null;
  try {
    const bytes = base64ToBytes(img.base64);
    const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : 'jpg';
    const ym = new Date(now).toISOString().slice(0, 7).replace('-', '');
    photoKey = `cards/${ym}/${id}.${ext}`;
    await context.env.R2.put(photoKey, bytes, { httpMetadata: { contentType: img.mime } });
  } catch { photoKey = null; }

  // 確保 arena_players 存在
  await context.env.DB.prepare(
    `INSERT INTO arena_players (user_id, created_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(auth.sub, now, now).run();

  // 寫卡
  await context.env.DB.prepare(
    `INSERT INTO arena_cards
       (id, user_id, name, photo_r2_key, type, hp, atk, def, mob, terrain, special_name, special_desc, flavor, rarity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, auth.sub, name, photoKey, type,
    stats.hp, stats.atk, stats.def, stats.mob,
    terrain, clip(gen.special_name, 20) || '全力一擊', clip(gen.special_desc, 40) || '', clip(gen.flavor, 50) || '',
    rarity, now
  ).run();

  return new Response(JSON.stringify({
    ok: true,
    card: {
      id, name, type, terrain, rarity,
      hp: stats.hp, atk: stats.atk, def: stats.def, mob: stats.mob,
      special_name: clip(gen.special_name, 20) || '全力一擊',
      special_desc: clip(gen.special_desc, 40) || '',
      flavor: clip(gen.flavor, 50) || '',
      photo_url: photoKey ? `/api/screenshot/${photoKey}` : null,
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};

function normalize(focus: any): { hp: number; atk: number; def: number; mob: number } {
  const keys = ['hp', 'atk', 'def', 'mob'] as const;
  const f: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) { const v = Math.max(0, Math.min(10, Math.round(Number(focus?.[k]) || 0))); f[k] = v; sum += v; }
  if (sum === 0) { for (const k of keys) f[k] = 1; sum = 4; }
  const out: any = {};
  for (const k of keys) out[k] = Math.round(STAT_BASE + (f[k] / sum) * STAT_POOL);
  return out;
}

function rollRarity(): string {
  const r = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  if (r < 0.05) return 'SSR';
  if (r < 0.20) return 'SR';
  if (r < 0.50) return 'R';
  return 'N';
}

async function analyze(img: any, workerUrl: string): Promise<any | null> {
  const content = [
    { type: 'text', text: ARENA_CARD_PROMPT },
    { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } },
  ];
  let resp: Response;
  try {
    resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content }], temperature: 0.6, max_tokens: 1000 }),
    });
  } catch { return null; }
  if (!resp.ok) return null;
  let json: any;
  try { json = await resp.json(); } catch { return null; }
  const c = json?.choices?.[0]?.message?.content || '';
  let parsed: any = null;
  try { parsed = JSON.parse(c); } catch { const m = c.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function clip(s: any, n: number): string {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, n);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
