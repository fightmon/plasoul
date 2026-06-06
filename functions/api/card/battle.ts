/**
 * 創鬥卡 · 出擊戰鬥（伺服器端模擬，防作弊）
 * POST /api/card/battle
 * → { ok, win, log:[結構化回合], my:{maxHP}, foe:{name,maxHP}, rewards }
 *
 * log 每回合（給前端畫「卡片對撞」動畫）：
 *  { round, intro?, my:{name,type,photo}, foe:{name,type}, rps:1/-1/0,
 *    toFoe:{dmg,crit,block,dodge}|null, toMe:{...}|null, ult:{side,name,dmg}|null, myHP, foeHP }
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const STAT_BASE = 100, STAT_POOL = 400, SHIP_HP = 800;
const TYPES = ['ranged', 'melee', 'evade'] as const;
const GHOST_TEAMS = ['流浪傭兵隊', '吉翁殘黨', '宇宙海盜團', '聯邦巡邏隊', '量產軍團', '謎之精英', '深紅騎士團', '廢墟拾荒者'];
const GHOST_UNITS = ['赤紅突擊', '蒼藍守衛', '疾風斥候', '重砲要塞', '幽冥刺客', '雷光衝鋒', '鋼鐵壁壘', '暗影游擊', '烈焰先鋒', '寒霜哨兵'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  const p = await context.env.DB.prepare(
    `SELECT ship_card_ids, ship_base_hp, rank_score FROM arena_players WHERE user_id = ?`
  ).bind(auth.sub).first<any>();
  let ids: string[] = [];
  try { ids = p?.ship_card_ids ? JSON.parse(p.ship_card_ids) : []; } catch {}
  if (!ids.length) return new Response(JSON.stringify({ ok: false, message: '先去編成把卡放上戰艦' }), { status: 400, headers: hdr() });

  const ph = ids.map(() => '?').join(',');
  const rows = (await context.env.DB.prepare(
    `SELECT id, name, type, hp, atk, def, mob, special_name, photo_r2_key FROM arena_cards WHERE user_id = ? AND id IN (${ph}) AND deleted_at IS NULL`
  ).bind(auth.sub, ...ids).all<any>()).results || [];
  if (!rows.length) return new Response(JSON.stringify({ ok: false, message: '出戰卡不存在' }), { status: 400, headers: hdr() });
  const myTeam = rows.map((c) => ({ ...c, photo: c.photo_r2_key ? `/api/screenshot/${c.photo_r2_key}` : null }));

  // 對手：天梯指定的真人防守艦隊；否則隨機幽靈
  let body: any = {}; try { body = await context.request.json(); } catch {}
  const opponentId = typeof body?.opponent_id === 'string' ? body.opponent_id : null;
  let foeName = pick(GHOST_TEAMS), foeBase = SHIP_HP, foeScore = p?.rank_score || 0;
  let foeTeam: any[] = [];
  if (opponentId && opponentId !== auth.sub) {
    const op = await context.env.DB.prepare(
      `SELECT p.ship_card_ids, p.ship_base_hp, p.rank_score, u.display_name
       FROM arena_players p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`
    ).bind(opponentId).first<any>();
    let oids: string[] = []; try { oids = op?.ship_card_ids ? JSON.parse(op.ship_card_ids) : []; } catch {}
    if (op && oids.length) {
      const oph = oids.map(() => '?').join(',');
      const orows = (await context.env.DB.prepare(
        `SELECT name, type, hp, atk, def, mob, special_name, photo_r2_key FROM arena_cards WHERE user_id = ? AND id IN (${oph}) AND deleted_at IS NULL`
      ).bind(opponentId, ...oids).all<any>()).results || [];
      if (orows.length) {
        foeTeam = orows.map((c) => ({ ...c, photo: c.photo_r2_key ? `/api/screenshot/${c.photo_r2_key}` : null }));
        foeName = op.display_name || '謎之對手';
        foeBase = op.ship_base_hp || SHIP_HP;
        foeScore = op.rank_score || 0;
      }
    }
  }
  if (!foeTeam.length) foeTeam = Array.from({ length: 3 }, () => genGhost());

  const sim = simulate(myTeam, p?.ship_base_hp || SHIP_HP, foeTeam, foeBase, foeName);

  // Elo 式計分（只動攻方；打強者賺多、打弱者賺少 → 天然追趕、防洗分）
  const now = Date.now();
  const myScore = p?.rank_score || 0;
  const expected = 1 / (1 + Math.pow(10, (foeScore - myScore) / 400));
  const rankDelta = Math.round(32 * ((sim.win ? 1 : 0) - expected));
  const newRank = Math.max(0, myScore + rankDelta);
  let parts = 0, coins = 0;
  if (sim.win) { parts = 10; coins = 60; } else { parts = 3; coins = 10; }
  await context.env.DB.prepare(
    `UPDATE arena_players SET parts = parts + ?, coins = coins + ?, rank_score = ?, wins = wins + ?, losses = losses + ?, updated_at = ? WHERE user_id = ?`
  ).bind(parts, coins, newRank, sim.win ? 1 : 0, sim.win ? 0 : 1, now, auth.sub).run();
  await context.env.DB.prepare(
    `UPDATE arena_cards SET battles = battles + 1, wins = wins + ? WHERE user_id = ? AND id IN (${ph})`
  ).bind(sim.win ? 1 : 0, auth.sub, ...ids).run();

  return new Response(JSON.stringify({
    ok: true, win: sim.win, log: sim.log,
    my: { maxHP: sim.myMax, team: myTeam.map((c) => ({ name: c.name, type: c.type, photo: c.photo })) },
    foe: { name: foeName, maxHP: sim.foeMax, team: foeTeam.map((c) => ({ name: c.name, type: c.type, photo: c.photo || null })) },
    rewards: { parts, coins, rank_delta: rankDelta, rank_score: newRank },
  }), { status: 200, headers: hdr() });
};

function simulate(my: any[], myBase: number, foe: any[], foeBase: number, foeName: string) {
  let myHP = myBase + sum(my, 'hp');
  let foeHP = foeBase + sum(foe, 'hp');
  const myMax = myHP, foeMax = foeHP;
  let myUlt = false, foeUlt = false;
  const log: any[] = [{ round: 0, intro: true, foeName, myHP, foeHP }];

  for (let round = 1; round <= 24 && myHP > 0 && foeHP > 0; round++) {
    const ai = ri(my.length), bi = ri(foe.length); const a = my[ai], b = foe[bi];
    const r = rps(a.type, b.type);
    const ev: any = { round, myIdx: ai, foeIdx: bi, rps: r, toFoe: null, toMe: null, ult: null };

    if (r === 1) { const h = hit(a, b, true); foeHP -= h.dmg; myHP -= h.reflect; ev.toFoe = pub(h); if (h.reflect) ev.toMe = { dmg: h.reflect, crit: false, block: false, dodge: false }; }
    else if (r === -1) { const h = hit(b, a, true); myHP -= h.dmg; foeHP -= h.reflect; ev.toMe = pub(h); if (h.reflect) ev.toFoe = { dmg: h.reflect, crit: false, block: false, dodge: false }; }
    else { const ha = hit(a, b, false), hb = hit(b, a, false); foeHP -= ha.dmg + hb.reflect; myHP -= hb.dmg + ha.reflect; ev.toFoe = pub(ha); ev.toMe = pub(hb); }

    if (!myUlt && myHP > 0 && myHP <= myMax * 0.3) { myUlt = true; const d = Math.round(sum(my, 'atk') * 1.2); foeHP -= d; ev.ult = { side: 'my', name: my[0].special_name || '總攻擊', dmg: d }; }
    else if (!foeUlt && foeHP > 0 && foeHP <= foeMax * 0.3) { foeUlt = true; const d = Math.round(sum(foe, 'atk') * 1.2); myHP -= d; ev.ult = { side: 'foe', name: '總攻擊', dmg: d }; }

    myHP = Math.max(0, Math.round(myHP)); foeHP = Math.max(0, Math.round(foeHP));
    ev.myHP = myHP; ev.foeHP = foeHP;
    log.push(ev);
  }
  return { win: myHP > foeHP, log, myMax, foeMax };
}

function hit(att: any, def: any, rpsWin: boolean) {
  if (rand() < clamp(def.mob / 1500, 0, 0.32)) return { dmg: 0, reflect: 0, dodge: true, crit: false, block: false };
  let d = att.atk - def.def * 0.5; if (d < 5) d = 5;
  if (rpsWin) d *= 1.5;
  const crit = rand() < clamp(att.atk / 1700, 0, 0.30); if (crit) d *= 1.5;
  let reflect = 0; const block = rand() < clamp(def.def / 1700, 0, 0.30);
  if (block) { d *= 0.5; reflect = Math.round(def.def * 0.3); }
  return { dmg: Math.max(1, Math.round(d)), reflect, dodge: false, crit, block };
}
function pub(h: any) { return { dmg: h.dmg, crit: h.crit, block: h.block, dodge: h.dodge }; }
function rps(a: string, b: string): number { if (a === b) return 0; const beat: any = { ranged: 'melee', melee: 'evade', evade: 'ranged' }; return beat[a] === b ? 1 : -1; }
function genGhost() {
  const f: any = { hp: rnd(2, 10), atk: rnd(2, 10), def: rnd(2, 10), mob: rnd(2, 10) };
  const s = f.hp + f.atk + f.def + f.mob || 4;
  return { name: pick(GHOST_UNITS), type: TYPES[rnd(0, 2)], hp: Math.round(STAT_BASE + (f.hp / s) * STAT_POOL), atk: Math.round(STAT_BASE + (f.atk / s) * STAT_POOL), def: Math.round(STAT_BASE + (f.def / s) * STAT_POOL), mob: Math.round(STAT_BASE + (f.mob / s) * STAT_POOL), special_name: '全力一擊' };
}
function sum(arr: any[], k: string) { return arr.reduce((s, c) => s + (c[k] || 0), 0); }
function pick<T>(a: T[]): T { return a[Math.floor(rand() * a.length)]; }
function rnd(lo: number, hi: number) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function ri(n: number) { return Math.floor(rand() * n); }
function rand() { return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function hdr() { return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; }
