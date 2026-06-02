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

  // Compose Groq vision request
  const promptText = images.length > 1
    ? IMAGE_PROMPT.replace('請分析這張', `請分析以下 ${images.length} 張`)
    : IMAGE_PROMPT;

  const contentParts: any[] = [{ type: 'text', text: promptText }];
  images.forEach((img) => {
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    });
  });

  const workerUrl = context.env.GROQ_WORKER_URL || DEFAULT_GROQ_WORKER;
  let groqResp: Response;
  try {
    groqResp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: contentParts }],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });
  } catch (e) {
    return jsonError('UPSTREAM_ERROR', 'AI 服務暫時無法連線', 503);
  }

  if (!groqResp.ok) {
    const errText = await groqResp.text().catch(() => '');
    return jsonError(
      'AI_FAILED',
      `AI 解析失敗 (HTTP ${groqResp.status}): ${errText.slice(0, 200)}`,
      502
    );
  }

  let groqJson: any;
  try {
    groqJson = await groqResp.json();
  } catch {
    return jsonError('AI_INVALID_JSON', 'AI 回傳格式錯誤', 502);
  }

  const aiContent: string = groqJson?.choices?.[0]?.message?.content || '';
  if (!aiContent) {
    return jsonError('AI_EMPTY', 'AI 未回傳結果', 502);
  }

  // 提取 JSON object（含 items 陣列）
  const parsed = extractJsonObject(aiContent);
  if (!parsed) {
    return jsonError(
      'AI_PARSE_FAILED',
      `AI 回傳無法解析: ${aiContent.slice(0, 300)}`,
      502
    );
  }

  const items: ParsedItem[] = Array.isArray(parsed.items) ? parsed.items : [];

  // 後處理：過濾無效 + sold-with-no-price 允許
  const validItems = items.filter(
    (it: any) =>
      it &&
      typeof it === 'object' &&
      (it.model || it.originalName) &&
      (it.status === 'sold' || Number(it.price) >= 50)
  );

  return new Response(
    JSON.stringify({
      ok: true,
      items: validItems,
      raw_count: items.length,
      filtered_count: validItems.length,
      group: parsed.group || '',
      poster: parsed.poster || '',
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
