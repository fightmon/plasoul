/**
 * 創鬥卡 · M4 · 好友清單 + 近期好友相遇
 * GET /api/card/friend/list
 * → { ok, friends:[{ user_id, name, rank_score, tier_idx, has_ghost }],
 *      encounters:[{ name, win, created_at }] }
 *
 * - friends：我加過的好友（arena_friends 我這端），帶對方天梯分/階與是否有防守幽靈在池。
 * - encounters：我在天梯打到「好友防守幽靈」的近期紀錄（async 相遇通知；battle.ts 命中好友幽靈時寫入）。
 */
import { requireUser } from '../../../_lib/auth';
import { TIERS } from '../../../_lib/arena-tier';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const hdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;

  const friendRows = (await DB.prepare(
    `SELECT f.friend_id, u.display_name, p.rank_score, p.tier_idx, p.active_ghost_id
     FROM arena_friends f
     JOIN users u ON u.id = f.friend_id
     LEFT JOIN arena_players p ON p.user_id = f.friend_id
     WHERE f.user_id = ?
     ORDER BY p.rank_score DESC`,
  ).bind(auth.sub).all<any>()).results || [];

  const friends = friendRows.map((r: any) => ({
    user_id: r.friend_id,
    name: r.display_name || '玩家',
    rank_score: r.rank_score || 0,
    tier_idx: r.tier_idx || 0,
    tier: TIERS[r.tier_idx || 0],
    has_ghost: !!r.active_ghost_id,
  }));

  const encRows = (await DB.prepare(
    `SELECT e.win, e.created_at, u.display_name
     FROM arena_encounters e
     LEFT JOIN users u ON u.id = e.ghost_owner
     WHERE e.user_id = ? AND e.is_friend = 1
     ORDER BY e.created_at DESC LIMIT 10`,
  ).bind(auth.sub).all<any>()).results || [];

  const encounters = encRows.map((r: any) => ({
    name: r.display_name || '好友',
    win: r.win,
    created_at: r.created_at,
  }));

  return new Response(JSON.stringify({ ok: true, friends, encounters }), { status: 200, headers: hdr });
};
