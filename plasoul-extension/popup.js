/**
 * 普拉魂擷取 · popup.js
 *
 * 流程：
 *   1. 取 active tab，確認在 facebook.com
 *   2. inject extractFbPost() 到 tab，抓 URL/group/text
 *   3. 填到 popup form
 *   4. 用戶按「送到普拉魂後台」→ 開新 tab plasoul.com/admin/listings#hash
 */

const PLASOUL_URL = 'https://plasoul.com/admin/listings';

// === Helpers ===

const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = '') => {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * 注入到 FB 頁面跑的函式（在 page context 內，能存 document/window）
 * 注意：不能用 popup 的變數，必須 self-contained
 */
function extractFbPostInPage() {
  // 1. URL（盡量轉成 canonical permalink）
  let url = window.location.href;

  // 2. 社團 / page 名稱（從 title「(N) 社團名 | Facebook」）
  let groupName = (document.title || '').trim();
  groupName = groupName
    .replace(/^\s*\(\d+\)\s*/, '') // 去掉開頭未讀數 "(2) "
    .replace(/\s*[|｜]\s*Facebook\s*$/i, '')
    .trim();

  // 3. 貼文文字
  let postText = '';

  // 3a. 優先：使用者目前 selected text（最準）
  const selection = window.getSelection ? window.getSelection().toString() : '';
  if (selection && selection.trim().length >= 30) {
    postText = selection.trim();
    return { url, groupName, postText, source: 'selection' };
  }

  // 3b. 從新版 FB DOM 抓（多 selector fallback）
  const selectors = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
    'div[dir="auto"][style*="text-align: start"]',
  ];

  let storyEl = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 30) {
      storyEl = el;
      break;
    }
  }

  if (storyEl) {
    // 嘗試展開「查看更多」（FB 把長文摺起來）
    const seeMore = storyEl.querySelector('div[role="button"]');
    if (seeMore && /查看更多|See more|展開/.test(seeMore.innerText)) {
      try { seeMore.click(); } catch {}
    }
    postText = storyEl.innerText.trim();
  } else {
    // 3c. fallback：抓 article 整段
    const article = document.querySelector('[role="article"]');
    if (article) {
      postText = article.innerText.trim();
    }
  }

  // Clean：去掉常見的 FB UI noise
  postText = postText
    .replace(/查看更多$/gm, '')
    .replace(/See more$/gm, '')
    .replace(/^讚\s*$|^Like\s*$/gm, '')
    .replace(/^留言\s*$|^Comment\s*$/gm, '')
    .replace(/^分享\s*$|^Share\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { url, groupName, postText, source: storyEl ? 'dom' : 'fallback' };
}

// === Init ===

async function init() {
  const tab = await getActiveTab();

  if (!tab || !tab.url || !/^https:\/\/(www|m)\.facebook\.com/.test(tab.url)) {
    setStatus('⚠️ 請在 Facebook 頁面使用', 'err');
    $('send-btn').disabled = true;
    $('reselect-btn').disabled = true;
    return;
  }

  await runExtract(tab.id);
}

async function runExtract(tabId) {
  setStatus('🔍 抓取中…');
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractFbPostInPage,
    });

    const data = result?.result;
    if (!data) {
      setStatus('❌ 抓取失敗', 'err');
      return;
    }

    $('url').value = data.url || '';
    $('group').value = data.groupName || '';
    $('text').value = data.postText || '';

    if (!data.postText || data.postText.length < 30) {
      setStatus('⚠️ 沒抓到貼文文字（試手動選取後按「重抓」）', 'err');
      $('send-btn').disabled = true;
    } else {
      const label =
        data.source === 'selection'
          ? `✅ 抓到 ${data.postText.length} 字（從你選取的範圍）`
          : `✅ 抓到 ${data.postText.length} 字`;
      setStatus(label, 'ok');
      $('send-btn').disabled = false;
    }
  } catch (e) {
    setStatus('❌ 抓取錯誤：' + (e?.message || e), 'err');
  }
}

// === Buttons ===

$('reselect-btn').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (tab && /facebook\.com/.test(tab.url)) {
    await runExtract(tab.id);
  }
});

$('text').addEventListener('input', () => {
  const len = $('text').value.trim().length;
  $('send-btn').disabled = len < 10;
});

$('send-btn').addEventListener('click', async () => {
  const text = $('text').value.trim();
  const url = $('url').value.trim();
  const group = $('group').value.trim();

  if (!text) {
    setStatus('❌ 文字為空', 'err');
    return;
  }

  // 用 URL hash 帶過去（避開 query string log + 大小限制）
  const params = new URLSearchParams();
  params.set('text', text);
  if (url) params.set('url', url);
  if (group) params.set('group', group);
  const targetUrl = PLASOUL_URL + '#' + params.toString();

  await chrome.tabs.create({ url: targetUrl });
  window.close();
});

// Run
init();
