// 創鬥卡 公平性模擬器（離線分析，不影響線上）
// 複製 functions/api/card/battle.ts 的戰鬥邏輯，跑 Monte Carlo。
// 用法：node scripts/sim-fairness.mjs
'use strict';

const STAT_BASE = 100, STAT_POOL = 400, SHIP_HP = 800;
const TYPES = ['ranged', 'melee', 'evade'];
const R = Math.random;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ri = (n) => Math.floor(R() * n);
const sum = (a, k) => a.reduce((s, c) => s + (c[k] || 0), 0);
const rnd = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));

function rps(a, b) { if (a === b) return 0; const beat = { ranged: 'melee', melee: 'evade', evade: 'ranged' }; return beat[a] === b ? 1 : -1; }

// ===== 公式版本 =====
const V1 = { dodgeDiv: 1500, dodgeCap: 0.32, critFlat: null, critDiv: 1700, critCap: 0.30, defMul: 0.5, critMul: 1.5, rpsMul: 1.5, blockDiv: 1700, blockCap: 0.30, blockMul: 0.5, reflectMul: 0.3, ultMul: 1.2, dodgeCtr: 0, atkThr: 9999, atkMul: 1 };
// v2：固定爆率(拆攻擊)、攻擊邊際遞減(atkThr 以上半價)、閃避反擊打回攻方攻擊、機動閃避更強
const V2 = { dodgeDiv: 1150, dodgeCap: 0.42, critFlat: 0.12, critDiv: 1700, critCap: 0.30, defMul: 0.4, critMul: 1.5, rpsMul: 1.4, blockDiv: 1500, blockCap: 0.33, blockMul: 0.5, reflectMul: 0.4, ultMul: 0.9, dodgeCtr: 0.5, atkThr: 250, atkMul: 0.5 };
let F = V1;

// 攻擊邊際遞減：超過門檻的部分只算 atkMul 倍（壓制無腦堆攻擊）
const effAtk = (a) => a <= F.atkThr ? a : F.atkThr + (a - F.atkThr) * F.atkMul;

// hit：回傳 {dmg, reflect}；reflect = 盾反 或 閃避反擊(打回攻方攻擊的一部分)
function hit(att, def, rpsWin) {
  if (R() < clamp(def.mob / F.dodgeDiv, 0, F.dodgeCap)) return { dmg: 0, reflect: Math.round(effAtk(att.atk) * F.dodgeCtr) };
  let d = effAtk(att.atk) - def.def * F.defMul; if (d < 5) d = 5;
  if (rpsWin) d *= F.rpsMul;
  const critP = (F.critFlat != null ? F.critFlat : clamp(att.atk / F.critDiv, 0, F.critCap)) + (att.critBonus || 0);
  if (R() < critP) d *= F.critMul;
  let reflect = 0;
  if (R() < clamp(def.def / F.blockDiv, 0, F.blockCap)) { d *= F.blockMul; reflect = Math.round(def.def * F.reflectMul); }
  return { dmg: Math.max(1, Math.round(d)), reflect };
}

// 與 battle.ts simulate() 一致；回傳攻方是否獲勝
function simulate(my, foe) {
  let myHP = SHIP_HP + sum(my, 'hp'), foeHP = SHIP_HP + sum(foe, 'hp');
  const myMax = myHP, foeMax = foeHP; let myUlt = false, foeUlt = false;
  for (let round = 1; round <= 24 && myHP > 0 && foeHP > 0; round++) {
    const a = my[ri(my.length)], b = foe[ri(foe.length)];
    const r = rps(a.type, b.type);
    if (r === 1) { const h = hit(a, b, true); foeHP -= h.dmg; myHP -= h.reflect; }
    else if (r === -1) { const h = hit(b, a, true); myHP -= h.dmg; foeHP -= h.reflect; }
    else { const ha = hit(a, b, false), hb = hit(b, a, false); foeHP -= ha.dmg + hb.reflect; myHP -= hb.dmg + ha.reflect; }
    const eatk = (fl) => fl.reduce((s, c) => s + effAtk(c.atk), 0);
    if (!myUlt && myHP > 0 && myHP <= myMax * 0.3) { myUlt = true; foeHP -= Math.round(eatk(my) * F.ultMul); }
    else if (!foeUlt && foeHP > 0 && foeHP <= foeMax * 0.3) { foeUlt = true; myHP -= Math.round(eatk(foe) * F.ultMul); }
    myHP = Math.max(0, Math.round(myHP)); foeHP = Math.max(0, Math.round(foeHP));
  }
  return myHP > foeHP;
}

// 卡片：固定總預算 800（與線上正規化一致）
function card(type, w) {
  const s = w.hp + w.atk + w.def + w.mob;
  return { type, hp: Math.round(STAT_BASE + w.hp / s * STAT_POOL), atk: Math.round(STAT_BASE + w.atk / s * STAT_POOL), def: Math.round(STAT_BASE + w.def / s * STAT_POOL), mob: Math.round(STAT_BASE + w.mob / s * STAT_POOL) };
}
const W = { bal: { hp: 3, atk: 3, def: 3, mob: 3 }, cannon: { hp: 2, atk: 10, def: 2, mob: 2 }, tank: { hp: 6, atk: 2, def: 7, mob: 2 }, speed: { hp: 2, atk: 2, def: 2, mob: 10 } };
function randCard() { const t = TYPES[ri(3)]; const w = { hp: rnd(2, 10), atk: rnd(2, 10), def: rnd(2, 10), mob: rnd(2, 10) }; return card(t, w); }
function randFleet() { return [randCard(), randCard(), randCard()]; }

// 陣容原型
const BUILDS = {
  '均衡混編': () => [card('ranged', W.bal), card('melee', W.bal), card('evade', W.bal)],
  '純射均衡': () => [card('ranged', W.bal), card('ranged', W.bal), card('ranged', W.bal)],
  '純閃均衡': () => [card('evade', W.bal), card('evade', W.bal), card('evade', W.bal)],
  '玻璃砲混編': () => [card('ranged', W.cannon), card('melee', W.cannon), card('evade', W.cannon)],
  '坦克混編': () => [card('ranged', W.tank), card('melee', W.tank), card('evade', W.tank)],
  '高機動混編': () => [card('ranged', W.speed), card('melee', W.speed), card('evade', W.speed)],
  '高機動純閃': () => [card('evade', W.speed), card('evade', W.speed), card('evade', W.speed)],
};

function winRate(mk1, mk2, n) { let w = 0; for (let i = 0; i < n; i++) if (simulate(mk1(), mk2())) w++; return w / n; }

const N = 60000;
const names = Object.keys(BUILDS);
const pad = (s, n) => String(s).padEnd(n);

function report(label, formula) {
  F = formula;
  console.log('\n========== ' + label + ' ==========');
  console.log('基準 隨機vs隨機：' + (winRate(randFleet, randFleet, 200000) * 100).toFixed(1) + '%（理想≈50）');
  console.log('-- 各陣容 vs 隨機大眾（理想 45~55）--');
  for (const a of names) {
    const wr = winRate(BUILDS[a], randFleet, N) * 100;
    const flag = (wr > 56 || wr < 44) ? '  ⚠' : '';
    console.log('  ' + pad(a, 12) + wr.toFixed(1) + '%' + flag);
  }
  console.log('-- 對戰矩陣（列攻方 % vs 欄）--');
  process.stdout.write('  ' + pad('', 12)); names.forEach((c) => process.stdout.write(pad(c.slice(0, 5), 7))); console.log();
  for (const a of names) {
    process.stdout.write('  ' + pad(a, 12));
    for (const b of names) process.stdout.write(pad((winRate(BUILDS[a], BUILDS[b], N) * 100).toFixed(0), 7));
    console.log();
  }
}
report('V1（目前線上）', V1);

// ===== 自動搜尋平衡公式 =====
const SPACE = {
  critFlat: [0.12, 0.15], critDiv: [1700], critCap: [0.30], critMul: [1.4, 1.5],
  defMul: [0.30, 0.35, 0.40], rpsMul: [1.35, 1.40, 1.45], ultMul: [0.85, 0.9, 1.0],
  atkThr: [100, 150, 200], atkMul: [0.2, 0.3, 0.4],
  dodgeDiv: [950, 1050, 1150], dodgeCap: [0.36, 0.40], dodgeCtr: [0.4, 0.5, 0.6], // 收斂手感：閃避上限≤40%、反擊≤0.6
  blockDiv: [1400, 1500], blockCap: [0.30, 0.35, 0.40], blockMul: [0.5], reflectMul: [0.3, 0.4, 0.5],
};
const rpick = (a) => a[ri(a.length)];
function sampleF() { const f = {}; for (const k in SPACE) f[k] = rpick(SPACE[k]); return f; }
function scoreF(f, n) { F = f; let s = 0; const wrs = {}; for (const a of names) { const wr = winRate(BUILDS[a], randFleet, n) * 100; wrs[a] = wr; const tol = (a === '均衡混編') ? 2 : 4; s += Math.pow(Math.max(0, Math.abs(wr - 50) - tol), 2); } return { s, wrs }; }

console.log('\n搜尋平衡公式中…（隨機抽樣 1200 組）');
let best = null;
for (let i = 0; i < 1200; i++) { const f = sampleF(); const r = scoreF(f, 4000); if (!best || r.s < best.s) best = { f, ...r }; }
report('V2*（自動搜尋最佳，高精度複驗）', best.f);
console.log('\n最佳公式參數：'); console.log(JSON.stringify(best.f));

// 鎖定採用版（手選自搜尋結果，確定性複驗）
const FINAL = { dodgeDiv: 1000, dodgeCap: 0.40, critFlat: 0.15, critDiv: 1700, critCap: 0.30, defMul: 0.30, critMul: 1.4, rpsMul: 1.40, blockDiv: 1500, blockCap: 0.35, blockMul: 0.5, reflectMul: 0.35, ultMul: 0.9, dodgeCtr: 0.6, atkThr: 150, atkMul: 0.30 };
report('FINAL（採用版，固定）', FINAL);

// ===== 5) 道具/欄位 影響量化（FINAL 公式，50% = 無優勢）=====
F = FINAL;
const mixed3 = () => [card('ranged', W.bal), card('melee', W.bal), card('evade', W.bal)];
function equip(mods) {
  return () => {
    const ts = ['ranged', 'melee', 'evade']; const n = mods.slots || 3; const fl = [];
    for (let i = 0; i < n; i++) { const c = card(ts[i % 3], W.bal); if (mods.atkAdd) c.atk += mods.atkAdd; if (mods.critBonus) c.critBonus = mods.critBonus; fl.push(c); }
    if (mods.rareAtkOne) fl[0].atk += mods.rareAtkOne;
    return fl;
  };
}
const N5 = 120000;
console.log('\n========== 5) 道具/欄位影響（我方裝備 vs 對方素裝均衡，50%=無優勢）==========');
const items = [
  ['素裝 vs 素裝（基準）', mixed3],
  ['全卡 攻+10', equip({ atkAdd: 10 })],
  ['全卡 攻+30', equip({ atkAdd: 30 })],
  ['全卡 爆率+10%', equip({ critBonus: 0.10 })],
  ['全卡 攻+10 且 爆+10%', equip({ atkAdd: 10, critBonus: 0.10 })],
  ['單張好寶 攻+40', equip({ rareAtkOne: 40 })],
  ['＋1 欄位（4 卡）', equip({ slots: 4 })],
  ['＋2 欄位（5 卡）', equip({ slots: 5 })],
];
for (const [lab, mk] of items) console.log('  ' + pad(lab, 22) + (winRate(mk, mixed3, N5) * 100).toFixed(1) + '%');
console.log('\n-- 你的問題：單張好寶(3格) vs 4格素裝 --');
console.log('  ' + pad('好寶攻+40(3格) vs 4格', 22) + (winRate(equip({ rareAtkOne: 40 }), equip({ slots: 4 }), N5) * 100).toFixed(1) + '%');
console.log('  ' + pad('好寶攻+80(3格) vs 4格', 22) + (winRate(equip({ rareAtkOne: 80 }), equip({ slots: 4 }), N5) * 100).toFixed(1) + '%');
console.log('  ' + pad('3格素 vs 4格素', 22) + (winRate(mixed3, equip({ slots: 4 }), N5) * 100).toFixed(1) + '%');
console.log('  ' + pad('4格素 vs 5格素', 22) + (winRate(equip({ slots: 4 }), equip({ slots: 5 }), N5) * 100).toFixed(1) + '%');

// ===== 6) 母艦道具欄：塞滿中等道具的疊加差距（每欄=一個道具，輪流 攻+10%/爆+12%/HP+12%）=====
function loadout(k) {
  return () => {
    let hpM = 1, atkM = 1, critA = 0;
    for (let i = 0; i < k; i++) { const t = i % 3; if (t === 0) atkM += 0.10; else if (t === 1) critA += 0.12; else hpM += 0.12; }
    return mixed3().map((c) => ({ ...c, hp: Math.round(c.hp * hpM), atk: Math.round(c.atk * atkM), critBonus: critA }));
  };
}
console.log('\n========== 6) 母艦道具欄疊加（每欄=中等道具，vs 素裝，50%=無優勢）==========');
for (const k of [1, 2, 3, 5]) console.log('  ' + pad(`裝 ${k} 個道具`, 22) + (winRate(loadout(k), mixed3, N5) * 100).toFixed(1) + '%');
console.log('  ' + pad('5道具 vs 3道具', 22) + (winRate(loadout(5), loadout(3), N5) * 100).toFixed(1) + '%');
console.log('  ' + pad('好寶3道具 vs 普通5道具', 22) + (winRate(loadout(3), loadout(5), N5) * 100).toFixed(1) + '%（換個角度：道具少但…還是看數量）');

// === 4) 天梯爬升模擬：玩家固定 build，攻打靜態種子（種子分數不動）===
console.log('\n=== 4) 天梯爬升（攻方限定 Elo，種子靜態）===');
const TIER_MIN = [0, 200, 400, 700, 1000, 1300, 1600, 2000], TIER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];
const tierOf = (s) => { let i = 0; for (let k = 0; k < TIER_MIN.length; k++) if (s >= TIER_MIN[k]) i = k; return TIER[i]; };
function makeSeeds() { const arr = []; for (let i = 0; i < 24; i++) arr.push({ fleet: randFleet(), score: Math.round(50 + i / 23 * 1250) }); return arr; }
function climb(buildMk, battles) {
  const seeds = makeSeeds(); let score = 0, wins = 0, played = 0;
  for (let t = 0; t < battles; t++) {
    const pool = seeds.filter((s) => s.score >= score - 40);
    if (!pool.length) break;
    const pick = pool[ri(pool.length)];   // 玩家無資訊 → 隨機選對手
    const win = simulate(buildMk(), pick.fleet); played++;
    if (win) wins++;
    const exp = 1 / (1 + Math.pow(10, (pick.score - score) / 400));
    score = Math.max(0, score + Math.round(32 * ((win ? 1 : 0) - exp)));
  }
  return { score, tier: tierOf(score), wr: played ? (wins / played * 100) : 0, played };
}
for (const a of ['均衡混編', '玻璃砲混編', '高機動純閃']) {
  let fin = 0, twr = 0; const runs = 200;
  for (let r = 0; r < runs; r++) { const c = climb(BUILDS[a], 300); fin += c.score; twr += c.wr; }
  const avg = Math.round(fin / runs);
  console.log(pad(a, 12) + '300 場後 平均天梯分 ' + avg + '（' + tierOf(avg) + '牌位） · 勝率 ' + (twr / runs).toFixed(1) + '%');
}
console.log('\n（種子最高分 ~1300=A 底；玩家被矩陣天花板卡在「種子最高分+40」附近）');
