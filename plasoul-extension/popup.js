/**
 * 普拉魂擷取 · popup.js
 *
 * 流程：
 *   1. 取 active tab，確認在 facebook.com
 *   2. Stage 1: inject click「查看更多」展開長文（限定 dialog 或 viewport 內）
 *   3. 等 600ms 給 DOM 重新渲染
 *   4. Stage 2: inject extractFbPost() 抓 URL/group/text
 *   5. 按「送到普拉魂後台」→ 開新 tab plasoul.com/admin/listings#hash
 */

const PLASOUL_URL = 'https://plasoul.com/admin/listings';

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
 * Stage 1: 在 FB 頁面點所有「查看更多」展開
 * 優先在 dialog (modal) 內找；沒 dialog 就在第一個 article 內
 */
function expandSeeMoreInPage() {
  const dialog = document.querySelector('[role="dialog"]');
  const scope = dialog || document.querySelector('[role="article"]') || document.body;

  const buttons = scope.querySelectorAll('div[role="button"], span[role="button"]');
  let clicked = 0;
  buttons.forEach((b) => {
    const t = (b.innerText || b.textContent || '').trim();
    if (/^(查看更多|See more|展開|更多|續看|顯示更多)$/.test(t)) {
      try {
        b.click();
        clicked++;
      } catch {}
    }
  });
  return { clicked, scope: dialog ? 'dialog' : 'article' };
}

/**
 * Stage 2: 抓 URL + group + text
 *
 * 優先順序找 article：
 *   1. user 選取的文字 (selection)
 *   2. role="dialog" 內的 role="article"（user 點開的 post）
 *   3. timeline 上最長 innerText 的 article（fallback）
 */
function extractFbPostInPage() {
  let url = window.location.href;
  let article = null;
  let source = 'fallback';

  let preExtractedStoryEl = null;

  // ===========================================================
  // 新策略：viewport-based — user 螢幕中正看到的就是 main post
  // FB modal/dialog selector 不穩，改用「user 視野中的 story 元素」
  // ===========================================================
  const viewportHeight = window.innerHeight;

  // Collect all story_message candidates
  const allStorySels = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-comet-preview="message"]',
  ];
  const candidates = [];
  allStorySels.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text.length < 30) return;
      const rect = el.getBoundingClientRect();
      // 排除 hidden / display:none
      if (rect.width === 0 || rect.height === 0) return;
      candidates.push({
        el,
        text,
        length: text.length,
        top: rect.top,
        // 「在 viewport 中央區域」= 用戶正在看的
        inCenter: rect.top >= -100 && rect.top < viewportHeight * 0.6,
        inView: rect.bottom > 0 && rect.top < viewportHeight,
      });
    });
  });

  if (candidates.length > 0) {
    // 排序：在中央 > 在 view > 距離 viewport 中心近 > 長
    candidates.sort((a, b) => {
      if (a.inCenter !== b.inCenter) return a.inCenter ? -1 : 1;
      if (a.inView !== b.inView) return a.inView ? -1 : 1;
      // 同 category 內，top 小（更上面）優先
      return a.top - b.top;
    });
    preExtractedStoryEl = candidates[0].el;
    article = preExtractedStoryEl.closest('[role="article"]');
    source = candidates[0].inCenter ? 'viewport-center' : 'viewport';
  }

  // Fallback: 抓 viewport 內最長的 article
  if (!article) {
    const articles = document.querySelectorAll('[role="article"]');
    let longest = null;
    let longestLen = 0;
    articles.forEach((a) => {
      const rect = a.getBoundingClientRect();
      const inView = rect.bottom > 0 && rect.top < viewportHeight;
      if (!inView) return;
      const len = (a.innerText || '').length;
      if (len > longestLen) {
        longest = a;
        longestLen = len;
      }
    });
    if (longest) {
      article = longest;
      source = 'viewport-article';
    }
  }

  // Final fallback: document 內最長
  if (!article) {
    let longest = null;
    let longestLen = 0;
    document.querySelectorAll('[role="article"]').forEach((a) => {
      const len = (a.innerText || '').length;
      if (len > longestLen) {
        longest = a;
        longestLen = len;
      }
    });
    if (longest) {
      article = longest;
      source = 'longest';
    }
  }

  // 1. URL: 從 article 找 post permalink
  if (article) {
    const links = article.querySelectorAll(
      'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/photo"], a[href*="/groups/"][href*="/permalink"]'
    );
    for (const link of links) {
      const href = link.href || '';
      if (
        (href.includes('/posts/') || href.includes('/permalink/')) &&
        !href.includes('comment_id') &&
        !href.includes('reply_comment_id')
      ) {
        url = href.split('?')[0];
        break;
      }
    }
  }

  // 2. 社團名：title 在 dialog 開啟時會加「| 貼文摘要」，要取第一個 | 前
  let groupName = (document.title || '').trim();
  groupName = groupName
    .replace(/^\s*\(\d+\+?\)\s*/, '') // 去掉 (2) (99+)
    .replace(/\s*[|｜].*$/, '')        // 取第一個 | 前
    .replace(/\s*-\s*Facebook\s*$/i, '')
    .trim();

  // 3. 貼文文字
  let postText = '';

  // 3a. 優先：使用者目前 selected text（最準）
  const selection = window.getSelection ? window.getSelection().toString() : '';
  if (selection && selection.trim().length >= 30) {
    return {
      url,
      groupName,
      postText: selection.trim(),
      source: 'selection',
    };
  }

  // 3b. 用 preExtractedStoryEl（Strategy A 已找到）或從 article 內找
  let storyEl = preExtractedStoryEl;
  if (!storyEl && article) {
    const selectors = [
      '[data-ad-rendering-role="story_message"]',
      '[data-ad-comet-preview="message"]',
    ];
    for (const sel of selectors) {
      const candidates = article.querySelectorAll(sel);
      if (candidates.length > 0) {
        // 取最頂端的（FB post 本文一定在 article 頂端）
        const sorted = Array.from(candidates).sort(
          (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
        );
        storyEl = sorted[0];
        break;
      }
    }
  }

  if (storyEl) {
    postText = (storyEl.innerText || '').trim();
  } else if (article) {
    // 3c. fallback: article 整段（會含留言 noise）
    postText = (article.innerText || '').trim();
  }

  // Clean
  postText = postText
    .replace(/^查看更多$|^See more$|^展開$|^更多$/gm, '')
    .replace(/^讚\s*$|^Like\s*$/gm, '')
    .replace(/^留言\s*$|^Comment\s*$/gm, '')
    .replace(/^分享\s*$|^Share\s*$/gm, '')
    .replace(/^全部留言$|^All comments$/gm, '')
    .replace(/^還沒有人留言$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { url, groupName, postText, source };
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
  setStatus('🔍 展開「查看更多」…');

  // Stage 1: expand see more
  let expandResultLabel = '';
  try {
    const [expandResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: expandSeeMoreInPage,
    });
    const r = expandResult?.result;
    if (r) {
      expandResultLabel = ` (${r.scope})`;
      if (r.clicked > 0) {
        setStatus(`🔍 展開 ${r.clicked} 個「查看更多」，等待渲染…`);
        await new Promise((res) => setTimeout(res, 600));
      }
    }
  } catch {}

  // Stage 2: extract
  setStatus('🔍 抓取貼文…');
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
      const sourceLabels = {
        selection: '你選取的範圍',
        'viewport-center': '你螢幕中央的貼文',
        viewport: '你視野內的貼文',
        'viewport-article': '視野內最長 article',
        longest: '頁面最長 article',
        fallback: 'fallback',
      };
      const sourceLabel = sourceLabels[data.source] || data.source;
      setStatus(`✅ 抓到 ${data.postText.length} 字（${sourceLabel}）`, 'ok');
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

  const params = new URLSearchParams();
  params.set('text', text);
  if (url) params.set('url', url);
  if (group) params.set('group', group);
  const targetUrl = PLASOUL_URL + '#' + params.toString();

  await chrome.tabs.create({ url: targetUrl });
  window.close();
});

init();
