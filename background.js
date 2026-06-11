// background.js — service worker(module)
// 状态机:接收捕获 → 合并会话状态 → 触发全参数补全抓取 → 防抖写盘(MD/JSON/资源)。
import {
  buildMarkdown, buildJson, dirFor, collectAssets, pickFileName, activePath, safeName, assignFileNames, filesDirFor, convHash
} from './exporter.js';

const ROOT = 'ClaudeArchive';
const DEBOUNCE_MS = 2500;

// 某子目录下已用过的文件名集合(savedRec 值是 "子目录/文件名")
function savedDirNames(savedRec, dir) {
  const set = new Set();
  const pre = dir + '/';
  for (const v of Object.values(savedRec || {})) {
    if (typeof v === 'string' && v.startsWith(pre)) set.add(v.slice(pre.length));
  }
  return set;
}
// 目录内唯一文件名:撞名则加 __2/__3…
function uniqueInDir(name, usedSet) {
  if (!usedSet.has(name)) { usedSet.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let k = 2, cand = `${stem}__${k}${ext}`;
  while (usedSet.has(cand)) { k++; cand = `${stem}__${k}${ext}`; }
  usedSet.add(cand);
  return cand;
}

const DEFAULT_SETTINGS = {
  enabled: true,        // 总开关
  autoSave: true,       // 捕获后自动写盘
  saveAssets: true,     // 下载文件(上传/生成)
  keepStream: false,    // 保留原始 SSE 事件流
  refetchFull: true,    // 完成后用全参数补全抓取(确保 thinking/tool 完整)
  keepHistory: true     // 保留每次抓取的 JSON 历史快照(便于多版本合并)
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

// 对 base64 内容算 SHA-256 指纹(用于"内容是否变化"判断)
async function sha256OfB64(b64) {
  try {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const h = await crypto.subtle.digest('SHA-256', u);
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}
function sha256OfText(text) {
  try {
    const u = new TextEncoder().encode(String(text == null ? '' : text));
    return crypto.subtle.digest('SHA-256', u).then(h =>
      [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join(''));
  } catch (e) { return Promise.resolve(null); }
}
// 给一个 basename 按"已存版本数"生成版本名:第1版用原名,之后 name__v2.ext / __v3...
function versionedName(baseName, versionIndex) {
  if (versionIndex <= 1) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  return `${stem}__v${versionIndex}${ext}`;
}

// ---------------- 下载 ----------------
// 查询某相对路径是否"之前已下载且文件仍在磁盘上"。是 → 跳过,绝不重发下载(避免重复 + 弹窗)
function alreadyDownloaded(relPath) {
  return new Promise((resolve) => {
    try {
      // Chrome 记录的是绝对路径,末尾匹配相对路径即可(用 / 与 \ 都试)
      const tail = relPath.replace(/\\/g, '/');
      chrome.downloads.search({ limit: 0, orderBy: ['-startTime'] }, (items) => {
        if (chrome.runtime.lastError || !Array.isArray(items)) { resolve(false); return; }
        for (const it of items) {
          if (!it || !it.filename) continue;
          const fn = it.filename.replace(/\\/g, '/');
          if ((fn === tail || fn.endsWith('/' + tail)) && it.state === 'complete' && it.exists !== false) {
            resolve(true); return;
          }
        }
        resolve(false);
      });
    } catch (e) { resolve(false); }
  });
}
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

// 把一个 Claude 标签页导航到指定对话,等待拦截器抓到该对话的数据(用于内存里没有的历史对话)
async function navigateAndCapture(convId, { timeoutMs = 25000 } = {}) {
  if (state.get(convId)?.data) return true; // 已在内存
  let tabId = await findTab();
  // 没有任何 Claude 标签页 → 新建一个(后台)
  let createdTab = false;
  const origin = 'https://claude.ai';
  if (tabId == null) {
    const t = await chrome.tabs.create({ url: `${origin}/chat/${convId}`, active: false });
    tabId = t.id; createdTab = true;
  } else {
    try {
      const t = await chrome.tabs.get(tabId);
      const m = String(t.url || '').match(/\/chat\/([0-9a-f-]{36})/i);
      const base = (String(t.url||'').match(/^https?:\/\/[^/]+/) || [origin])[0];
      if (!m || m[1].toLowerCase() !== convId.toLowerCase()) {
        await chrome.tabs.update(tabId, { url: `${base}/chat/${convId}` });
      }
    } catch { return false; }
  }
  // 轮询等待 state 里出现该对话数据(拦截器捕获 conversation JSON 后写入)
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 600));
    if (state.get(convId)?.data) {
      // 触发一次全参数补全抓取,确保 thinking/tool 完整
      const st = state.get(convId);
      if (st?.orgId) { try { await refetchFull(st.orgId, convId); await new Promise(r => setTimeout(r, 800)); } catch {} }
      return true;
    }
  }
  return false;
}

// 归档指定 convId:若内存没有,先导航抓取再归档
async function archiveById(convId, { force = true } = {}) {
  if (!state.get(convId)?.data) {
    const ok = await navigateAndCapture(convId);
    if (!ok) return { ok: false, error: '无法加载该对话(需要登录的 Claude 标签页)' };
  }
  return await archive(convId, { force });
}


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

  // canonical:始终保持最新(覆盖)
  const r1 = await saveText(`${base}/conversation.md`, md, 'text/markdown');
  const r2 = await saveText(`${base}/conversation.json`, json, 'application/json');

  // 历史快照:把这次的 JSON 另存一份带时间戳到 history/,内容变化才存(便于多版本合并去重)
  if (settings.keepHistory !== false) {
    try {
      const histKey = `hist_sig_${convId}`;
      const lastSig = (await chrome.storage.local.get(histKey))[histKey];
      const curSig = `${st.data?.updated_at || ''}|${(st.data?.chat_messages || []).length}|${st.data?.current_leaf_message_uuid || ''}`;
      if (lastSig !== curSig) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const upd = (st.data?.updated_at || '').replace(/[:.]/g, '-').slice(0, 19) || ts;
        await saveText(`${base}/history/conversation_${upd}.json`, json, 'application/json');
        await chrome.storage.local.set({ [histKey]: curSig });
      }
    } catch {}
  }

  // 资源
  let fileCount = 0;
  if (settings.saveAssets) {
    const savedKey = `saved_files_${convId}`;
    const savedRec = (await chrome.storage.local.get(savedKey))[savedKey] || {};
    // 内容版本表:basename -> [hash, hash, ...](按出现顺序,索引即版本号-1)
    const verKey = `filever_${convId}`;
    const verMap = (await chrome.storage.local.get(verKey))[verKey] || {};
    // 已见过的所有内容指纹(跨文件名,用于图片等"同图换名"也不重存)
    const seenHashes = new Set();
    for (const arr of Object.values(verMap)) for (const h of arr) seenHashes.add(h);

    const tabId = await findTab();
    const convDir = filesDirFor(conv); // files/{对话码}/  —— 所有产出统一放这,不再按轮次建文件夹

    if (tabId != null) {
      const assets = collectAssets(st.data, st.orgId, convId); // [{path,name,uuid,subdir,...}]
      for (const a of assets) {
        const resp = await askTab(tabId, { kind: 'fetchAsset', url: a.path });
        if (!resp || !resp.ok || !resp.b64) continue;

        // 内容指纹
        const hash = await sha256OfB64(resp.b64);
        // 这份内容(全局)已经存过 → 跳过,绝不重复下载/保存
        if (hash && seenHashes.has(hash)) continue;

        // 目标文件名(按真实 content-type 定扩展名;webp 就 .webp)
        const baseName = pickFileName(resp.cd, a.name, a.path, resp.ct);
        const versions = verMap[baseName] || [];
        // 同名文件:若该内容指纹已在此名下出现 → 跳过;否则是"新版本"
        if (hash && versions.includes(hash)) continue;
        const versionIndex = versions.length + 1;       // 第几个不同版本
        const finalName = versionedName(baseName, versionIndex);
        const rel = `${convDir}/${finalName}`;

        // 磁盘已有该文件(跨会话/上一次已存)→ 记一笔后跳过,不再发下载(避免弹窗)
        if (await alreadyDownloaded(`${base}/${rel}`)) {
          if (hash) { versions.push(hash); verMap[baseName] = versions; seenHashes.add(hash); }
          savedRec['gen:' + (hash || rel)] = rel;
          continue;
        }

        const dl = await saveB64(`${base}/${rel}`, resp.b64, (resp.ct || '').split(';')[0]);
        if (dl.ok) {
          fileCount++;
          if (hash) { versions.push(hash); verMap[baseName] = versions; seenHashes.add(hash); }
          savedRec['gen:' + (hash || rel)] = rel;
        }
      }
    }

    // 文本附件(放对话目录,按内容指纹去重)
    for (const m of (st.data.chat_messages || [])) {
      for (const a of (m.attachments || [])) {
        if (a && typeof a.extracted_content === 'string' && a.extracted_content.trim()) {
          const hash = await sha256OfText(a.extracted_content);
          if (hash && seenHashes.has(hash)) continue;
          const stem = safeName(String(a.file_name || 'attachment').replace(/\.[^.]+$/, ''), 70) || 'attachment';
          const baseName = stem + '.txt';
          const versions = verMap[baseName] || [];
          if (hash && versions.includes(hash)) continue;
          const finalName = versionedName(baseName, versions.length + 1);
          const rel = `${convDir}/${finalName}`;
          if (await alreadyDownloaded(`${base}/${rel}`)) {
            if (hash) { versions.push(hash); verMap[baseName] = versions; seenHashes.add(hash); }
            continue;
          }
          const dl = await saveText(`${base}/${rel}`, a.extracted_content, 'text/plain');
          if (dl.ok) { fileCount++; if (hash) { versions.push(hash); verMap[baseName] = versions; seenHashes.add(hash); } }
        }
      }
    }

    await chrome.storage.local.set({ [savedKey]: savedRec, [verKey]: verMap });

    // 进度记录:应下载文件总数(去重) vs 已保存,供 popup 进度条
    try {
      const allAssets = collectAssets(st.data, st.orgId, convId);
      let expectText = 0;
      for (const m of (st.data.chat_messages || [])) {
        for (const a of (m.attachments || [])) {
          if (a && typeof a.extracted_content === 'string' && a.extracted_content.trim()) expectText++;
        }
      }
      const total = allAssets.length + expectText;
      const saved = Object.keys(savedRec).length;
      const prog = (await chrome.storage.local.get('progress')).progress || {};
      prog[convId] = { name: st.data?.name || '未命名对话', total, saved, updatedAt: Date.now() };
      await chrome.storage.local.set({ progress: prog });
    } catch {}
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
        tracked: Object.keys(index || {}).length, // 已跟踪=持久索引里的对话数(刷新不清零)
        current
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
      const { index } = await chrome.storage.local.get('index');
      const ids = Object.keys(index || {});
      // 同时把当前打开的对话并入(可能还没进 index)
      const tabId0 = await findTab();
      if (tabId0 != null) {
        try { const t = await chrome.tabs.get(tabId0); const m = String(t.url||'').match(/\/chat\/([0-9a-f-]{36})/i); if (m && !ids.includes(m[1])) ids.unshift(m[1]); } catch {}
      }
      let saved = 0, files = 0, failed = 0, done = 0;
      for (const cid of ids) {
        await chrome.storage.local.set({ allTask: { phase: 'saveAll', total: ids.length, done, cur: (index?.[cid]?.name || cid) } });
        const r = await archiveById(cid, { force: true });
        if (r.ok) { saved++; files += (r.files || 0); } else { failed++; }
        done++;
      }
      await chrome.storage.local.remove('allTask');
      sendResponse({ ok: true, saved, files, failed, total: ids.length });
    })();
    return true;
  }

  // 检查全部(已跟踪)对话的保存完整性,并自动补下缺失文件
  if (msg.kind === 'popup:checkIntegrity') {
    (async () => {
      const { index } = await chrome.storage.local.get('index');
      const ids = Object.keys(index || {});
      if (!ids.length) return sendResponse({ ok: true, checked: 0, fixed: 0, missing: 0, note: '本地还没有已跟踪的对话' });
      let checked = 0, fixedFiles = 0, convWithMissing = 0, failed = 0;
      for (const cid of ids) {
        await chrome.storage.local.set({ allTask: { phase: 'check', total: ids.length, done: checked, cur: (index?.[cid]?.name || cid) } });
        // archiveById 内部会重新抓取并只下载缺失/新版本文件(已存的会跳过)
        const r = await archiveById(cid, { force: true });
        if (!r.ok) { failed++; checked++; continue; }
        const added = (r.files || 0);
        if (added > 0) { convWithMissing++; fixedFiles += added; }
        checked++;
      }
      await chrome.storage.local.remove('allTask');
      sendResponse({ ok: true, checked, fixed: fixedFiles, convWithMissing, failed, total: ids.length });
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
