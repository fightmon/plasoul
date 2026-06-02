/**
 * AI Vision 解析 FB 貼文截圖 / 商品照片 → JSON 陣列
 *
 * POST /api/ai/extract-listing-from-image
 * Body: { images: [{ mime, base64 }] }
 * Returns: { ok: true, items: ParsedItem[], group?, poster? }
 *
 * 同 extract-listing.ts，但走 Vision API
 * 模型：meta-llama/llama-4-scout-17b-16e-instruct (Groq Worker 已 deploy)
 */

import { requireAdmin } from '../../_lib/auth';
import { checkRateLimit, rateLimitResponse } from '../../_lib/ratelimit';
import { IMAGE_PROMPT, type ParsedItem } from '../../_lib/ai-prompts';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  GROQ_WORKER_URL?: string;
}

const DEFAULT_GROQ_WORKER = 'https://lingering-salad-b9dc.fightmon.workers.dev';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// 圖片解析比文字慢，rate limit 嚴一點
const RATE_LIMIT_PER_MIN = 10;
const RATE_LIMIT_WINDOW = 60;

// Groq image input limit ~5MB per request (含 base64 overhead)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface IncomingImage {
  mime?: string;
  base64?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  const rateKey = `rl:ai-image:${user.sub}`;
  const rate = await checkRateLimit(context.env.KV, rateKey, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW);
  if (!rate.ok) {
    return rateLimitResponse(
      rate.retryAfter,
      `圖片解析次數過多（每分鐘上限 ${RATE_LIMIT_PER_MIN} 次），請稍候再試`
    );
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const images: IncomingImage[] = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return jsonError('NO_IMAGES', '請至少上傳一張圖', 400);
  }
  if (images.length > 4) {
    return jsonError('TOO_MANY_IMAGES', '一次最多 4 張圖', 400);
  }

  // Validate image size + mime
  for (const img of images) {
    if (!img.base64 || !img.mime) {
      return jsonError('INVALID_IMAGE', '圖片格式錯誤（缺 base64 或 mime）', 400);
    }
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(img.mime)) {
      return jsonError('UNSUPPORTED_MIME', `不支援的圖片類型: ${img.mime}`, 400);
    }
    const bytes = (img.base64.length * 3) / 4; // base64 → bytes 估算
    if (bytes > MAX_IMAGE_BYTES) {
      return jsonError('IMAGE_TOO_LARGE', `圖片太大（>${MAX_IMAGE_BYTES / 1024 / 1024}MB）`, 400);
    }
  }

  // 可選：附帶文字（從 textarea 來的，當 context 給 AI）
  const extraText = String(body.text || '').trim().slice(0, 4000);

  const workerUrl = context.env.GROQ_WORKER_URL || DEFAULT_GROQ_WORKER;

  // 每張圖獨立 call Groq（避免 max_tokens 不夠塞多商品 JSON）
  // 並行送，加快速度
  const results = await Promise.all(
    images.map((img, idx) => analyzeOneImage(img, idx, images.length, extraText, workerUrl))
  );

  // Merge items + 去重（同 model + price 視為同一筆）
  const allItems: ParsedItem[] = [];
  const seenKeys = new Set<string>();
  let errorMsg = '';
  let group = '';
  let poster = '';

  for (const r of results) {
    if (r.error) {
      errorMsg = errorMsg || r.error;
      continue;
    }
    if (!group && r.group) group = r.group;
    if (!poster && r.poster) poster = r.poster;
    for (const it of r.items) {
      const key = `${(it.model || it.originalName || '').toLowerCase()}|${it.price}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allItems.push(it);
    }
  }

  if (allItems.length === 0 && errorMsg) {
    return jsonError('AI_FAILED', errorMsg, 502);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      items: allItems,
      raw_count: allItems.length,
      filtered_count: allItems.length,
      group,
      poster,
      partial_error: errorMsg || undefined,
      image_count: images.length,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
};

/**
 * 單張圖 call Groq Vision
 */
async function analyzeOneImage(
  img: IncomingImage,
  idx: number,
  total: number,
  extraText: string,
  workerUrl: string
): Promise<{ items: ParsedItem[]; group?: string; poster?: string; error?: string }> {
  const promptPrefix = total > 1
    ? `（這是第 ${idx + 1}/${total} 張圖）\n`
    : '';
  const extraContext = extraText
    ? `\n\n附加文字資訊（可參考補充，但以圖片為主）：\n${extraText}\n`
    : '';
  const promptText = promptPrefix + IMAGE_PROMPT + extraContext;

  const contentParts: any[] = [
    { type: 'text', text: promptText },
    {
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    },
  ];

  let resp: Response;
  try {
    resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: contentParts }],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });
  } catch (e: any) {
    return { items: [], error: `第 ${idx + 1} 張連線錯誤: ${e?.message || e}` };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      items: [],
      error: `第 ${idx + 1} 張 HTTP ${resp.status}: ${errText.slice(0, 100)}`,
    };
  }

  let json: any;
  try {
    json = await resp.json();
  } catch {
    return { items: [], error: `第 ${idx + 1} 張回傳非 JSON` };
  }

  const content = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObject(content);
  if (!parsed) {
    return { items: [], error: `第 ${idx + 1} 張 AI 回傳無法解析` };
  }

  const items: ParsedItem[] = Array.isArray(parsed.items) ? parsed.items : [];
  const validItems = items.filter(
    (it: any) =>
      it &&
      typeof it === 'object' &&
      (it.model || it.originalName) &&
      (it.status === 'sold' || Number(it.price) >= 50 || Number(it.price) === 0)
  );

  return {
    items: validItems,
    group: parsed.group || '',
    poster: parsed.poster || '',
  };
}

/**
 * 從 AI content 提取 JSON object（含 items[]）
 * AI 偶爾包 markdown ```json ... ```
 */
function extractJsonObject(content: string): any {
  // 試 1：整段是 JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  // 試 2：抓 { ... } 區塊
  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }

  return null;
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
