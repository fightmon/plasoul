/**
 * 創鬥卡 · 出擊戰鬥（伺服器端模擬，防作弊）
 * POST /api/card/battle
 * → { ok, win, log:[{round,text,myHP,foeHP}], my:{name,hp}, foe:{name,hp}, rewards:{parts,coins,rank_delta} }
 *
 * 規則（MVP，數值待模擬微調）：
 *  - 共用血池 = 戰艦基礎HP + Σ出戰卡HP
 *  - 每回合雙方各抽一張卡 → 類型相剋猜拳：射>近>閃>射
 *      猜拳勝 → 破防重擊；平手 → 數值對撞
 *  - 特效：機動→閃避(0傷)、攻擊→暴擊x1.5、防禦→盾反(減半+反彈)
 *  - 必殺：HP<30% 覺醒一次（大傷無視防禦）
 *  - 對手 = 系統幽靈（同預算 → 公平）；真人幽靈為 Phase2
 */
import { requireUser } from '../../_lib/auth';

export interface Env { DB: D1Database; JWT_SECRET: string; }

const STAT_BASE = 100, STAT_POOL = 400;
const SHIP_HP = 800;
const TYPES = ['ranged', 'melee', 'evade'] as const;
const TLABEL: any = { ranged: '射擊', melee: '近身', evade: '閃躲' };
const GHOST_TEAMS = ['流浪傭兵隊', '吉翁殘黨', '宇宙海盜團', '聯邦巡邏隊', '量產軍團', '謎之精英', '深紅騎士團', '廢墟拾荒者'];
const GHOST_UNITS = ['赤紅突擊', '蒼藍守衛', '疾風斥候', '重砲要塞', '幽冥刺客', '雷光衝鋒', '鋼鐵壁壘', '暗影游擊', '烈焰先鋒', '寒霜哨兵'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireUser(context.request, context.env.JWT_SECRET);
  if (auth instanceof Response) return auth;

  // 我方戰艦
  const p = await context.env.DB.prepare(
    `SELECT ship_card_ids, ship_base_hp, parts, coins, rank_score, wins, losses FROM arena_players WHERE user_id = ?`
  ).bind(auth.sub).first<any>();
  let ids: string[] = [];
  try { ids = p?.ship_card_ids ? JSON.parse(p.ship_card_ids) : []; } catch {}
  if (!ids.length) return new Response(JSON.stringify({ ok: false, message: '先去編成把卡放上戰艦' }), { status: 400, headers: hdr() });

  const ph = ids.map(() => '?').join(',');
  const myCards = (await context.env.DB.prepare(
    `SELECT id, name, type, hp, atk, def, mob, special_name FROM arena_cards WHERE user_id = ? AND id IN (${ph}) AND deleted_at IS NULL`
  ).bind(auth.sub, ...ids).all<any>()).results || [];
  if (!myCards.length) return new Response(JSON.stringify({ ok: false, message: '出戰卡不存在' }), { status: 400, headers: hdr() });

  // 幽靈（系統，同預算 → 公平）
  const foeName = pick(GHOST_TEAMS);
  const foeCards = Array.from({ length: 3 }, () => genGhost());

  // 模擬
  const sim = simulate(myCards, (p?.ship_base_hp || SHIP_HP), foeCards, SHIP_HP, foeName);

  // 獎勵 + 更新
  const now = Date.now();
  let parts = 0, coins = 0, rankDelta = 0;
  if (sim.win) { parts = 10; coins = 60; rankDelta = 20; }
  else { parts = 3; coins = 10; rankDelta = -8; }
  const newRank = Math.max(0, (p?.rank_score || 0) + rankDelta);
  await context.env.DB.prepare(
    `UPDATE arena_players SET parts = parts + ?, coins = coins + ?, rank_score = ?, wins = wins + ?, losses = losses + ?, updated_at = ? WHERE user_id = ?`
  ).bind(parts, coins, newRank, sim.win ? 1 : 0, sim.win ? 0 : 1, now, auth.sub).run();

  // 卡戰歷
  await context.env.DB.prepare(
    `UPDATE arena_cards SET battles = battles + 1, wins = wins + ? WHERE user_id = ? AND id IN (${ph})`
  ).bind(sim.win ? 1 : 0, auth.sub, ...ids).run();

  return new Response(JSON.stringify({
    ok: true,
    win: sim.win,
    log: sim.log,
    my: { name: '我的戰艦', maxHP: sim.myMax },
    foe: { name: foeName, maxHP: sim.foeMax },
    rewards: { parts, coins, rank_delta: rankDelta, rank_score: newRank },
  }), { status: 200, headers: hdr() });
};

// ---- 模擬 ----
function simulate(my: any[], myBase: number, foe: any[], foeBase: number, foeName: string) {
  let myHP = myBase + sum(my, 'hp');
  let foeHP = foeBase + sum(foe, 'hp');
  const myMax = myHP, foeMax = foeHP;
  let myUlt = false, foeUlt = false;
  const log: any[] = [];
  log.push({ round: 0, text: `⚔️ 對上「${foeName}」！我方 HP ${myHP}・敵方 HP ${foeHP}`, myHP, foeHP });

  for (let round = 1; round <= 24 && myHP > 0 && foeHP > 0; round++) {
    const a = pick(my), b = pick(foe);
    const r = rps(a.type, b.type);
    let text = `第${round}回：我【${a.name}·${TLABEL[a.type]}】 vs 敵【${b.name}·${TLABEL[b.type]}】`;

    if (r === 1) {
      const h = hit(a, b, true); foeHP -= h.dmg; myHP -= h.reflect;
      text += ` → ${TLABEL[a.type]}剋${TLABEL[b.type]}！破防${flag(h)}造成 ${h.dmg}`;
    } else if (r === -1) {
      const h = hit(b, a, true); myHP -= h.dmg; foeHP -= h.reflect;
      text += ` → 被${TLABEL[b.type]}剋！破防${flag(h)}受到 ${h.dmg}`;
    } else {
      const ha = hit(a, b, false), hb = hit(b, a, false);
      foeHP -= ha.dmg + hb.reflect; myHP -= hb.dmg + ha.reflect;
      text += ` → 數值對撞！我打 ${ha.dmg}${flag(ha)}、受 ${hb.dmg}${flag(hb)}`;
    }

    // 必殺覺醒
    if (!myUlt && myHP > 0 && myHP <= myMax * 0.3) { myUlt = true; const u = pick(my); const d = u.atk * 2; foeHP -= d; text += `　💥覺醒！我【${u.special_name || u.name}】爆發 ${d}！`; }
    if (!foeUlt && foeHP > 0 && foeHP <= foeMax * 0.3) { foeUlt = true; const u = pick(foe); const d = u.atk * 2; myHP -= d; text += `　💥敵覺醒爆發 ${d}！`; }

    myHP = Math.max(0, Math.round(myHP)); foeHP = Math.max(0, Math.round(foeHP));
    log.push({ round, text, myHP, foeHP });
  }

  const win = myHP > foeHP;
  log.push({ round: -1, text: win ? '🎉 勝利！' : '💧 雖敗猶榮，再來一場！', myHP, foeHP });
  return { win, log, myMax, foeMax };
}

function hit(att: any, def: any, rpsWin: boolean) {
  // 閃避（防方機動）
  if (rand() < clamp(def.mob / 1500, 0, 0.32)) return { dmg: 0, reflect: 0, dodge: true, crit: false, block: false };
  let d = att.atk - def.def * 0.5; if (d < 5) d = 5;
  if (rpsWin) d *= 1.5;
  const crit = rand() < clamp(att.atk / 1700, 0, 0.30); if (crit) d *= 1.5;
  let reflect = 0; const block = rand() < clamp(def.def / 1700, 0, 0.30);
  if (block) { d *= 0.5; reflect = Math.round(def.def * 0.3); }
  return { dmg: Math.max(1, Math.round(d)), reflect, dodge: false, crit, block };
}
function flag(h: any) { return h.dodge ? '(閃避!)' : (h.crit ? '(暴擊!)' : '') + (h.block ? '(盾反!)' : ''); }

function rps(a: string, b: string): number {
  if (a === b) return 0;
  const beat: any = { ranged: 'melee', melee: 'evade', evade: 'ranged' }; // 射>近>閃>射
  return beat[a] === b ? 1 : -1;
}
function genGhost() {
  const f = { ranged: rnd(0, 10), melee: rnd(0, 10), evade: rnd(0, 10), hp: rnd(2, 10), atk: rnd(2, 10), def: rnd(2, 10), mob: rnd(2, 10) } as any;
  const s = f.hp + f.atk + f.def + f.mob || 4;
  return {
    name: pick(GHOST_UNITS),
    type: TYPES[rnd(0, 2)],
    hp: Math.round(STAT_BASE + (f.hp / s) * STAT_POOL),
    atk: Math.round(STAT_BASE + (f.atk / s) * STAT_POOL),
    def: Math.round(STAT_BASE + (f.def / s) * STAT_POOL),
    mob: Math.round(STAT_BASE + (f.mob / s) * STAT_POOL),
    special_name: '全力一擊',
  };
}

function sum(arr: any[], k: string) { return arr.reduce((s, c) => s + (c[k] || 0), 0); }
function pick<T>(a: T[]): T { return a[Math.floor(rand() * a.length)]; }
function rnd(lo: number, hi: number) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function rand() { return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function hdr() { return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; }
