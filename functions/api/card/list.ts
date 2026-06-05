/**
 * 創鬥卡 · 格納庫列表 + 玩家狀態
 * GET /api/card/list
 * → { ok, player:{parts,coins,rank_score,ship_slots,ship_card_ids,ship_base_hp,wins,losses}, cards:[...] }
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO arena_players (user_id, created_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(auth.sub, now, now).run();

  const p = await context.env.DB.prepare(
    `SELECT parts, coins, rank_score, ship_slots, ship_card_ids, ship_base_hp, wins, losses
     FROM arena_players WHERE user_id = ?`
  ).bind(auth.sub).first<any>();

  const rows = (await context.env.DB.prepare(
    `SELECT id, name, photo_r2_key, type, hp, atk, def, mob, terrain, special_name, special_desc, flavor, rarity, wins, battles, created_at
     FROM arena_cards WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`
  ).bind(auth.sub).all<any>()).results || [];

  const cards = rows.map((r) => ({
    id: r.id, name: r.name, type: r.type,
    hp: r.hp, atk: r.atk, def: r.def, mob: r.mob,
    terrain: r.terrain, special_name: r.special_name, special_desc: r.special_desc, flavor: r.flavor,
    rarity: r.rarity, wins: r.wins, battles: r.battles,
    photo_url: r.photo_r2_key ? `/api/screenshot/${r.photo_r2_key}` : null,
  }));

  return new Response(JSON.stringify({
    ok: true,
    player: {
      parts: p?.parts || 0,
      coins: p?.coins || 0,
      rank_score: p?.rank_score || 0,
      ship_slots: p?.ship_slots || 3,
      ship_card_ids: p?.ship_card_ids ? safeArr(p.ship_card_ids) : [],
      ship_base_hp: p?.ship_base_hp || 800,
      wins: p?.wins || 0,
      losses: p?.losses || 0,
    },
    cards,
  }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};

function safeArr(s: string): string[] {
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}
