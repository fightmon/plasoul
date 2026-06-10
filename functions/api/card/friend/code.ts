/**
 * 創鬥卡 · M4 · 好友碼（取得/產生我的可分享 ID；用對方好友碼加好友）
 * GET  /api/card/friend/code            → { ok, friend_code, share_url }
 * POST /api/card/friend/code  { code }  → { ok, friend:{ user_id, name } }
 *
 * 設計（依《系統開發企劃》§2.4、策略藍圖 v2 §7、決策 3）：
 *  - 不走 FB/IG 名單匯入（已死）。好友碼是零依賴最穩主路徑；QR / 分享連結共用此碼。
 *  - friend_code：8 碼 base32 去易混字（拿掉 0/O/1/I），存 arena_players.friend_code（唯一索引）。
 *  - 加好友：建**雙向** arena_friends 邊（互為好友）→ 兩人爬天梯都可能 async 相遇對方防守幽靈
 *    （配對優先序已在 ghost/match.ts 用 arena_friends JOIN 接好，這裡只管建邊）。
 *  - 好友戰（未來直接約戰、不計天梯）另案，見 creatou-friend-battle。
 */
import { requireUser } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const hdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
// base32 去易混字：拿掉 0 O 1 I（也順手拿掉 L U 降低手抄/口述出錯）
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LEN = 8;

function genCode(): string {
  const buf = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: hdr });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;
  const now = Date.now();

  // 確保有 arena_players 列
  await DB.prepare(
    `INSERT INTO arena_players (user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING`,
  ).bind(auth.sub, now, now).run();

  let row = await DB.prepare(`SELECT friend_code FROM arena_players WHERE user_id = ?`).bind(auth.sub).first<any>();
  let code: string | null = row?.friend_code || null;

  // 尚未有碼 → 產生唯一碼（碰撞重試；唯一索引保證不重複）
  if (!code) {
    for (let attempt = 0; attempt < 8 && !code; attempt++) {
      const cand = genCode();
      try {
        const res = await DB.prepare(
          `UPDATE arena_players SET friend_code = ? WHERE user_id = ? AND friend_code IS NULL`,
        ).bind(cand, auth.sub).run();
        // 寫入成功且確實有改到列 → 採用；UNIQUE 撞碼會丟例外 → 重試
        if ((res as any)?.meta?.changes >= 1 || (res as any)?.success) {
          const check = await DB.prepare(`SELECT friend_code FROM arena_players WHERE user_id = ?`).bind(auth.sub).first<any>();
          if (check?.friend_code) { code = check.friend_code; break; }
        }
      } catch { /* UNIQUE 撞碼，重試 */ }
    }
    if (!code) return bad('好友碼產生失敗，請重試', 500);
  }

  const url = new URL(context.request.url);
  const share_url = `${url.origin}/arena?addfriend=${code}`;
  return new Response(JSON.stringify({ ok: true, friend_code: code, share_url }), { status: 200, headers: hdr });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;

  let body: any; try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const code = String(body?.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code || code.length !== CODE_LEN) return bad('好友碼格式不對');

  const owner = await DB.prepare(
    `SELECT p.user_id, u.display_name FROM arena_players p JOIN users u ON u.id = p.user_id WHERE p.friend_code = ?`,
  ).bind(code).first<any>();
  if (!owner) return bad('找不到這個好友碼', 404);
  if (owner.user_id === auth.sub) return bad('不能加自己');

  const now = Date.now();
  // 雙向邊（互為好友）；重複加好友不報錯
  await DB.batch([
    DB.prepare(`INSERT INTO arena_friends (user_id, friend_id, source, created_at) VALUES (?, ?, 'code', ?) ON CONFLICT(user_id, friend_id) DO NOTHING`).bind(auth.sub, owner.user_id, now),
    DB.prepare(`INSERT INTO arena_friends (user_id, friend_id, source, created_at) VALUES (?, ?, 'code', ?) ON CONFLICT(user_id, friend_id) DO NOTHING`).bind(owner.user_id, auth.sub, now),
  ]);

  return new Response(
    JSON.stringify({ ok: true, friend: { user_id: owner.user_id, name: owner.display_name || '玩家' } }),
    { status: 200, headers: hdr },
  );
};
