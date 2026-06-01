#!/usr/bin/env node
/**
 * Setup admin user — 用暫存 SQL 檔避開 shell escaping 地獄
 *
 * 用法：
 *   node scripts/setup-admin.mjs <email> <password>        ← 寫進 remote D1
 *   node scripts/setup-admin.mjs <email> <password> --local ← 寫進 local D1
 *   node scripts/setup-admin.mjs <email> <password> --print ← 只 print 不執行
 */

import { webcrypto as crypto } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const [email, password] = positional;

if (!email || !password) {
  console.error('用法: node scripts/setup-admin.mjs <email> <password> [--local|--print]');
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

const useLocal = flags.includes('--local');
const printOnly = flags.includes('--print');
const target = useLocal ? '--local' : '--remote';

const hash = await hashPassword(password);
const userId = 'usr_admin_' + crypto.randomUUID().slice(0, 8);
const now = Date.now();
const emailLower = email.toLowerCase();

// 用 UPSERT 一條搞定（D1 SQLite 支援 ON CONFLICT）— 不用先 INSERT 再 fallback UPDATE
const sql = `INSERT INTO users (id, email, password_hash, display_name, tier, role, created_at, updated_at) VALUES ('${userId}', '${emailLower}', '${hash}', 'Admin', 'pro', 'admin', ${now}, ${now}) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role='admin', updated_at=${now};`;

if (printOnly) {
  console.log('\n-- SQL 預覽：');
  console.log(sql);
  console.log('');
  console.log('-- 手動跑：寫進 sql 檔然後 wrangler --file 執行');
  console.log(`   npx wrangler d1 execute plasoul-db ${target} --file=admin.sql`);
  process.exit(0);
}

// 寫到暫存 SQL 檔（避開 PowerShell 把 SQL 字串切碎的問題）
const tmpFile = join(process.cwd(), '.tmp-setup-admin.sql');
writeFileSync(tmpFile, sql, 'utf-8');

console.log(`\n🔧 寫進 D1 (${useLocal ? 'local' : 'remote'}): ${emailLower} ...`);

// 用 execSync + shell 讓 OS 自己處理 PATH lookup (Windows .cmd / Unix)
const cmd = `npx wrangler d1 execute plasoul-db ${target} --file="${tmpFile}"`;
try {
  execSync(cmd, { stdio: 'inherit' });
} catch (e) {
  if (existsSync(tmpFile)) { try { unlinkSync(tmpFile); } catch {} }
  console.error('\n❌ 執行失敗');
  console.error(`指令: ${cmd}`);
  if (e?.message) console.error(`錯誤: ${e.message}`);
  process.exit(1);
}

// 清掉暫存檔
if (existsSync(tmpFile)) {
  try { unlinkSync(tmpFile); } catch {}
}

console.log('');
console.log('============================================');
console.log(`  Email:  ${emailLower}`);
console.log(`  Role:   admin`);
console.log(`  Tier:   pro`);
console.log(`  Target: ${useLocal ? 'local D1' : 'remote D1'}`);
console.log('============================================');
console.log('');
console.log('✅ 現在去 https://plasoul.com/admin/login 試登入！');
