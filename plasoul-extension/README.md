# 普拉魂擷取 Chrome Extension v0.1

> 在 FB 鋼彈交易貼文點 icon 一下，自動帶到 plasoul.com/admin/listings 預填表單

## 安裝（5 分鐘，第一次設定）

### Step 1: 產 icon

打開 `icons/generate-icon.html`（雙擊或拖進 Chrome）→ 按「📥 下載 icon-128.png」→ 把產出的 PNG 放到 `icons/icon-128.png`（覆蓋同層）。

### Step 2: 載入 Chrome

1. Chrome 開 `chrome://extensions/`
2. 右上角開「開發人員模式」
3. 點「載入未封裝項目」
4. 選這個 `plasoul-extension/` 資料夾
5. 工具列出現 🤖 icon

### Step 3: 用

1. 在 FB 鋼彈交易社團點開一篇貼文
2. 點工具列「🤖 普拉魂擷取」
3. Popup 顯示抓到的文字 + URL + 社團名
4. 按「送到普拉魂後台」
5. 自動開新 tab `plasoul.com/admin/listings`，表單已預填
6. 點「AI 解析」→ 多選保存

## 抓不到文字怎麼辦？

FB 的 DOM 結構複雜且常變。如果 popup 顯示「沒抓到貼文文字」：

1. 切回 FB tab
2. 用滑鼠**手動選取**整篇貼文
3. 切回 popup
4. 按右下角「重抓」

它會優先用你選取的範圍（最準確）。

## 升級

之後 v0.2 會加：
- 截圖功能（chrome.tabs.captureVisibleTab）
- 截圖自動打碼（face detection）
- 背景 POST（不用切 tab）

## 開發

純 Manifest V3，無 build step。改完直接到 `chrome://extensions/` 按 reload 按鈕。
