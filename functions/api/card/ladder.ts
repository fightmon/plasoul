/**
 * 創鬥卡 · 天梯
 * GET /api/card/ladder
 * → { ok, me:{rank,rank_score,wins,losses,has_fleet},
 *      top:[{rank,name,rank_score,wins,losses,fleet:[{name,type,rarity,photo}]}],
 *      candidates:[{user_id,name,rank_score,wins,losses,base_hp,fleet:[{name,type,rarity,hp,atk,def,mob,photo}]}] }
 * 候選 = 同分段隨機 3 名真人/種子防守艦隊（分數 ≥ 我-40 優先），不可撈。
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const TOP_N = 30;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;

  const meRow = await DB.prepare(
    `SELECT rank_score, wins, losses, ship_card_ids FROM arena_players WHERE user_id = ?`
  ).bind(auth.sub).first<any>();
  const myScore = meRow?.rank_score || 0;
  let myFleet: string[] = []; try { myFleet = meRow?.ship_card_ids ? JSON.parse(meRow.ship_card_ids) : []; } catch {}
  const hasFleet = myFleet.length > 0;

  const FLEET_OK = `p.ship_card_ids IS NOT NULL AND p.ship_card_ids != '[]'`;

  // 我的名次（有防守艦隊的玩家中，分數比我高的數量 + 1）
  const higher = await DB.prepare(
    `SELECT COUNT(*) AS n FROM arena_players p WHERE ${FLEET_OK} AND p.rank_score > ?`
  ).bind(myScore).first<any>();
  const myRank = (higher?.n || 0) + 1;

  // 排行榜 Top N
  const topRows = (await DB.prepare(
    `SELECT p.user_id, p.rank_score, p.wins, p.losses, p.ship_card_ids, u.display_name
     FROM arena_players p JOIN users u ON u.id = p.user_id
     WHERE ${FLEET_OK} ORDER BY p.rank_score DESC LIMIT ${TOP_N}`
  ).bind().all<any>()).results || [];

  // 候選對手：同分段隨機 3（分數 ≥ 我-40，排除自己）；不足則放寬
  let candRows = (await DB.prepare(
    `SELECT p.user_id, p.rank_score, p.wins, p.losses, p.ship_card_ids, p.ship_base_hp, u.display_name
     FROM arena_players p JOIN users u ON u.id = p.user_id
     WHERE ${FLEET_OK} AND p.user_id != ? AND p.rank_score >= ?
     ORDER BY RANDOM() LIMIT 3`
  ).bind(auth.sub, myScore - 40).all<any>()).results || [];
  if (candRows.length < 3) {
    const have = new Set(candRows.map((c: any) => c.user_id));
    const more = (await DB.prepare(
      `SELECT p.user_id, p.rank_score, p.wins, p.losses, p.ship_card_ids, p.ship_base_hp, u.display_name
       FROM arena_players p JOIN users u ON u.id = p.user_id
       WHERE ${FLEET_OK} AND p.user_id != ? ORDER BY RANDOM() LIMIT 8`
    ).bind(auth.sub).all<any>()).results || [];
    for (const m of more) { if (candRows.length >= 3) break; if (!have.has(m.user_id)) { have.add(m.user_id); candRows.push(m); } }
  }

  // 一次撈齊所有要顯示的卡
  const idSet = new Set<string>();
  const parseIds = (s: string) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; } };
  for (const r of [...topRows, ...candRows]) parseIds(r.ship_card_ids).forEach((id: string) => idSet.add(id));
  const allIds = [...idSet];
  const cardMap: Record<string, any> = {};
  if (allIds.length) {
    const ph = allIds.map(() => '?').join(',');
    const cardRows = (await DB.prepare(
      `SELECT id, name, type, rarity, hp, atk, def, mob, photo_r2_key FROM arena_cards WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...allIds).all<any>()).results || [];
    for (const c of cardRows) cardMap[c.id] = {
      name: c.name, type: c.type, rarity: c.rarity, hp: c.hp, atk: c.atk, def: c.def, mob: c.mob,
      photo: c.photo_r2_key ? `/api/screenshot/${c.photo_r2_key}` : null,
    };
  }
  const fleetOf = (s: string) => parseIds(s).map((id: string) => cardMap[id]).filter(Boolean);

  const top = topRows.map((r: any, i: number) => ({
    rank: i + 1, user_id: r.user_id, name: r.display_name || '玩家', rank_score: r.rank_score,
    wins: r.wins, losses: r.losses, me: r.user_id === auth.sub,
    fleet: fleetOf(r.ship_card_ids).map((c: any) => ({ name: c.name, type: c.type, rarity: c.rarity, photo: c.photo })),
  }));
  const candidates = candRows.map((r: any) => ({
    user_id: r.user_id, name: r.display_name || '玩家', rank_score: r.rank_score, wins: r.wins, losses: r.losses,
    base_hp: r.ship_base_hp || 800, fleet: fleetOf(r.ship_card_ids),
  }));

  return new Response(JSON.stringify({
    ok: true,
    me: { rank: hasFleet ? myRank : null, rank_score: myScore, wins: meRow?.wins || 0, losses: meRow?.losses || 0, has_fleet: hasFleet },
    top, candidates,
  }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
};
