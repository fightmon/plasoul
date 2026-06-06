/**
 * 創鬥卡 · 卡片自訂（語氣單選 + 招式多掛）
 * POST /api/card/customize  Body: { card_id, tone_id?:string|null, moves?:string[]|null }
 * - tone_id NULL/省略 → 用玩家預設語氣
 * - moves   NULL/省略 → 該天性全部招式（全掛）；給陣列則只啟用清單內、且需符合該卡天性
 * 語氣/招式為純外觀，不影響戰力（伺服器只存、不參與戰鬥計算）。
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

// 招式白名單（與前端 arena.astro 一致；防亂塞）
const MOVES: Record<string, string[]> = {
  ranged: ['laser', 'cannon', 'shotgun', 'homing', 'wave', 'snipe', 'charge'],
  melee: ['slash', 'arc', 'cross', 'impact', 'iai', 'thrust', 'spin'],
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const cardId = typeof body?.card_id === 'string' ? body.card_id : '';
  if (!cardId) return bad('缺少卡片');

  const card = await context.env.DB.prepare(
    `SELECT type FROM arena_cards WHERE user_id = ? AND id = ? AND deleted_at IS NULL`
  ).bind(auth.sub, cardId).first<{ type: string }>();
  if (!card) return bad('卡片不存在或非本人');

  // tone_id：字串或 null（不在此驗證是否存在於 tones.json，前端載入後會 fallback）
  let toneId: string | null = null;
  if (typeof body?.tone_id === 'string' && body.tone_id.trim()) toneId = body.tone_id.trim().slice(0, 40);

  // moves：null = 全掛；陣列 → 過濾為該天性合法招式、去重；空陣列視為全掛（避免無招可出）
  let movesJson: string | null = null;
  const pool = MOVES[card.type] || null;
  if (Array.isArray(body?.moves) && pool) {
    const set = Array.from(new Set(body.moves.filter((m: any) => typeof m === 'string' && pool.includes(m))));
    if (set.length && set.length < pool.length) movesJson = JSON.stringify(set);
    // set.length===0 或 ==全部 → 維持 null（全掛）
  }

  await context.env.DB.prepare(
    `UPDATE arena_cards SET tone_id = ?, moves = ? WHERE user_id = ? AND id = ?`
  ).bind(toneId, movesJson, auth.sub, cardId).run();

  return new Response(JSON.stringify({ ok: true, tone_id: toneId, moves: movesJson }), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

function bad(message: string): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
