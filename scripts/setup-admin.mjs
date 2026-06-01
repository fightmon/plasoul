#!/usr/bin/env node
/**
 * Setup admin user — 算密碼 hash 並產生 wrangler INSERT 指令
 *
 * 用法：
 *   node scripts/setup-admin.mjs <email> <password>
 *
 * 範例：
 *   node scripts/setup-admin.mjs fightmon@gmail.com '你的強密碼'
 *
 * 輸出：一行 PowerShell 指令，複製貼上跑就會把 admin 寫進 D1
 * （不會自動跑，避免不小心執行）
 */

import { webcrypto as crypto } from 'node:crypto';

const PBKDF2_ITERATIONS = 100000;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('用法: node scripts/setup-admin.mjs <email> <password>');
  console.error('例:   node scripts/setup-admin.mjs fightmon@gmail.com "你的密碼"');
  process.exit(1);
}

if (!email.includes('@')) {
  console.error('Email 格式不對');
  process.exit(1);
}
if (password.length < 8) {
  console.error('密碼至少 8 字元');
  process.exit(1);
}

const hash = await hashPassword(password);
const userId = 'usr_admin_' + crypto.randomUUID().slice(0, 8);
const now = Date.now();

const sql = `INSERT INTO users (id, email, password_hash, display_name, tier, role, created_at, updated_at) VALUES ('${userId}', '${email.toLowerCase()}', '${hash}', 'Admin', 'pro', 'admin', ${now}, ${now});`;

console.log('');
console.log('============================================');
console.log('Admin 設定 SQL 產生完成');
console.log('============================================');
console.log('');
console.log('複製下面整行貼到 PowerShell 跑（會寫進 D1 remote）：');
console.log('');
console.log(`npx wrangler d1 execute plasoul-db --remote --command "${sql.replace(/"/g, '\\"')}"`);
console.log('');
console.log('或者改 --remote 為 --local 先在 local DB 測');
console.log('');
console.log('成功後：');
console.log(`  Email:    ${email.toLowerCase()}`);
console.log(`  User ID:  ${userId}`);
console.log(`  Role:     admin`);
console.log(`  Tier:     pro`);
console.log('');
console.log('⚠️  密碼 hash 僅顯示一次，等下用 /admin/login 測試');
console.log('');
