// background.js — service worker(module)
// 状态机:接收捕获 → 合并会话状态 → 触发全参数补全抓取 → 防抖写盘(MD/JSON/资源)。
import {
  buildMarkdown, buildJson, dirFor, collectAssets, pickFileName, activePath, safeName
} from './exporter.js';

const ROOT = 'ClaudeArchive';
const DEBOUNCE_MS = 2500;

const DEFAULT_SETTINGS = {
  enabled: true,        // 总开关
  autoSave: true,       // 捕获后自动写盘
  saveAssets: true,     // 下载文件(上传/生成)
  keepStream: false,    // 保留原始 SSE 事件流
  refetchFull: true     // 完成后用全参数补全抓取(确保 thinking/tool 完整)
};

// 内存态:convId -> { orgId, data, full, lastRequest, lastStream, name, savedSig }
const state = new Map();
const timers = new Map();

// ---------------- 设置 ----------------
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
async function ensureSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
}
chrome.runtime.onInstalled.addListener(ensureSettings);
chrome.runtime.onStartup.addListener(ensureSettings);

// ---------------- 统计 ----------------
async function bumpStats(patch) {
  const { stats } = await chrome.storage.local.get('stats');
  const s = stats || { convCount: 0, fileCount: 0, lastSavedName: '', lastSavedAt: 0 };
  Object.assign(s, patch);
  await chrome.storage.local.set({ stats: s });
}
async function addConvToIndex(convId, data) {
  const { index } = await chrome.storage.local.get('index');
  const idx = index || {};
  const { path, total } = activePath(data);
  idx[convId] = {
    uuid: convId,
    name: data?.name ?? '未命名对话',
    updated_at: data?.updated_at ?? '',
    model: data?.model ?? '',
    messages: path.length,
    messages_total: total,
    savedAt: Date.now()
  };
  await chrome.storage.local.set({ index: idx });
}

// ---------------- offscreen(Blob→data: URL,供 downloads 使用) ----------------
let offscreenReady = null;
async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const has = await chrome.offscreen.hasDocument?.();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: '将文本/二进制内容转换为可下载的数据 URL'
      });
    }
  })();
  return offscreenReady;
}
async function toDataUrl(payload) {
  await ensureOffscreen();
  return await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'toDataUrl', payload });
}

// ---------------- 下载 ----------------
function downloadDataUrl(url, path) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.download(
        { url, filename: path, conflictAction: 'overwrite', saveAs: false },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) {
            resolve({ ok: false, error: chrome.runtime.lastError?.message || 'download failed' });
          } else {
            resolve({ ok: true, id });
          }
        }
      );
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });
}
async function saveText(path, text, mime = 'text/plain') {
  const url = await toDataUrl({ kind: 'text', text, mime });
  return downloadDataUrl(url, path);
}
async function saveB64(path, b64, mime = 'application/octet-stream') {
  const url = await toDataUrl({ kind: 'b64', b64, mime });
  return downloadDataUrl(url, path);
}

// ---------------- 找一个 claude.ai 标签页(代理带凭证抓取) ----------------
const CLAUDE_TAB_GLOBS = ['https://claude.ai/*', 'https://*.claude.ai/*', 'https://claude.hk.cn/*'];
async function findTab() {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_GLOBS });
  const active = tabs.find(t => t.active) || tabs[0];
  return active?.id ?? null;
}
function askTab(tabId, msg, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); } }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (done) return;
        done = true; clearTimeout(to);
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false, error: 'no response' });
      });
    } catch (e) { clearTimeout(to); resolve({ ok: false, error: String(e) }); }
  });
}

// ---------------- 核心:归档一个会话 ----------------
async function archive(convId, { force = false } = {}) {
  const st = state.get(convId);
  if (!st || !st.data) return { ok: false, error: 'no state' };
  const settings = await getSettings();
  if (!settings.enabled) return { ok: false, error: 'disabled' };

  const conv = { uuid: convId, orgId: st.orgId, data: st.data, full: st.full, origin: st.origin,
                 lastRequest: st.lastRequest, lastStream: st.lastStream };

  // 去重:活动分支结构 + 消息数 + leaf 变化才重写
  const { path } = activePath(st.data);
  const sig = `${st.data?.updated_at || ''}|${path.length}|${st.data?.current_leaf_message_uuid || ''}|${st.full ? 'F' : 'P'}`;
  if (!force && st.savedSig === sig) return { ok: true, skipped: true };

  const dir = dirFor(conv);
  const base = `${ROOT}/${dir}`;
  const md = buildMarkdown(conv);
  const json = buildJson(conv);

  const r1 = await saveText(`${base}/conversation.md`, md, 'text/markdown');
  const r2 = await saveText(`${base}/conversation.json`, json, 'application/json');

  // 资源
  let fileCount = 0;
  if (settings.saveAssets) {
    const usedNames = new Set();
    const uniqName = (nm) => {
      if (!usedNames.has(nm)) { usedNames.add(nm); return nm; }
      const dot = nm.lastIndexOf('.');
      const k = usedNames.size;
      const out = dot > 0 ? `${nm.slice(0, dot)}_${k}${nm.slice(dot)}` : `${nm}_${k}`;
      usedNames.add(out);
      return out;
    };

    // 1) URL 资源(图片、生成文件、可下载的附件)
    const tabId = await findTab();
    if (tabId != null) {
      const assets = collectAssets(st.data, st.orgId);
      for (const [url, suggested] of assets) {
        const resp = await askTab(tabId, { kind: 'fetchAsset', url });
        if (!resp || !resp.ok) continue;
        const name = uniqName(pickFileName(resp.cd, suggested, url, resp.ct));
        const dl = await saveB64(`${base}/files/${name}`, resp.b64, (resp.ct || '').split(';')[0]);
        if (dl.ok) fileCount++;
      }
    }

    // 2) 文本附件兜底:上传的文档常只有 extracted_content(无可下载 URL),存成 .txt 不丢内容
    for (const m of (st.data.chat_messages || [])) {
      for (const a of (m.attachments || [])) {
        if (a && typeof a.extracted_content === 'string' && a.extracted_content.trim()) {
          const stem = safeName(String(a.file_name || 'attachment').replace(/\.[^.]+$/, ''), 70) || 'attachment';
          const name = uniqName(stem + '.txt');
          const dl = await saveText(`${base}/files/${name}`, a.extracted_content, 'text/plain');
          if (dl.ok) fileCount++;
        }
      }
    }
  }

  st.savedSig = sig;
  await addConvToIndex(convId, st.data);
  await bumpStats({
    lastSavedName: st.data?.name ?? '未命名对话',
    lastSavedAt: Date.now()
  });
  const { stats } = await chrome.storage.local.get('stats');
  await chrome.storage.local.set({
    stats: { ...(stats || {}),
      convCount: ((stats || {}).convCount || 0) + (r1.ok || r2.ok ? 1 : 0),
      fileCount: ((stats || {}).fileCount || 0) + fileCount }
  });

  try {
    chrome.action.setBadgeBackgroundColor({ color: '#C15F3C' });
    chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800);
  } catch {}

  return { ok: r1.ok || r2.ok, files: fileCount, dir };
}

function scheduleArchive(convId) {
  clearTimeout(timers.get(convId));
  timers.set(convId, setTimeout(async () => {
    timers.delete(convId);
    const s = await getSettings();
    if (s.enabled && s.autoSave) { try { await archive(convId); } catch {} }
  }, DEBOUNCE_MS));
}

// ---------------- 全参数补全抓取 ----------------
async function refetchFull(orgId, convId) {
  if (!orgId) return;
  const tabId = await findTab();
  if (tabId == null) return;
  const resp = await askTab(tabId, { kind: 'refetchConv', orgId, convId }, 30000);
  if (resp && resp.ok && resp.data) {
    const st = state.get(convId) || {};
    st.orgId = orgId; st.data = resp.data; st.full = true;
    st.name = resp.data?.name; state.set(convId, st);
    scheduleArchive(convId);
  }
}

// ---------------- 接收捕获 ----------------
function idFromUrl(u) {
  const m = String(u || '').match(/chat_conversations\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

async function onCapture(type, p) {
  const s = await getSettings();
  if (!s.enabled) return;

  if (type === 'conversation') {
    const convId = p.data?.uuid || idFromUrl(p.url);
    if (!convId) return;
    const st = state.get(convId) || {};
    st.orgId = p.orgId || st.orgId;
    st.data = p.data;
    st.full = st.full || /render_all_tools=true/i.test(p.url || '');
    st.name = p.data?.name;
    try { if (p.url && /^https?:\/\//i.test(p.url)) st.origin = new URL(p.url).origin; } catch {}
    state.set(convId, st);
    scheduleArchive(convId);
    return;
  }

  if (type === 'completion_request') {
    const st = state.get(p.convId) || {};
    st.orgId = p.orgId || st.orgId;
    st.lastRequest = p.body;
    state.set(p.convId, st);
    return;
  }

  if (type === 'completion_done') {
    const st = state.get(p.convId) || {};
    st.orgId = p.orgId || st.orgId;
    if (p.events) st.lastStream = { eventCount: p.eventCount, events: p.events, ts: p.ts };
    else st.lastStream = { eventCount: p.eventCount, ts: p.ts };
    state.set(p.convId, st);
    // 生成结束:页面通常会重新拉会话;我们再主动补一次全参数抓取确保 thinking/tool 完整
    if (s.refetchFull && (st.orgId || p.orgId)) {
      setTimeout(() => refetchFull(st.orgId || p.orgId, p.convId).catch(() => {}), 1200);
    } else {
      scheduleArchive(p.convId);
    }
    return;
  }
}

// ---------------- 消息路由 ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.kind === 'capture') {
    onCapture(msg.type, msg.payload || {}).catch(() => {});
    return; // 不需回执
  }

  if (msg.kind === 'popup:getState') {
    (async () => {
      const settings = await getSettings();
      const { stats, index } = await chrome.storage.local.get(['stats', 'index']);
      const tabId = await findTab();
      let current = null;
      if (tabId != null) {
        try {
          const t = await chrome.tabs.get(tabId);
          const m = String(t.url || '').match(/\/chat\/([0-9a-f-]{36})/i);
          if (m) {
            const cid = m[1];
            const st = state.get(cid);
            current = { convId: cid, name: st?.name || '(打开中…)', captured: !!st?.data, full: !!st?.full };
          }
        } catch {}
      }
      sendResponse({
        ok: true, settings, stats: stats || {},
        convCount: Object.keys(index || {}).length,
        tracked: state.size, current
      });
    })();
    return true;
  }

  if (msg.kind === 'popup:setSettings') {
    (async () => {
      const cur = await getSettings();
      const next = { ...cur, ...(msg.patch || {}) };
      await chrome.storage.local.set({ settings: next });
      sendResponse({ ok: true, settings: next });
    })();
    return true;
  }

  if (msg.kind === 'popup:saveCurrent') {
    (async () => {
      const tabId = await findTab();
      if (tabId == null) return sendResponse({ ok: false, error: '没有打开的 Claude.ai 标签页' });
      const cap = await askTab(tabId, { kind: 'captureHere' }, 30000);
      if (!cap || !cap.ok) return sendResponse({ ok: false, error: cap?.error || '抓取失败' });
      // captureHere 已通过 capture 通道写入 state;直接强制归档
      await new Promise(r => setTimeout(r, 400));
      const res = await archive(cap.convId, { force: true });
      sendResponse(res.ok ? { ok: true, files: res.files, name: cap.name } : { ok: false, error: res.error });
    })();
    return true;
  }

  if (msg.kind === 'popup:saveAll') {
    (async () => {
      let saved = 0, files = 0;
      for (const cid of [...state.keys()]) {
        const r = await archive(cid, { force: true });
        if (r.ok && !r.skipped) { saved++; files += (r.files || 0); }
      }
      sendResponse({ ok: true, saved, files });
    })();
    return true;
  }

  if (msg.kind === 'popup:exportIndex') {
    (async () => {
      const { index } = await chrome.storage.local.get('index');
      const json = JSON.stringify(index || {}, null, 2);
      const r = await saveText(`${ROOT}/_index.json`, json, 'application/json');
      sendResponse(r);
    })();
    return true;
  }
});
