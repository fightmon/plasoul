/**
 * 創鬥卡 · M2 · 從幽靈池抓對手候選（async 天梯配對 + 資訊霧）
 * GET /api/card/ghost/match
 * → { ok, me:{rank_score,tier_idx,tier}, fog, candidates:[...] }
 *
 * 配對規則（決策 4：打 arena_ghosts 凍結快照，非對手即時牌組）：
 *   同戰力（鐵則）= tier_idx 相同；同段內依分數接近度排序 + 隨機抽。
 *   優先序：①好友幽靈（async 相遇）②同國/同城（區域偏好，非硬隔間）③全球同段。
 *   不足 LIMIT 時回退鄰段（±1）避免空城（台灣盤小，硬切會撈不到人）。
 *
 * 資訊霧（決策 1，fogLevel(myTier)；鐵則：只能靠階級換、不可付費買）：
 *   open        (C↓ idx≤3)：選敵前回傳對方 fleet（含天性/數值，可挑有利）。
 *   hidden_fleet(B–A 4~5) ：選敵看不到牌組（fleet=null）；進場仍看天性 → 屬 battle/前端（M3）。
 *   hidden_type (S↑ ≥6)   ：選敵亦看不到牌組；連天性都藏 → 戰鬥畫面也不顯示，屬 M3。
 *   ⇒ 在「選敵」這層，open 給 fleet，其餘一律 fleet=null；hidden_fleet 與 hidden_type 的差別在戰鬥畫面。
 */
import { requireUser } from '../../../_lib/auth';
import { tierIdx, fogLevel, TIERS, type FogLevel } from '../../../_lib/arena-tier';
import { parseGhostCards, type GhostCard } from '../../../_lib/arena-ghost';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const hdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const LIMIT = 3;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;
  const DB = context.env.DB;
  const me = auth.sub;

  const meRow = await DB.prepare(
    `SELECT rank_score, region_country, region_opt_in FROM arena_players WHERE user_id = ?`,
  ).bind(me).first<any>();
  const myScore = meRow?.rank_score || 0;
  const myTier = tierIdx(myScore);
  const fog = fogLevel(myTier);
  const myCountry = meRow?.region_opt_in ? (meRow?.region_country ?? null) : null;

  const picked = new Map<string, any>();           // user_id → ghost row（一人一隻 active）
  const addRows = (rows: any[]) => {
    for (const r of rows) {
      if (picked.size >= LIMIT) break;
      if (r.user_id === me) continue;              // 不打自己
      if (!picked.has(r.user_id)) picked.set(r.user_id, r);
    }
  };

  const SELECT =
    `SELECT g.id, g.user_id, g.display_name, g.cards_json, g.ship_base_hp,
            g.rank_score, g.tier_idx, g.region_country
     FROM arena_ghosts g`;

  // ① 好友優先（同段在池幽靈 → 製造 async 相遇）
  addRows((await DB.prepare(
    `${SELECT}
     JOIN arena_friends f ON f.friend_id = g.user_id AND f.user_id = ?
     WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ?
     ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`,
  ).bind(me, me, myTier, myScore, LIMIT).all<any>()).results || []);
  const friendIds = new Set(picked.keys());        // 此刻 picked 內全是好友

  // ② 區域偏好（同國同段；偏好非硬隔間，僅在我 opt-in 且有國別時生效）
  if (picked.size < LIMIT && myCountry) {
    addRows((await DB.prepare(
      `${SELECT}
       WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ? AND g.region_country = ?
       ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`,
    ).bind(me, myTier, myCountry, myScore, LIMIT).all<any>()).results || []);
  }

  // ③ 全球同段
  if (picked.size < LIMIT) {
    addRows((await DB.prepare(
      `${SELECT}
       WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ?
       ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`,
    ).bind(me, myTier, myScore, LIMIT).all<any>()).results || []);
  }

  // ④ 回退鄰段 ±1（避免空城；同戰力鐵則的最小讓步，仍貼著同段）
  if (picked.size < LIMIT) {
    addRows((await DB.prepare(
      `${SELECT}
       WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx BETWEEN ? AND ?
       ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`,
    ).bind(me, myTier - 1, myTier + 1, myScore, LIMIT + 3).all<any>()).results || []);
  }

  const candidates = [...picked.values()]
    .slice(0, LIMIT)
    .map((g) => projectFog(g, fog, friendIds.has(g.user_id)));

  return new Response(JSON.stringify({
    ok: true,
    me: { rank_score: myScore, tier_idx: myTier, tier: TIERS[myTier] },
    fog,
    candidates,
  }), { status: 200, headers: hdr });
};

/** 依資訊霧階級投影候選可見欄位。open 給 fleet；其餘 fleet=null（差別在戰鬥畫面，M3）。 */
function projectFog(g: any, fog: FogLevel, isFriend: boolean) {
  const cards: GhostCard[] = parseGhostCards(g.cards_json);
  const base = {
    ghost_id: g.id,
    user_id: g.user_id,
    name: g.display_name || '謎之對手',
    rank_score: g.rank_score,
    tier_idx: g.tier_idx,
    base_hp: g.ship_base_hp || 800,
    card_count: cards.length,
    is_friend: isFriend,
  };
  if (fog === 'open') {
    return {
      ...base,
      fleet: cards.map((c) => ({
        name: c.name, type: c.type, rarity: c.rarity,
        hp: c.hp, atk: c.atk, def: c.def, mob: c.mob,
        photo: c.photo_r2_key ? `/api/screenshot/${c.photo_r2_key}` : null,
      })),
    };
  }
  return { ...base, fleet: null };
}
