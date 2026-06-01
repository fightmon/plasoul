#!/usr/bin/env node
/**
 * 算 PBKDF2-SHA256 password hash（給 admin seed 用）
 *
 * 用法：
 *   node scripts/hash-password.mjs '你的密碼'
 *
 * 輸出格式：pbkdf2$100000$<salt-base64>$<hash-base64>
 * 直接複製貼到 migration SQL 的 password_hash 欄位
 *
 * 跟 functions/_lib/auth.ts 的 hashPassword 算法一致（Web Crypto + PBKDF2-SHA256）
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

  const bytesToBase64 = (bytes) => Buffer.from(bytes).toString('base64');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

const password = process.argv[2];
if (!password) {
  console.error('用法: node scripts/hash-password.mjs <你的密碼>');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);
