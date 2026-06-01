/**
 * KV-based 速率限制（沿用樂創邏輯）
 *
 * 用法：
 *   const r = await checkRateLimit(env.KV, `rl:login:${ip}`, 10, 60);
 *   if (!r.ok) return rateLimitResponse(r.retryAfter);
 *
 * 注意：KV 是最終一致性（eventual consistency），有 ~60s 全球同步延遲。
 * 對於高頻攻擊夠用，但**不適合精確限流**（如「每秒最多 1 次」）。
 */

export interface RateLimitResult {
  ok: boolean;
  count: number;
  remaining: number;
  retryAfter: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  let count = 0;
  const stored = await kv.get(key);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!Number.isNaN(parsed)) count = parsed;
  }

  if (count >= limit) {
    return { ok: false, count, remaining: 0, retryAfter: windowSec };
  }

  count += 1;
  await kv.put(key, String(count), { expirationTtl: windowSec });

  return { ok: true, count, remaining: Math.max(0, limit - count), retryAfter: 0 };
}

/**
 * 失敗計數（給登入失敗 lockout 用）
 */
export async function recordFailure(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number
): Promise<{ blocked: boolean; failures: number }> {
  let count = 0;
  const stored = await kv.get(key);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!Number.isNaN(parsed)) count = parsed;
  }
  count += 1;
  await kv.put(key, String(count), { expirationTtl: windowSec });
  return { blocked: count >= limit, failures: count };
}

export async function clearKey(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

export function rateLimitResponse(retryAfterSec: number, message?: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      code: 'RATE_LIMITED',
      message: message || '操作過於頻繁，請稍後再試',
      retry_after: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(retryAfterSec),
        'Cache-Control': 'no-store',
      },
    }
  );
}

export function getClientId(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}
