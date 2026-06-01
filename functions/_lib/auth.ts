/**
 * 普拉魂 PuraSoul · Auth 工具
 *
 * 1. PBKDF2-SHA256 密碼雜湊（Cloudflare Workers 原生 Web Crypto，不用 bcrypt）
 * 2. HMAC-SHA256 JWT 簽發 / 驗證
 * 3. Cookie helpers
 *
 * 沿用樂創 stack（簡化：沒有 tenant_id 概念）
 * 注意：密碼永遠用 PBKDF2 hash 儲存，**永不存明文**
 */

const PBKDF2_ITERATIONS = 100000;

// ============================================
// Password hashing (PBKDF2-SHA256)
// 格式：pbkdf2$<iterations>$<salt-base64>$<hash-base64>
// ============================================

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = base64ToBytes(parts[2]);
  const expectedHash = parts[3];

  const bits = await derive(password, salt, iterations);
  const actualHash = bytesToBase64(new Uint8Array(bits));

  return constantTimeEqual(actualHash, expectedHash);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
}

// ============================================
// JWT (HMAC-SHA256)
// ============================================

export interface JWTPayload {
  sub: string;       // user_id
  email: string;
  role: string;       // 'admin' | 'user'
  iat: number;
  exp: number;
}

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSec: number = 86400
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = { ...payload, iat: now, exp: now + ttlSec };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const signature = await hmacSha256(`${headerB64}.${payloadB64}`, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sig] = parts;
  const expectedSig = await hmacSha256(`${headerB64}.${payloadB64}`, secret);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  try {
    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload: JWTPayload = JSON.parse(payloadJson);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSha256(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(signature));
}

// ============================================
// Cookie helpers
// ============================================

const COOKIE_NAME = 'ps_session';

export function makeAuthCookie(token: string, maxAgeSec: number = 86400): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

export function makeLogoutCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// ============================================
// Auth middleware helper（給 /admin/* 路由用）
// ============================================

export async function getAuthUser(
  request: Request,
  secret: string
): Promise<JWTPayload | null> {
  const cookie = request.headers.get('Cookie');
  const token = parseSessionCookie(cookie);
  if (!token) return null;
  return verifyJWT(token, secret);
}

export async function requireAdmin(
  request: Request,
  secret: string
): Promise<JWTPayload | Response> {
  const user = await getAuthUser(request, secret);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: '請先登入' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (user.role !== 'admin') {
    return new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN', message: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return user;
}

// ============================================
// Encoding helpers
// ============================================

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function base64urlEncode(input: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
