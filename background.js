// background.js — service worker(module)
// 状态机:接收捕获 → 合并会话状态 → 触发全参数补全抓取 → 防抖写盘(MD/JSON/资源)。
import {
  buildMarkdown, buildJson, dirFor, collectAssets, pickFileName, activePath, safeName, assignFileNames, filesDirFor, convHash, msgPrefixedName
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
  keepHistory: true,    // 保留每次抓取的 JSON 历史快照(便于多版本合并)
  silentDownload: true, // 静默下载:完成后从浏览器下载记录移除(不删文件),避免刷屏
  maxSpeedMBps: 0,      // 抓取限速(平均 MB/s):0=不限,1/5/20 档
  debugLog: false       // 调试日志:在 Service Worker 控制台打印「追踪→保存」每一步
};

// 内存态:convId -> { orgId, data, full, lastRequest, lastStream, name, savedSig }
const state = new Map();
const timers = new Map();

// ---------------- 运行日志 ----------------
// 既打印到控制台,也写入 chrome.storage.local 的环形缓冲(最近 300 条),供弹窗"查看日志"导出
let _logCache = null;
async function logLine(stage, msg, extra) {
  let on = false;
  try { const { settings } = await chrome.storage.local.get('settings'); on = !!(settings && settings.debugLog); } catch {}
  const line = { t: Date.now(), stage, msg, ...(extra ? { extra } : {}) };
  // 控制台(开了 debugLog 才打,避免噪音)
  if (on) { try { console.log(`[CCA ${stage}] ${msg}`, extra != null ? extra : ''); } catch {} }
  // 环形缓冲(始终记录,方便事后排查;只留最近 300 条)
  try {
    if (!_logCache) _logCache = (await chrome.storage.local.get('runlog')).runlog || [];
    _logCache.push(line);
    if (_logCache.length > 300) _logCache = _logCache.slice(-300);
    await chrome.storage.local.set({ runlog: _logCache });
  } catch {}
}

// ---------------- 设置 ----------------
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
async function ensureSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
}
chrome.runtime.onInstalled.addListener(() => { ensureSettings(); scanArchiveFolder().catch(() => {}); syncDynamicScripts().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensureSettings(); scanArchiveFolder().catch(() => {}); syncDynamicScripts().catch(() => {}); });

// ---------------- 自定义中转站:动态注册内容脚本 ----------------
// content_scripts 静态 matches 不能改;对用户添加的站点用 scripting.registerContentScripts 动态注册。
// 仅注册"已获得权限"的站点,避免注册失败。
async function syncDynamicScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  const sites = await getCustomSites();
  // 先清掉我们注册过的动态脚本
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ours = existing.filter(s => s.id && s.id.startsWith('cca-dyn-')).map(s => s.id);
    if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  } catch (e) {}
  if (!sites.length) return;
  // 只对已授权的站点注册
  const granted = [];
  for (const host of sites) {
    const origin = `https://${host}/*`;
    let has = false;
    try { has = await chrome.permissions.contains({ origins: [origin] }); } catch (e) {}
    if (has) granted.push(host);
  }
  if (!granted.length) return;
  const matches = granted.map(hostToGlob);
  try {
    await chrome.scripting.registerContentScripts([
      { id: 'cca-dyn-main', matches, js: ['interceptor.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
      { id: 'cca-dyn-iso', matches, js: ['bridge.js'], runAt: 'document_start', persistAcrossSessions: true }
    ]);
    logLine('scan', `已为 ${granted.length} 个自定义站点注册抓取脚本:${granted.join(', ')}`);
  } catch (e) { logLine('write', '动态注册脚本失败:' + (e && e.message || e)); }
}

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
// 拆分 basename → {stem, ext}
function splitName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}
// 给一个 basename 生成第 N 版的名字:第1版原名,之后 name__v2.ext / __v3...
function versionedName(baseName, versionIndex) {
  if (versionIndex <= 1) return baseName;
  const { stem, ext } = splitName(baseName);
  return `${stem}__v${versionIndex}${ext}`;
}

// ---------------- 直写磁盘(File System Access)----------------
// 用户在 viewer 里绑定 ClaudeArchive 文件夹 → 句柄存 IndexedDB → 本 SW 直接读写磁盘:
// 零浏览器下载记录、文件夹即跟踪记录(启动扫描重建索引)。权限失效自动退回下载模式。
const IDB_NAME = 'cca', IDB_STORE = 'handles';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try { const db = await idbOpen(); return await new Promise((res, rej) => { const t = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  catch (e) { return null; }
}
async function idbSet(key, val) {
  try { const db = await idbOpen(); return await new Promise((res, rej) => { const t = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key); t.onsuccess = () => res(true); t.onerror = () => rej(t.error); }); }
  catch (e) { return false; }
}
// 取根句柄:granted 才返回;'prompt' 表示需在页面里重新授权一次(SW 无用户手势,无法自行请求)
async function getRootHandle() {
  try {
    const h = await idbGet('root');
    if (!h) return { handle: null, status: 'unbound', name: '' };
    let p = 'prompt';
    try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) {}
    return { handle: p === 'granted' ? h : null, status: p === 'granted' ? 'granted' : 'need-reauth', name: h.name || '' };
  } catch (e) { return { handle: null, status: 'unbound', name: '' }; }
}
// 去掉相对路径开头的 ClaudeArchive/(绑定的就是该文件夹本身)
function stripRoot(relPath) {
  const p = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p;
}
// 沿路径逐级取/建目录,写入文件(覆盖语义;资产名由 decideName 保证全新,正本/快照本就该覆盖)
async function writeViaHandle(root, relPath, blob) {
  const parts = stripRoot(relPath).split('/').filter(Boolean);
  const fileName = parts.pop();
  let dir = root;
  for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return true;
}
// 列出某子目录下的真实文件名(不存在返回空集)
async function listDirDirect(root, relDir) {
  const out = new Set();
  try {
    const parts = stripRoot(relDir).split('/').filter(Boolean);
    let dir = root;
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
    for await (const [name, h] of dir.entries()) if (h.kind === 'file') out.add(name);
  } catch (e) {}
  return out;
}
// 读取一个对话目录里的 conversation.json 元信息(大小防爆保护)
async function readConvMeta(dirHandle) {
  try {
    const fh = await dirHandle.getFileHandle('conversation.json');
    const f = await fh.getFile();
    if (f.size > 40 * 1024 * 1024) return null;
    const j = JSON.parse(await f.text());
    if (!j || !j.uuid) return null;
    return { uuid: j.uuid, name: j.name || '', updated_at: j.updated_at || '', msgs: Array.isArray(j.chat_messages) ? j.chat_messages.length : 0 };
  } catch (e) { return null; }
}
// 扫描绑定文件夹:每个 {名}__{uuid8} 子目录读 conversation.json → 重建持久索引。
// 文件夹在 = 跟踪在,重装扩展/换浏览器配置后无需逐个点开对话。
let _scanning = false;
async function scanArchiveFolder(force = false) {
  if (_scanning) return { ok: false, error: 'busy' };
  const { lastScan } = await chrome.storage.local.get('lastScan');
  if (!force && lastScan && Date.now() - lastScan < 10 * 60 * 1000) return { ok: true, skipped: true };
  const { handle, status } = await getRootHandle();
  if (!handle) return { ok: false, error: status };
  _scanning = true;
  try {
    const { index } = await chrome.storage.local.get('index');
    const idx = index || {};
    let found = 0, added = 0;
    for await (const [name, h] of handle.entries()) {
      if (h.kind !== 'directory') continue;
      if (name === '_trash' || name.startsWith('.')) continue;
      if (!/__[0-9a-f]{8}$/i.test(name)) continue;
      const meta = await readConvMeta(h);
      if (!meta) continue;
      found++;
      if (!idx[meta.uuid]) added++;
      idx[meta.uuid] = Object.assign({}, idx[meta.uuid], {
        name: meta.name, updated_at: meta.updated_at, msgs: meta.msgs, dir: name, fromDisk: true
      });
    }
    await chrome.storage.local.set({ index: idx, lastScan: Date.now() });
    logLine('scan', `本地文件夹扫描完成:发现 ${found} 个对话存档(新增 ${added} 个进索引)`);
    return { ok: true, found, added, total: Object.keys(idx).length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { _scanning = false; }
}

// ---------------- 下载 ----------------
// 列出 chrome.downloads 记录里、某目录下、磁盘仍存在的所有文件名(basename)。
// 用于"按磁盘真实情况"判断同名/算版本号,避免与 verMap 脱节导致撞名。
function listDownloadedInDir(dirRel) {
  return new Promise((resolve) => {
    const dir = (dirRel.replace(/\\/g, '/').replace(/\/+$/, '')) + '/';
    const set = new Set();
    try {
      chrome.downloads.search({ limit: 0, orderBy: ['-startTime'] }, (items) => {
        if (!chrome.runtime.lastError && Array.isArray(items)) {
          for (const it of items) {
            if (!it || !it.filename) continue;
            if (it.state !== 'complete' || it.exists === false) continue;
            const fn = it.filename.replace(/\\/g, '/');
            const i = fn.indexOf('/' + dir);
            // 末尾匹配 ".../<dir>/<file>"(file 不再含子目录)
            const at = fn.endsWith(dir) ? -1 : (i >= 0 ? i + 1 + dir.length : (fn.startsWith(dir) ? dir.length : -1));
            if (at >= 0) {
              const rest = fn.slice(at);
              if (rest && !rest.includes('/')) set.add(rest);
            }
          }
        }
        resolve(set);
      });
    } catch (e) { resolve(set); }
  });
}
// 查询某相对路径是否"已下载且磁盘仍在"
function alreadyDownloaded(relPath) {
  return new Promise((resolve) => {
    try {
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
function downloadDataUrl(url, path, overwrite = false) {
  return new Promise((resolve) => {
    try {
      // 正本(conversation.json/md、history、_index 等)必须覆盖自身;
      // 资产由 decideName 保证全新名,'uniquify' 仅作最后兜底,绝不弹系统窗口
      chrome.downloads.download(
        { url, filename: path, conflictAction: overwrite ? 'overwrite' : 'uniquify', saveAs: false },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) {
            resolve({ ok: false, error: chrome.runtime.lastError?.message || 'download failed' });
          } else {
            resolve({ ok: true, id });
            maybeEraseDownload(id);
          }
        }
      );
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });
}
// 下载完成即从浏览器下载记录中抹去这一条(不删文件,只清记录,避免刷屏)
async function maybeEraseDownload(id) {
  try {
    const s = await getSettings();
    if (s.silentDownload === false) return; // 用户可关闭
    const finish = (downloadDelta) => {
      if (downloadDelta.id !== id) return;
      if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(finish);
        try { chrome.downloads.erase({ id }, () => void chrome.runtime.lastError); } catch {}
      } else if (downloadDelta.state && downloadDelta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(finish);
      }
    };
    chrome.downloads.onChanged.addListener(finish);
    // 兜底:有些完成事件可能早于监听注册,直接查一次
    setTimeout(() => {
      try {
        chrome.downloads.search({ id }, (items) => {
          const it = items && items[0];
          if (it && it.state === 'complete') {
            chrome.downloads.onChanged.removeListener(finish);
            chrome.downloads.erase({ id }, () => void chrome.runtime.lastError);
          }
        });
      } catch {}
    }, 1500);
  } catch {}
}
// base64 → Uint8Array
function b64ToU8(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
// 统一落盘:优先直写绑定文件夹(零下载记录);未绑定/失败 → 退回浏览器下载(静默)
async function saveText(path, text, mime = 'text/plain', overwrite = false) {
  const { handle } = await getRootHandle();
  if (handle) {
    try { await writeViaHandle(handle, path, new Blob([String(text == null ? '' : text)], { type: mime })); return { ok: true, direct: true }; }
    catch (e) { logLine('write', '直写失败,退回下载:' + (e && e.message || e), { path }); }
  }
  const url = await toDataUrl({ kind: 'text', text, mime });
  return downloadDataUrl(url, path, overwrite);
}
async function saveB64(path, b64, mime = 'application/octet-stream', overwrite = false) {
  const { handle } = await getRootHandle();
  if (handle) {
    try { await writeViaHandle(handle, path, new Blob([b64ToU8(b64)], { type: mime })); return { ok: true, direct: true }; }
    catch (e) { logLine('write', '直写失败,退回下载:' + (e && e.message || e), { path }); }
  }
  const url = await toDataUrl({ kind: 'b64', b64, mime });
  return downloadDataUrl(url, path, overwrite);
}

// ---------------- 站点匹配(内置 + 用户自定义中转站) ----------------
const BUILTIN_GLOBS = ['https://claude.ai/*', 'https://*.claude.ai/*', 'https://claude.hk.cn/*'];
// 规范化用户输入 → host(去协议/路径/端口)。返回 null 表示无效
function normalizeHost(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return u.hostname || null; } catch (e) { return null; }
}
function hostToGlob(host) { return `https://${host}/*`; }
async function getCustomSites() {
  const { customSites } = await chrome.storage.local.get('customSites');
  return Array.isArray(customSites) ? customSites : [];
}
async function allTabGlobs() {
  const sites = await getCustomSites();
  return BUILTIN_GLOBS.concat(sites.map(hostToGlob));
}
async function findTab() {
  const globs = await allTabGlobs();
  const tabs = await chrome.tabs.query({ url: globs });
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


// ---------------- 归档(同一对话严格串行,根治并发竞态导致的重复下载) ----------------
const _archLocks = new Map(); // convId -> { running:Promise, pending:{force}|null }
async function archive(convId, opts = {}) {
  const cur = _archLocks.get(convId);
  if (cur) {
    // 已在跑:合并为"跑完后再补跑一次"(force 取并集),多次触发只补一次
    cur.pending = { force: !!(cur.pending && cur.pending.force) || !!opts.force };
    logLine('archive', '已有归档在进行,本次请求已合并排队', { convId });
    return cur.running;
  }
  const slot = { pending: null, running: null };
  slot.running = (async () => {
    let r = await _archiveOnce(convId, opts);
    while (slot.pending) { const p = slot.pending; slot.pending = null; r = await _archiveOnce(convId, p); }
    _archLocks.delete(convId);
    return r;
  })();
  _archLocks.set(convId, slot);
  return slot.running;
}

async function _archiveOnce(convId, { force = false } = {}) {
  const st = state.get(convId);
  if (!st || !st.data) { logLine('archive', `跳过:内存中没有「${convId}」的数据(可能未捕获,试着刷新该对话页面)`, { convId }); return { ok: false, error: 'no state' }; }
  const settings = await getSettings();
  if (!settings.enabled) { logLine('archive', '跳过:扩展总开关已关闭'); return { ok: false, error: 'disabled' }; }

  const conv = { uuid: convId, orgId: st.orgId, data: st.data, full: st.full, origin: st.origin,
                 lastRequest: st.lastRequest, lastStream: st.lastStream };

  // 去重:活动分支结构 + 消息数 + leaf 变化才重写
  const { path } = activePath(st.data);
  const sig = `${st.data?.updated_at || ''}|${path.length}|${st.data?.current_leaf_message_uuid || ''}|${st.full ? 'F' : 'P'}`;
  if (!force && st.savedSig === sig) { logLine('archive', `跳过:「${st.name || convId}」内容未变化(已是最新)`, { convId }); return { ok: true, skipped: true }; }

  logLine('archive', `开始保存「${st.name || convId}」${force ? '(强制)' : ''}…`, { convId });

  const dir = dirFor(conv);
  const base = `${ROOT}/${dir}`;
  const md = buildMarkdown(conv);
  const json = buildJson(conv);

  // canonical:始终保持最新(覆盖)
  const r1 = await saveText(`${base}/conversation.md`, md, 'text/markdown', true);
  const r2 = await saveText(`${base}/conversation.json`, json, 'application/json', true);

  // 历史快照:把这次的 JSON 另存一份带时间戳到 history/,内容变化才存(便于多版本合并去重)
  if (settings.keepHistory !== false) {
    try {
      const histKey = `hist_sig_${convId}`;
      const lastSig = (await chrome.storage.local.get(histKey))[histKey];
      const curSig = `${st.data?.updated_at || ''}|${(st.data?.chat_messages || []).length}|${st.data?.current_leaf_message_uuid || ''}`;
      if (lastSig !== curSig) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const upd = (st.data?.updated_at || '').replace(/[:.]/g, '-').slice(0, 19) || ts;
        await saveText(`${base}/history/conversation_${upd}.json`, json, 'application/json', true);
        await chrome.storage.local.set({ [histKey]: curSig });
      }
    } catch {}
  }

  // 资源
  let fileCount = 0;
  if (settings.saveAssets) {
    const savedKey = `saved_files_${convId}`;
    const savedRec = (await chrome.storage.local.get(savedKey))[savedKey] || {};
    // 内容版本表:basename -> [{hash, name}, ...](已落盘的各版本)
    const verKey = `filever_${convId}`;
    const verMap = (await chrome.storage.local.get(verKey))[verKey] || {};
    // 兼容旧格式(basename -> [hash,...]):转成 [{hash,name}]
    for (const k of Object.keys(verMap)) {
      if (Array.isArray(verMap[k]) && verMap[k].length && typeof verMap[k][0] === 'string') {
        verMap[k] = verMap[k].map((h, i) => ({ hash: h, name: versionedName(k, i + 1) }));
      }
    }
    // 全局已存指纹(同一张图换名也不重存)
    const seenHashes = new Set();
    for (const arr of Object.values(verMap)) for (const v of arr) if (v && v.hash) seenHashes.add(v.hash);

    const tabId = await findTab();
    const convDir = filesDirFor(conv); // files/{对话码}/

    // 已占用的文件名集合 = 我们自己持久记录里该对话已存的所有版本名(不依赖会被擦除的下载历史)
    const diskNames = new Set();
    for (const arr of Object.values(verMap)) for (const v of arr) if (v && v.name) diskNames.add(v.name);
    // 再并入 savedRec 里记录过的(兼容历史数据)
    for (const rel of Object.values(savedRec)) {
      if (typeof rel === 'string') { const b = rel.split('/').pop(); if (b) diskNames.add(b); }
    }
    // 直写模式:再并入磁盘上真实存在的文件名(文件夹即真相);
    // 若 verMap 丢失(重装扩展)而磁盘有文件 → 现场读文件重建哈希表,恢复"同内容跳过"能力
    const { handle: rootHandle } = await getRootHandle();
    if (rootHandle) {
      const real = await listDirDirect(rootHandle, `${base}/${convDir}`);
      for (const n of real) diskNames.add(n);
      const knownNames = new Set(); for (const arr of Object.values(verMap)) for (const v of arr) if (v && v.name) knownNames.add(v.name);
      const unknown = [...real].filter(n => !knownNames.has(n));
      if (unknown.length) {
        try {
          const parts = stripRoot(`${base}/${convDir}`).split('/').filter(Boolean);
          let dirH = rootHandle; for (const seg of parts) dirH = await dirH.getDirectoryHandle(seg);
          for (const n of unknown) {
            try {
              const f = await (await dirH.getFileHandle(n)).getFile();
              let hash = null;
              if (f.size <= 100 * 1024 * 1024) {
                const buf = await f.arrayBuffer();
                const h = await crypto.subtle.digest('SHA-256', buf);
                hash = [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
              }
              // 反推 baseName(剥 __vN)归入 verMap
              const m = n.match(/^(.*)__v(\d+)(\.[^.]*)?$/);
              const baseN = m ? (m[1] + (m[3] || '')) : n;
              (verMap[baseN] || (verMap[baseN] = [])).push({ hash, name: n });
              if (hash) seenHashes.add(hash);
            } catch (e) {}
          }
          logLine('rebuild', `从磁盘重建版本表:${unknown.length} 个文件已纳入(${convDir})`);
        } catch (e) {}
      }
    }

    // 限速:按设置的平均速率给抓取配速(0=不限)
    const limitMBps = Number(settings.maxSpeedMBps || 0);
    const paceStart = Date.now(); let paceBytes = 0;
    const pace = async (addBytes) => {
      if (!limitMBps) return;
      paceBytes += addBytes;
      const shouldMs = paceBytes / (limitMBps * 1048576) * 1000;
      const wait = shouldMs - (Date.now() - paceStart);
      if (wait > 30) await new Promise(r => setTimeout(r, Math.min(wait, 5000)));
    };

    // 决定一个待存内容应使用的文件名;返回 null 表示"无需保存"(同哈希已存)
    const decideName = (baseName, hash) => {
      const arr = verMap[baseName] || (verMap[baseName] = []);
      // 规则3:这份内容已存过(任何名字)→ 不存
      if (hash && seenHashes.has(hash)) return null;
      // 规则1+2:从第 1 版开始找一个"磁盘上不存在"的名字,绝不覆盖
      let idx = 1, cand = versionedName(baseName, idx);
      while (diskNames.has(cand)) { idx++; cand = versionedName(baseName, idx); }
      return cand;
    };
    const remember = (baseName, hash, name) => {
      (verMap[baseName] || (verMap[baseName] = [])).push({ hash: hash || null, name });
      if (hash) seenHashes.add(hash);
      diskNames.add(name);            // 立刻占用该名,后续同名内容顺延 v(n+1)
      savedRec['gen:' + (hash || (convDir + '/' + name))] = convDir + '/' + name;
    };

    let skipCount = 0;
    if (tabId != null) {
      const assets = collectAssets(st.data, st.orgId, convId);
      for (const a of assets) {
        const resp = await askTab(tabId, { kind: 'fetchAsset', url: a.path });
        if (!resp || !resp.ok || !resp.b64) continue;
        await pace(Math.floor(resp.b64.length * 0.75));      // 限速配速(按真实字节)
        const hash = await sha256OfB64(resp.b64);
        if (!hash) logLine('write', '警告:内容哈希计算失败,该文件将无法判重', { name: a.name || a.path });
        if (hash && seenHashes.has(hash)) { skipCount++; continue; } // 规则3:同哈希不存(跨消息同内容也只存一份)
        const rawName = pickFileName(resp.cd, a.name, a.path, resp.ct);
        // 版本归属:文件名前缀 = 产生它的消息 uuid8。不同消息的同名文件天然区分,viewer 可精确定位
        const baseName = msgPrefixedName(a.msgUuid, rawName);
        const finalName = decideName(baseName, hash);
        if (!finalName) { skipCount++; continue; }
        const rel = `${convDir}/${finalName}`;
        const dl = await saveB64(`${base}/${rel}`, resp.b64, (resp.ct || '').split(';')[0]);
        if (dl.ok) { fileCount++; remember(baseName, hash, finalName); }
      }
    }

    // 文本附件(同规则:带消息前缀)
    for (const m of (st.data.chat_messages || [])) {
      for (const a of (m.attachments || [])) {
        if (a && typeof a.extracted_content === 'string' && a.extracted_content.trim()) {
          const hash = await sha256OfText(a.extracted_content);
          if (hash && seenHashes.has(hash)) { skipCount++; continue; }
          const stem = safeName(String(a.file_name || 'attachment').replace(/\.[^.]+$/, ''), 70) || 'attachment';
          const baseName = msgPrefixedName(m.uuid, stem + '.txt');
          const finalName = decideName(baseName, hash);
          if (!finalName) { skipCount++; continue; }
          const rel = `${convDir}/${finalName}`;
          const dl = await saveText(`${base}/${rel}`, a.extracted_content, 'text/plain');
          if (dl.ok) { fileCount++; remember(baseName, hash, finalName); }
        }
      }
    }
    if (skipCount) logLine('archive', `判重跳过 ${skipCount} 个已存文件(哈希一致)`, { convId });

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

  logLine('archive', `已保存「${st.data?.name || convId}」· 新 ${fileCount} 个文件`, { convId, files: fileCount });
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
    if (!convId) { logLine('capture', '收到 conversation 但无法识别 convId,跳过', { url: p.url }); return; }
    const st = state.get(convId) || {};
    st.orgId = p.orgId || st.orgId;
    st.data = p.data;
    st.full = st.full || /render_all_tools=true/i.test(p.url || '');
    st.name = p.data?.name;
    try { if (p.url && /^https?:\/\//i.test(p.url)) st.origin = new URL(p.url).origin; } catch {}
    state.set(convId, st);
    logLine('capture', `已捕获并追踪「${st.name || convId}」(${(p.data?.chat_messages || []).length} 条消息${st.full ? ',完整版' : ''})`, { convId });
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
      const dh = await getRootHandle();
      sendResponse({
        ok: true, settings, stats: stats || {},
        convCount: Object.keys(index || {}).length,
        tracked: Object.keys(index || {}).length, // 已跟踪=持久索引里的对话数(刷新不清零)
        current,
        direct: { status: dh.status, name: dh.name }   // unbound | need-reauth | granted
      });
    })();
    return true;
  }

  // viewer 完成文件夹绑定 → 校验权限并立即扫描重建索引
  if (msg.kind === 'viewer:bound') {
    (async () => {
      const r = await scanArchiveFolder(true);
      const dh = await getRootHandle();
      sendResponse({ ok: dh.status === 'granted', status: dh.status, name: dh.name, scan: r });
    })();
    return true;
  }

  // 手动触发本地文件夹扫描(从文件夹恢复跟踪索引)
  if (msg.kind === 'popup:scanFolder') {
    (async () => { sendResponse(await scanArchiveFolder(true)); })();
    return true;
  }

  // —— 自定义中转站管理 ——
  if (msg.kind === 'popup:listSites') {
    (async () => { sendResponse({ ok: true, builtin: BUILTIN_GLOBS.map(g => g.replace('https://','').replace('/*','')), sites: await getCustomSites() }); })();
    return true;
  }
  // 权限已在 popup 侧(有用户手势)申请通过后调用:保存并动态注册
  if (msg.kind === 'popup:addSiteGranted') {
    (async () => {
      const host = normalizeHost(msg.host);
      if (!host) return sendResponse({ ok: false, error: '域名无效' });
      if (BUILTIN_GLOBS.some(g => g.includes(host))) return sendResponse({ ok: false, error: '该站点已内置支持' });
      const sites = await getCustomSites();
      if (!sites.includes(host)) sites.push(host);
      await chrome.storage.local.set({ customSites: sites });
      await syncDynamicScripts();
      sendResponse({ ok: true, host, sites });
    })();
    return true;
  }
  if (msg.kind === 'popup:removeSite') {
    (async () => {
      const host = normalizeHost(msg.host) || String(msg.host || '');
      let sites = await getCustomSites();
      sites = sites.filter(h => h !== host);
      await chrome.storage.local.set({ customSites: sites });
      // 撤销该站点权限(忽略失败)
      try { await chrome.permissions.remove({ origins: [`https://${host}/*`] }); } catch (e) {}
      await syncDynamicScripts();
      sendResponse({ ok: true, sites });
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
      const r = await saveText(`${ROOT}/_index.json`, json, 'application/json', true);
      sendResponse(r);
    })();
    return true;
  }

  if (msg.kind === 'popup:exportLog') {
    (async () => {
      const { runlog } = await chrome.storage.local.get('runlog');
      const lines = runlog || [];
      if (!lines.length) return sendResponse({ ok: false, error: '暂无运行日志(先开启「调试日志」并复现一次)' });
      const text = lines.map(l => {
        const ts = new Date(l.t).toISOString().replace('T', ' ').slice(0, 19);
        const ex = l.extra != null ? '  ' + JSON.stringify(l.extra) : '';
        return `[${ts}] [${l.stage}] ${l.msg}${ex}`;
      }).join('\n');
      const r = await saveText(`${ROOT}/_runlog.txt`, text, 'text/plain', true);
      sendResponse(r.ok ? { ok: true, count: lines.length } : r);
    })();
    return true;
  }
});

// —— 测试钩子(仅供自动化测试 import 使用;Chrome 运行时不调用,无副作用)——
export const __test = { archive, _archiveOnce, state, getSettings };
