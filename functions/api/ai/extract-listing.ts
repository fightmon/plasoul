/**
 * AI 解析 FB 鋼彈交易貼文 → JSON 陣列
 *
 * POST /api/ai/extract-listing
 * Body: { text: string }
 * Returns: { ok: true, items: ParsedItem[] }
 *
 * 流程：
 *   1. requireAdmin (W3-A 的 middleware)
 *   2. KV rate limit (避免 abuse Groq Worker)
 *   3. 串 Groq Worker (lingering-salad-b9dc，模物獵人共用)
 *   4. parse JSON 回傳
 *
 * v0.2 預留：不寫死 admin route，contributor 也能用同一個 endpoint
 * （未來 auth 換成 requireUser，後端用 review_status='pending' 入庫）
 */

import { requireAdmin } from '../../_lib/auth';
import { checkRateLimit, rateLimitResponse } from '../../_lib/ratelimit';
import { AI_PROMPT, type ParsedItem } from '../../_lib/ai-prompts';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  GROQ_WORKER_URL?: string;  // 預設 lingering-salad-b9dc
}

const DEFAULT_GROQ_WORKER = 'https://lingering-salad-b9dc.fightmon.workers.dev';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// Rate limit: 每 admin 每分鐘 20 次（夠你日常用、擋 abuse）
const RATE_LIMIT_PER_MIN = 20;
const RATE_LIMIT_WINDOW = 60;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  // 1. Auth
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  // 2. Rate limit (per user)
  const rateKey = `rl:ai-extract:${user.sub}`;
  const rate = await checkRateLimit(context.env.KV, rateKey, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW);
  if (!rate.ok) {
    return rateLimitResponse(rate.retryAfter, `AI 解析次數過多（每分鐘上限 ${RATE_LIMIT_PER_MIN} 次），請稍候再試`);
  }

  // 3. Parse body
  let body: { text?: string };
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const text = String(body.text || '').trim();
  if (!text) {
    return jsonError('MISSING_TEXT', '請貼上 FB 貼文文字', 400);
  }
  if (text.length > 20000) {
    return jsonError('TEXT_TOO_LONG', '文字過長（上限 20000 字）', 400);
  }

  // 4. 呼叫 Groq Worker
  const workerUrl = context.env.GROQ_WORKER_URL || DEFAULT_GROQ_WORKER;
  let groqResp: Response;
  try {
    groqResp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: AI_PROMPT + text }],
        temperature: 0.1,  // 低溫度保穩定
        max_tokens: 4000,
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

  // 5. Parse Groq response (OpenAI-compatible chat completion)
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

  // 6. 提取 JSON 陣列（AI 偶爾會多包一層 markdown ```json）
  const items = extractJsonArray(aiContent);
  if (!items) {
    return jsonError(
      'AI_PARSE_FAILED',
      `AI 回傳無法解析成 JSON: ${aiContent.slice(0, 300)}`,
      502
    );
  }

  // 7. 後處理：過濾無價格 + active 的廢項目（PRD § 4：無效資料不入庫）
  const validItems = items.filter(
    (it: any) =>
      it &&
      typeof it === 'object' &&
      (it.model || it.originalName) &&
      // sold 可以 price=0；active 必須有價格 >= 50
      (it.status === 'sold' || (Number(it.price) >= 50))
  );

  return new Response(
    JSON.stringify({
      ok: true,
      items: validItems,
      raw_count: items.length,
      filtered_count: validItems.length,
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
 * 從 AI 回傳的字串提取 JSON array。
 * AI 偶爾會回成 markdown ```json [...] ``` 或包前後文字，要 strip 掉。
 */
function extractJsonArray(content: string): ParsedItem[] | null {
  // 試 1：整段就是 JSON
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // 試 2：抓 [ ... ] 區塊
  const arrayMatch = content.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
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
