/**
 * 編輯會員卡片（admin）：可改全部欄位（含四圍數值，會破壞戰力平衡，僅管理/測試用）
 * POST /api/admin/users/card-update
 * body: { card_id, name?, type?, hp?, atk?, def?, mob?, terrain?, special_name?, special_desc?,
 *         flavor?, rarity?, tone_id?(string|null), moves?(string[]|null), is_support?, is_seed? }
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const TYPES = ['ranged', 'melee', 'evade'];
const RARITY = ['N', 'R', 'SR', 'SSR'];
const NUMS = ['hp', 'atk', 'def', 'mob'];
const TEXTS = ['name', 'terrain', 'special_name', 'special_desc', 'flavor'];
const MOVES_OK: Record<string, string[]> = {
  ranged: ['laser', 'cannon', 'shotgun', 'homing', 'wave', 'snipe', 'charge'],
  melee: ['slash', 'arc', 'cross', 'impact', 'iai', 'thrust', 'spin'],
  evade: ['slash', 'arc', 'cross', 'impact', 'iai', 'thrust', 'spin'],
};

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any; try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const cardId = String(body?.card_id || '').trim();
  if (!cardId) return bad('缺少卡片 id');

  const card = await context.env.DB.prepare(`SELECT id, type FROM arena_cards WHERE id = ?`).bind(cardId).first<any>();
  if (!card) return bad('找不到該卡片', 404);
  const newType = 'type' in body ? body.type : card.type;

  const sets: string[] = [], binds: any[] = [];

  for (const f of TEXTS) if (f in body) { sets.push(`${f} = ?`); binds.push(body[f] == null ? null : String(body[f]).slice(0, 200)); }
  for (const f of NUMS) if (f in body) {
    const v = body[f]; if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${f} 不是數字`);
    sets.push(`${f} = ?`); binds.push(Math.max(0, Math.round(v)));
  }
  if ('type' in body) { if (!TYPES.includes(body.type)) return bad('天性值不合法'); sets.push('type = ?'); binds.push(body.type); }
  if ('rarity' in body) { if (!RARITY.includes(body.rarity)) return bad('稀有度不合法'); sets.push('rarity = ?'); binds.push(body.rarity); }
  if ('is_support' in body) { sets.push('is_support = ?'); binds.push(body.is_support ? 1 : 0); }
  if ('is_seed' in body) { sets.push('is_seed = ?'); binds.push(body.is_seed ? 1 : 0); }
  if ('tone_id' in body) { sets.push('tone_id = ?'); binds.push(body.tone_id ? String(body.tone_id).slice(0, 40) : null); }
  if ('moves' in body) {
    let mv: string | null = null;
    if (Array.isArray(body.moves)) {
      const pool = MOVES_OK[newType] || [];
      const set = Array.from(new Set(body.moves.filter((m: any) => typeof m === 'string' && pool.includes(m))));
      if (set.length && set.length < pool.length) mv = JSON.stringify(set);   // 全掛/空 → null
    }
    sets.push('moves = ?'); binds.push(mv);
  }

  if (!sets.length) return bad('沒有要更新的欄位');
  binds.push(cardId);
  await context.env.DB.prepare(`UPDATE arena_cards SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
