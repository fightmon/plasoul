/**
 * 創鬥卡 · 天梯階共用定義（M1 骨架）
 * 與 functions/api/card/battle.ts 的 TIERS / TIER_MIN 對齊；抽出共用避免兩處漂移。
 * TODO(M2): battle.ts 與 ladder.ts 改 import 此檔，移除各自的本地副本。
 */
export const TIERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'] as const;
export const TIER_MIN = [0, 200, 400, 700, 1000, 1300, 1600, 2000];

export function tierIdx(score: number): number {
  let i = 0;
  for (let k = 0; k < TIER_MIN.length; k++) if (score >= TIER_MIN[k]) i = k;
  return i;
}

/**
 * 資訊霧分階（策略藍圖 v2 §2.2）— M2 才接線，這裡先定義規則常數。
 * 鐵則：只能靠階級換，不可付費購買。
 */
export type FogLevel = 'open' | 'hidden_fleet' | 'hidden_type';
export function fogLevel(idx: number): FogLevel {
  // C 階以下(idx<=3=C)：選敵前看得到對方牌組
  // B~A 階(idx 4~5)：看不到牌組，進場仍看得到天性
  // S 以上(idx>=6)：連天性都看不到
  if (idx <= 3) return 'open';
  if (idx <= 5) return 'hidden_fleet';
  return 'hidden_type';
}
