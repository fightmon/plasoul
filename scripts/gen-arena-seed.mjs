// 產生天梯種子玩家 SQL（冷啟動幽靈，看起來像真人）
// 用法：node scripts/gen-arena-seed.mjs > migrations/0011_arena_seed.sql
// 24 名假玩家，rank_score 鋪滿各分段；每人 3 張卡（含 mono / 混合隊）；is_seed=1。

const N = 24;
const TS = 1730000000000; // 固定時間戳（可重現）
let _s = 987654321;
function rand() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
function ri(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function pick(a) { return a[Math.floor(rand() * a.length)]; }
function esc(s) { return String(s).replace(/'/g, "''"); }

const TEAMS = ['赤焰騎士團', '蒼雷部隊', '黑曜傭兵', '銀翼小隊', '緋紅軍團', '極光戰隊', '鋼鐵獵犬', '深淵守望', '烈日先鋒', '寒星遊擊', '雷鳴艦隊', '幻影中隊', '熔岩重裝', '碧空翔鷹', '暗夜潛襲', '黃金衛士', '霜刃騎兵', '紫電特攻', '殞石旅團', '青嵐遠征', '炎獄鐵衛', '蒼穹之矛', '荒原拾荒者', '無垠艦團'];
const ADJ = ['赤紅', '蒼藍', '漆黑', '純白', '黃金', '深紫', '碧綠', '銀灰', '緋色', '靛藍', '橙焰', '霜白'];
const NOUN = ['突擊', '守衛', '斥候', '砲擊', '刺客', '衝鋒', '壁壘', '游擊', '先鋒', '哨兵', '獵手', '重裝'];
const SP = ['烈陽爆裂', '極光終焉', '雷神之鎚', '寒霜葬送', '殞星墜擊', '蒼龍咆哮', '炎獄審判', '幻影斬空', '鋼鐵咆吼', '深淵吞噬'];
const RAR = ['N', 'N', 'N', 'R', 'R', 'SR', 'SSR'];
const TYPES = ['ranged', 'melee', 'evade'];

function stats() {
  // 4 圍：每項 100 + 配額，配額總和 = 400（總戰力固定 800、公平）
  let r = [rand(), rand(), rand(), rand()]; const sum = r.reduce((a, b) => a + b, 0) || 1;
  let pool = [0, 1, 2].map((i) => Math.round(r[i] / sum * 400));
  pool[3] = 400 - pool[0] - pool[1] - pool[2];
  return pool.map((p) => 100 + p);
}

const out = [];
out.push('-- =================================================================');
out.push('-- 0011 · 天梯種子玩家（冷啟動幽靈，is_seed=1）— 由 scripts/gen-arena-seed.mjs 產生');
out.push('-- =================================================================');

for (let i = 0; i < N; i++) {
  const uid = 'seed_' + String(i).padStart(2, '0');
  const email = 'seed' + String(i).padStart(2, '0') + '@seed.plasoul';
  const name = TEAMS[i % TEAMS.length];
  // 分數鋪滿：~80 → ~1950
  const rank = Math.round(((i + 1) / (N + 1)) * 1900) + ri(-30, 30);
  const total = ri(8, 60); const winRate = 0.35 + (rank / 2600);
  const wins = Math.round(total * Math.min(0.8, winRate)); const losses = total - wins;
  // 隊伍天性：每 4 人一個 mono（射/近/閃），其餘混合
  const monoType = (i % 4 < 3) ? null : TYPES[Math.floor(i / 4) % 3];

  const cardIds = [];
  out.push(`INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('${uid}','${email}','${esc(name)}','user',${TS},${TS});`);
  for (let j = 0; j < 3; j++) {
    const cid = 'seedc_' + String(i).padStart(2, '0') + '_' + j;
    cardIds.push(cid);
    const [hp, atk, def, mob] = stats();
    const type = monoType || pick(TYPES);
    const cname = pick(ADJ) + pick(NOUN);
    const rarity = pick(RAR);
    const sp = pick(SP);
    out.push(`INSERT OR IGNORE INTO arena_cards (id,user_id,name,type,hp,atk,def,mob,special_name,rarity,wins,battles,is_seed,created_at) VALUES ('${cid}','${uid}','${esc(cname)}','${type}',${hp},${atk},${def},${mob},'${esc(sp)}','${rarity}',${ri(0, wins)},${ri(wins, total)},1,${TS});`);
  }
  out.push(`INSERT OR IGNORE INTO arena_players (user_id,parts,coins,rank_score,ship_slots,ship_card_ids,ship_base_hp,wins,losses,is_seed,created_at,updated_at) VALUES ('${uid}',0,0,${Math.max(0, rank)},3,'${JSON.stringify(cardIds)}',800,${wins},${losses},1,${TS},${TS});`);
}

process.stdout.write(out.join('\n') + '\n');
