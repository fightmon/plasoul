/**
 * 會員完整資料（admin）：帳號 + 創鬥卡天梯 + 卡片清單
 * GET /api/admin/users/detail?id=<userId>
 * Returns: { ok, user, arena, cards:[...] }
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const id = (new URL(context.request.url).searchParams.get('id') || '').trim();
  if (!id) return bad('缺少會員 id');

  const u = await context.env.DB.prepare(
    `SELECT id, email, display_name, tier, tier_expires_at, role, created_at, deleted_at,
            CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pw,
            CASE WHEN line_user_id  IS NOT NULL THEN 1 ELSE 0 END AS has_line,
            CASE WHEN google_id     IS NOT NULL THEN 1 ELSE 0 END AS has_google
     FROM users WHERE id = ?`
  ).bind(id).first<any>();
  if (!u) return bad('找不到該會員', 404);

  const ap = await context.env.DB.prepare(
    `SELECT parts, coins, rank_score, best_rank, ship_slots, ship_card_ids, ship_base_hp, wins, losses, is_seed
     FROM arena_players WHERE user_id = ?`
  ).bind(id).first<any>();

  const rows = (await context.env.DB.prepare(
    `SELECT id, name, type, hp, atk, def, mob, terrain, special_name, special_desc, flavor, rarity,
            tone_id, moves, wins, battles, is_support, is_seed, photo_r2_key, deleted_at, created_at
     FROM arena_cards WHERE user_id = ? ORDER BY deleted_at IS NOT NULL, created_at DESC`
  ).bind(id).all<any>()).results || [];

  const cards = rows.map((r) => ({
    id: r.id, name: r.name, type: r.type,
    hp: r.hp, atk: r.atk, def: r.def, mob: r.mob,
    terrain: r.terrain, special_name: r.special_name, special_desc: r.special_desc, flavor: r.flavor,
    rarity: r.rarity, tone_id: r.tone_id || null, moves: r.moves || null,
    wins: r.wins, battles: r.battles, is_support: !!r.is_support, is_seed: !!r.is_seed,
    photo_url: r.photo_r2_key ? `/api/screenshot/${r.photo_r2_key}` : null,
    deleted: r.deleted_at != null, created_at: r.created_at,
  }));

  const user = {
    id: u.id, email: u.email, display_name: u.display_name,
    tier: u.tier, tier_expires_at: u.tier_expires_at, role: u.role,
    created_at: u.created_at, suspended: u.deleted_at != null,
    methods: { email: !!u.has_pw, line: !!u.has_line, google: !!u.has_google },
  };
  const arena = ap ? {
    parts: ap.parts || 0, coins: ap.coins || 0, rank_score: ap.rank_score || 0, best_rank: ap.best_rank || 0,
    ship_slots: ap.ship_slots || 3, ship_base_hp: ap.ship_base_hp || 800,
    wins: ap.wins || 0, losses: ap.losses || 0, is_seed: !!ap.is_seed,
  } : null;

  return new Response(JSON.stringify({ ok: true, user, arena, cards }), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
