/**
 * 普拉魂創鬥卡 · 卡片生成 Prompt（Groq Vision）
 *
 * 看玩家自己拍的鋼普拉成品照 → 生成「原創戰鬥卡」設定。
 * 法律/公平鐵則（寫進 prompt）：
 *  - 不輸出官方機體型號名 / 動畫角色名 / 官方招式名 → 一律自創外號（避版權）
 *  - focus 只給「相對偏重」，最終數值由後端正規化（固定總預算 → 公平、做工不影響）
 *  - 非機器人照片也幽默生成（範例圖/萬物梗）
 */
export const ARENA_CARD_PROMPT = `你是一個鋼普拉模型「戰鬥卡」生成器。看這張使用者自己拍的鋼普拉模型成品照，幫它生成一張**原創**戰鬥卡設定，以 JSON 回傳：
{
  "name": "原創呼號（繁體中文，4~8字，霸氣或搞笑都行）",
  "type": "ranged 或 melee 或 evade（看可見武裝：長槍/步槍/火砲/飛彈多→ranged；刀/拳/近接武器→melee；輕裝/翅膀/盾/靈巧→evade）",
  "focus": { "hp": 0, "atk": 0, "def": 0, "mob": 0 },
  "terrain": "宇宙 或 一般 或 水中 或 沙漠 或 森林 或 萬能",
  "special_name": "必殺技名（原創，從可見武裝衍生）",
  "special_desc": "必殺技一句描述（繁中，20字內，熱血或搞笑）",
  "flavor": "一句機體介紹（繁中，30字內，帥氣或幽默）"
}

規則：
1. 只看照片裡這台模型，依「看得到的外型/武裝/配色」生成。
2. ★絕對不要輸出官方機體正式名稱、動畫角色名或官方招式名（例如 RX-78、薩克、自由、阿姆羅、夏亞…一律不可）。**全部自創外號。**
3. focus 的 4 個值各填 0~10 的整數，代表這台在「血量/攻擊/防禦/機動」的**相對偏重**（厚重裝甲→def/hp 高、火力猛→atk 高、輕巧靈活→mob 高）。這只是傾向，最終數值由系統平衡，你不用算。
4. terrain 看塗裝/外型猜一個適合的戰場，猜不出填「萬能」。
5. 若照片不是機器人/模型（拍到雜物、人、寵物等），也照樣**幽默地**生成一張卡。
6. 只回傳 JSON，不要任何說明文字、不要 markdown code fence。
`;

export type ArenaType = 'ranged' | 'melee' | 'evade';

export interface ArenaGenResult {
  name: string;
  type: ArenaType;
  focus: { hp: number; atk: number; def: number; mob: number };
  terrain: string;
  special_name: string;
  special_desc: string;
  flavor: string;
}
