/**
 * 調整會員創鬥卡進度（admin）：天梯分/牌位最高/零件/金幣/勝負/戰艦
 * POST /api/admin/users/arena-update
 * body: { id, rank_score?, best_rank?, parts?, coins?, wins?, losses?, ship_slots?, ship_base_hp? }
 * 只更新有帶的欄位；數值會 clamp 為 >=0 整數。若無 arena_players 列則先建立。
 */
import { requireAdmin } from '../../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const FIELDS = ['rank_score', 'best_rank', 'parts', 'coins', 'wins', 'losses', 'ship_slots', 'ship_base_hp'];

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  let body: any; try { body = await context.request.json(); } catch { return bad('格式錯誤'); }
  const id = String(body?.id || '').trim();
  if (!id) return bad('缺少會員 id');

  const target = await context.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first<any>();
  if (!target) return bad('找不到該會員', 404);

  const sets: string[] = [], binds: any[] = [];
  for (const f of FIELDS) {
    if (f in body) {
      const v = body[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${f} 不是數字`);
      sets.push(`${f} = ?`); binds.push(Math.max(0, Math.round(v)));
    }
  }
  if (!sets.length) return bad('沒有要更新的欄位');

  const now = Date.now();
  // 確保有列
  await context.env.DB.prepare(
    `INSERT INTO arena_players (user_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING`
  ).bind(id, now, now).run();

  sets.push('updated_at = ?'); binds.push(now); binds.push(id);
  await context.env.DB.prepare(`UPDATE arena_players SET ${sets.join(', ')} WHERE user_id = ?`).bind(...binds).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
