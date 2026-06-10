/**
 * 創鬥卡 · 幽靈池離線驗證 harness（M2）
 *
 * 目的：在「不碰線上 D1」前提下，用 Node 內建 node:sqlite 套真實 migration（0010/0012/0013/0014），
 *       塞假資料，跑 ghost/refresh、ghost/match、battle 的「實際 SQL」與資訊霧投影邏輯，驗證：
 *         - 0014 schema DDL 可套用、索引/約束合法
 *         - buildGhostSnapshot 的退役舊+插新+回寫指標（單一玩家只剩一隻 active 幽靈）
 *         - match 配對優先序：好友 > 區域 > 全球 > 鄰段回退；同戰力(tier_idx) 鐵則
 *         - 資訊霧分階：open 給 fleet / hidden_* 藏 fleet
 *         - battle 以 ghost_id 載入凍結快照
 *
 * 跑法：node --experimental-sqlite scripts/sim-ghost-pool.mjs
 * 注意：這是離線單元驗證，非整合測試；整合（arena.astro 串接）屬 M3，由大毛用 wrangler 本地跑。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = (f) => readFileSync(join(ROOT, 'migrations', f), 'utf8');

// ---- 與 functions/_lib/arena-tier.ts 同步（鏡像，用來交叉驗證邊界）----
const TIER_MIN = [0, 200, 400, 700, 1000, 1300, 1600, 2000];
const TIERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];
function tierIdx(s) { let i = 0; for (let k = 0; k < TIER_MIN.length; k++) if (s >= TIER_MIN[k]) i = k; return i; }
function fogLevel(idx) { if (idx <= 3) return 'open'; if (idx <= 5) return 'hidden_fleet'; return 'hidden_type'; }

// ---- 測試結果累計 ----
let pass = 0, fail = 0, seq = 0;
function ok(cond, msg) { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } }

// ---- 建庫 + 套 schema ----
const db = new DatabaseSync(':memory:');
// users 是 arena 各表 FK 的 parent，先建最小版（線上由 0001 建）
db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);`);
for (const f of ['0010_arena.sql', '0012_arena_best_rank.sql', '0013_arena_card_custom.sql', '0014_arena_ghost_pool.sql']) {
  try { db.exec(mig(f)); console.log(`applied ${f}`); }
  catch (e) { console.log(`✗ 套用 ${f} 失敗: ${e.message}`); process.exit(1); }
}

// ---- 假資料 ----
const NOW = 1000000;
function addUser(id, name) { db.prepare(`INSERT INTO users (id, display_name) VALUES (?, ?)`).run(id, name); }
function addPlayer(id, score, country, optIn, ids) {
  db.prepare(
    `INSERT INTO arena_players (user_id, parts, coins, rank_score, ship_slots, ship_card_ids, ship_base_hp,
       wins, losses, is_seed, created_at, updated_at, best_rank, tier_idx, region_country, region_city,
       region_opt_in, friend_code, active_ghost_id, ghost_refreshed_at)
     VALUES (?,0,0,?,3,?,800,0,0,0,?,?,?,?,?,?,?,NULL,NULL,0)`,
  ).run(id, score, JSON.stringify(ids), NOW, NOW, score, tierIdx(score), country, country ? 'City' : null, optIn ? 1 : 0);
}
function addCard(id, userId, name, type, hp, atk, def, mob) {
  db.prepare(
    `INSERT INTO arena_cards (id, user_id, name, type, hp, atk, def, mob, rarity, wins, battles,
       is_support, is_seed, created_at) VALUES (?,?,?,?,?,?,?,?, 'R', 0,0,0,0,?)`,
  ).run(id, userId, name, type, hp, atk, def, mob, NOW);
}

// me（TW, opt-in, tier1）+ 一張卡
addUser('me', '大毛'); addPlayer('me', 250, 'TW', true, ['c_me1']); addCard('c_me1', 'me', '紅機', 'ranged', 200, 200, 200, 200);
// 好友（JP, tier1）— 區域不同，但好友應優先
addUser('fr', '阿福'); addPlayer('fr', 240, 'JP', true, ['c_fr1']); addCard('c_fr1', 'fr', '藍機', 'melee', 200, 200, 200, 200);
db.prepare(`INSERT INTO arena_friends (user_id, friend_id, source, created_at) VALUES ('me','fr','code',?)`).run(NOW);
// 同國非好友（TW, tier1）
addUser('tw', '小台'); addPlayer('tw', 260, 'TW', true, ['c_tw1']); addCard('c_tw1', 'tw', '綠機', 'evade', 200, 200, 200, 200);
// 全球非好友（US, tier1）
addUser('gl', '阿美'); addPlayer('gl', 230, 'US', true, ['c_gl1']); addCard('c_gl1', 'gl', '灰機', 'ranged', 200, 200, 200, 200);
// 高階 S（tier7）兩名 → 測 hidden_type
addUser('s1', '老王'); addPlayer('s1', 2100, 'TW', true, ['c_s1']); addCard('c_s1', 's1', '金機', 'ranged', 200, 200, 200, 200);
addUser('s2', '老李'); addPlayer('s2', 2050, 'TW', true, ['c_s2']); addCard('c_s2', 's2', '銀機', 'melee', 200, 200, 200, 200);

// ===== buildGhostSnapshot 的實際 SQL（鏡像 functions/_lib/arena-ghost.ts）=====
function buildSnapshot(userId, now) {
  const prow = db.prepare(
    `SELECT p.ship_card_ids, p.ship_base_hp, p.rank_score, p.region_country, p.region_city, p.region_opt_in, u.display_name
     FROM arena_players p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`,
  ).get(userId);
  if (!prow) return null;
  let ids = []; try { ids = prow.ship_card_ids ? JSON.parse(prow.ship_card_ids) : []; } catch {}
  if (!ids.length) return null;
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, name, type, hp, atk, def, mob, special_name, photo_r2_key, tone_id, moves, rarity
     FROM arena_cards WHERE user_id = ? AND id IN (${ph}) AND deleted_at IS NULL`,
  ).all(userId, ...ids);
  if (!rows.length) return null;
  const byId = {}; for (const r of rows) byId[r.id] = r;
  const cards = ids.map((id) => byId[id]).filter(Boolean).map((c) => ({
    name: c.name, type: c.type, hp: c.hp, atk: c.atk, def: c.def, mob: c.mob,
    special_name: c.special_name ?? null, photo_r2_key: c.photo_r2_key ?? null,
    tone_id: c.tone_id ?? null, moves: c.moves ?? null, rarity: c.rarity ?? 'N',
  }));
  if (!cards.length) return null;
  const score = prow.rank_score || 0, tIdx = tierIdx(score), baseHp = prow.ship_base_hp || 800;
  const optIn = !!prow.region_opt_in;
  const country = optIn ? (prow.region_country ?? null) : null;
  const city = optIn ? (prow.region_city ?? null) : null;
  const ghostId = `ghost_${userId}_${++seq}`;   // harness：單調計數器保證唯一（產品碼用 crypto.randomUUID）
  db.prepare(`UPDATE arena_ghosts SET is_active = 0 WHERE user_id = ? AND is_active = 1`).run(userId);
  db.prepare(
    `INSERT INTO arena_ghosts (id, user_id, display_name, cards_json, ship_base_hp, rank_score, tier_idx,
       region_country, region_city, source, is_active, created_at, refreshed_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'player', 1, ?, ?)`,
  ).run(ghostId, userId, prow.display_name ?? null, JSON.stringify(cards), baseHp, score, tIdx, country, city, now, now);
  db.prepare(`UPDATE arena_players SET active_ghost_id = ?, ghost_refreshed_at = ?, tier_idx = ? WHERE user_id = ?`)
    .run(ghostId, now, tIdx, userId);
  return { ghostId, tierIdx: tIdx, cardCount: cards.length };
}

// ===== ghost/match 的實際 SQL（鏡像 functions/api/card/ghost/match.ts）=====
const LIMIT = 3;
function runMatch(me) {
  const meRow = db.prepare(`SELECT rank_score, region_country, region_opt_in FROM arena_players WHERE user_id = ?`).get(me);
  const myScore = meRow?.rank_score || 0, myTier = tierIdx(myScore), fog = fogLevel(myTier);
  const myCountry = meRow?.region_opt_in ? (meRow?.region_country ?? null) : null;
  const picked = new Map();
  const addRows = (rows) => { for (const r of rows) { if (picked.size >= LIMIT) break; if (r.user_id === me) continue; if (!picked.has(r.user_id)) picked.set(r.user_id, r); } };
  const SELECT = `SELECT g.id, g.user_id, g.display_name, g.cards_json, g.ship_base_hp, g.rank_score, g.tier_idx, g.region_country FROM arena_ghosts g`;
  addRows(db.prepare(`${SELECT} JOIN arena_friends f ON f.friend_id = g.user_id AND f.user_id = ? WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ? ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`).all(me, me, myTier, myScore, LIMIT));
  const friendIds = new Set(picked.keys());
  if (picked.size < LIMIT && myCountry) addRows(db.prepare(`${SELECT} WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ? AND g.region_country = ? ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`).all(me, myTier, myCountry, myScore, LIMIT));
  if (picked.size < LIMIT) addRows(db.prepare(`${SELECT} WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx = ? ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`).all(me, myTier, myScore, LIMIT));
  if (picked.size < LIMIT) addRows(db.prepare(`${SELECT} WHERE g.is_active = 1 AND g.user_id != ? AND g.tier_idx BETWEEN ? AND ? ORDER BY ABS(g.rank_score - ?) ASC, RANDOM() LIMIT ?`).all(me, myTier - 1, myTier + 1, myScore, LIMIT + 3));
  const candidates = [...picked.values()].slice(0, LIMIT).map((g) => {
    const cards = JSON.parse(g.cards_json);
    const base = { ghost_id: g.id, user_id: g.user_id, name: g.display_name || '謎之對手', rank_score: g.rank_score, tier_idx: g.tier_idx, card_count: cards.length, is_friend: friendIds.has(g.user_id) };
    if (fog === 'open') return { ...base, fleet: cards.map((c) => ({ name: c.name, type: c.type })) };
    return { ...base, fleet: null };
  });
  return { me: { rank_score: myScore, tier_idx: myTier, tier: TIERS[myTier] }, fog, candidates };
}

// ============ 測試 ============
console.log('\n[T1] fogLevel 邊界（決策 1：C↓ open / B-A hidden_fleet / S↑ hidden_type）');
ok(fogLevel(tierIdx(0)) === 'open' && fogLevel(tierIdx(699)) === 'open', 'F~C(idx≤3) → open');
ok(fogLevel(tierIdx(1000)) === 'hidden_fleet' && fogLevel(tierIdx(1300)) === 'hidden_fleet', 'B~A(idx4~5) → hidden_fleet');
ok(fogLevel(tierIdx(1600)) === 'hidden_type' && fogLevel(tierIdx(2000)) === 'hidden_type', 'S~SS(idx≥6) → hidden_type');

console.log('\n[T2] buildGhostSnapshot：每人灌一隻 active 幽靈 + 回寫指標');
for (const u of ['me', 'fr', 'tw', 'gl', 's1', 's2']) buildSnapshot(u, NOW);
const ghostCount = db.prepare(`SELECT COUNT(*) AS n FROM arena_ghosts WHERE is_active = 1`).get().n;
ok(ghostCount === 6, `6 名玩家 → 6 隻 active 幽靈（實得 ${ghostCount}）`);
const mePlayer = db.prepare(`SELECT active_ghost_id, ghost_refreshed_at, tier_idx FROM arena_players WHERE user_id = 'me'`).get();
ok(!!mePlayer.active_ghost_id && mePlayer.ghost_refreshed_at === NOW, 'me.active_ghost_id / ghost_refreshed_at 已回寫');
ok(mePlayer.tier_idx === 1, `me.tier_idx 快取 = 1（實得 ${mePlayer.tier_idx}）`);

console.log('\n[T3] 重灌：退役舊快照，玩家僅剩一隻 active');
buildSnapshot('me', NOW + 5000);
const meActive = db.prepare(`SELECT COUNT(*) AS n FROM arena_ghosts WHERE user_id = 'me' AND is_active = 1`).get().n;
const meRetired = db.prepare(`SELECT COUNT(*) AS n FROM arena_ghosts WHERE user_id = 'me' AND is_active = 0`).get().n;
ok(meActive === 1 && meRetired === 1, `me：active 1 / retired 1（實得 ${meActive}/${meRetired}）`);

console.log('\n[T4] match(me)：好友優先 > 區域 > 全球；同戰力 tier=1；fog=open 給 fleet');
const m = runMatch('me');
ok(m.fog === 'open', `fog = open（實得 ${m.fog}）`);
ok(m.candidates.length === 3, `候選 3 名（實得 ${m.candidates.length}）`);
ok(m.candidates[0].user_id === 'fr' && m.candidates[0].is_friend === true, '第一順位 = 好友 fr（is_friend=true）');
ok(m.candidates.every((c) => c.tier_idx === 1), '全部同戰力 tier_idx=1');
ok(m.candidates.some((c) => c.user_id === 'tw'), '含同國 tw（區域偏好）');
ok(m.candidates.some((c) => c.user_id === 'gl'), '含全球 gl');
ok(!m.candidates.some((c) => c.user_id === 'me'), '不含自己');
ok(m.candidates[0].fleet && m.candidates[0].fleet.length === 1, 'open → 回傳 fleet（含天性）');

console.log('\n[T5] match(s1)：S 階 fog=hidden_type，選敵藏 fleet');
const ms = runMatch('s1');
ok(ms.fog === 'hidden_type', `fog = hidden_type（實得 ${ms.fog}）`);
ok(ms.candidates.length === 1 && ms.candidates[0].user_id === 's2', '同段唯一對手 s2');
ok(ms.candidates[0].fleet === null, 'hidden_type → fleet = null（藏牌組）');

console.log('\n[T6] battle 以 ghost_id 載入凍結快照');
const gid = db.prepare(`SELECT id FROM arena_ghosts WHERE user_id = 'fr' AND is_active = 1`).get().id;
const gr = db.prepare(`SELECT user_id, display_name, cards_json, ship_base_hp, rank_score FROM arena_ghosts WHERE id = ? AND is_active = 1`).get(gid);
const gcards = JSON.parse(gr.cards_json);
ok(gr.display_name === '阿福' && gcards.length === 1 && gcards[0].type === 'melee', 'ghost 快照可載入（fr/阿福/melee）');

// ===== admin backfill 的實際 SQL（鏡像 functions/api/admin/arena/backfill-ghosts.ts）=====
function runBackfill(force) {
  const where = force
    ? `ship_card_ids IS NOT NULL AND ship_card_ids != '[]'`
    : `ship_card_ids IS NOT NULL AND ship_card_ids != '[]' AND active_ghost_id IS NULL`;
  const rows = db.prepare(`SELECT user_id FROM arena_players WHERE ${where}`).all();
  let built = 0, skipped = 0;
  for (const r of rows) { const s = buildSnapshot(r.user_id, NOW + 9000); s ? built++ : skipped++; }
  return { total: rows.length, built, skipped };
}

console.log('\n[T7] backfill：冷啟動灌池（非 force 跳過已灌、force 整池重刷）');
db.exec(`DELETE FROM arena_ghosts; UPDATE arena_players SET active_ghost_id = NULL;`);
const bf1 = runBackfill(false);
ok(bf1.total === 6 && bf1.built === 6, `首刷：6 名全灌（實得 total=${bf1.total} built=${bf1.built}）`);
const bf2 = runBackfill(false);
ok(bf2.total === 0 && bf2.built === 0, `重跑非 force：已灌者跳過，built=0（實得 total=${bf2.total}）`);
const bf3 = runBackfill(true);
ok(bf3.total === 6 && bf3.built === 6, `force：整池重刷 6 名（實得 built=${bf3.built}）`);
const activePerUser = db.prepare(`SELECT user_id, COUNT(*) AS n FROM arena_ghosts WHERE is_active = 1 GROUP BY user_id HAVING n > 1`).all();
ok(activePerUser.length === 0, '每位玩家仍僅一隻 active 幽靈（無重複）');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
