/**
 * 創鬥卡 · M2 · 灌幽靈池（把玩家當前防守牌組凍結進 arena_ghosts）
 * POST /api/card/ghost/refresh
 * → { ok, ghost_id, tier_idx, cards }  |  { ok:false, code, message }
 *
 * 觸發時機（決策案 1：玩家驅動重灌）：
 *   - 玩家改牌組（存編成）後呼叫 → 防守快照立刻反映最新牌組。
 *   - 打完一場後呼叫 → 順手把 rank_score/tier 變動反映進快照。
 * 免 CF Cron：快照新鮮度綁玩家活躍度，不上線就停在離開前最後一版（合理）。
 *
 * 公平：快照只複製當前正規化四圍，無任何付費加成（見 _lib/arena-ghost.ts）。
 */
import { requireUser } from '../../../_lib/auth';
import { buildGhostSnapshot } from '../../../_lib/arena-ghost';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const hdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const snap = await buildGhostSnapshot(context.env.DB, auth.sub, Date.now());
  if (!snap) {
    return new Response(
      JSON.stringify({ ok: false, code: 'NO_FLEET', message: '先去編成把卡放上戰艦，才能建立防守幽靈' }),
      { status: 400, headers: hdr },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, ghost_id: snap.ghostId, tier_idx: snap.tierIdx, cards: snap.cardCount }),
    { status: 200, headers: hdr },
  );
};
