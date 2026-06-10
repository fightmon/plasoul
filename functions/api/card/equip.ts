/**
 * 創鬥卡 · 編成（把卡放上戰艦）
 * POST /api/card/equip  Body: { card_ids: string[] }（最多 3，MVP 固定 3 格）
 * MVP：1 艘戰艦，出戰即防守（幽靈）。
 */
import { requireUser } from '../../_lib/auth';
import { buildGhostSnapshot } from '../../_lib/arena-ghost';

export interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any;
  try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const ids: string[] = Array.isArray(body?.card_ids) ? body.card_ids.filter((x: any) => typeof x === 'string' && x).slice(0, 3) : [];

  // 驗證都是本人的卡
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const owned = (await context.env.DB.prepare(
      `SELECT id FROM arena_cards WHERE user_id = ? AND deleted_at IS NULL AND id IN (${ph})`
    ).bind(auth.sub, ...ids).all<{ id: string }>()).results || [];
    const set = new Set(owned.map((o) => o.id));
    if (ids.some((id) => !set.has(id))) return bad('卡片不存在或非本人');
  }

  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO arena_players (user_id, ship_card_ids, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ship_card_ids = excluded.ship_card_ids, updated_at = excluded.updated_at`
  ).bind(auth.sub, JSON.stringify(ids), now, now).run();

  // 編成改動後立即重凍防守幽靈快照（決策案1：玩家驅動重灌）；失敗不擋存檔。
  try { await buildGhostSnapshot(context.env.DB, auth.sub, now); } catch {}

  return new Response(JSON.stringify({ ok: true, ship_card_ids: ids }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};

function bad(message: string): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
