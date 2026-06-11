// bridge.js — 运行在内容脚本隔离世界(document_start)
// 职责:
//   1. 把 MAIN world 拦截器捕获的数据转发给 service worker
//   2. 把存储中的配置(keepStream)推送给 MAIN world
//   3. 代理后台的请求:fetchAsset(带 Cookie 抓取文件)、refetchConv(全参数补全抓取)、captureHere(归档当前会话)
'use strict';

const send = (m) => { try { return chrome.runtime.sendMessage(m).catch(() => {}); } catch { return null; } };

// MAIN world → service worker
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__cca !== true) return;
  send({ kind: 'capture', type: e.data.type, payload: e.data.payload });
});

// 推送配置给 MAIN world
function pushCfg(settings) {
  const cfg = { keepStream: !!(settings && settings.keepStream) };
  try { window.postMessage({ __cca_cfg: true, cfg }, location.origin); } catch {}
}
try {
  chrome.storage.local.get('settings').then(({ settings }) => pushCfg(settings));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) pushCfg(ch.settings.newValue);
  });
} catch {}

// ---------- 工具 ----------
function bufToB64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

const FULL_PARAMS = 'tree=True&rendering_mode=messages&render_all_tools=true';

async function fetchConvFull(orgId, convId) {
  const u = `${location.origin}/api/organizations/${orgId}/chat_conversations/${convId}?${FULL_PARAMS}`;
  const r = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.chat_messages)) return { ok: false, error: 'bad payload' };
  return { ok: true, orgId, data: j, url: u };
}

async function listOrgIds() {
  try {
    const r = await fetch(`${location.origin}/api/organizations`, {
      credentials: 'include', headers: { accept: 'application/json' }
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    if (Array.isArray(j)) return j.map(o => o && o.uuid).filter(Boolean);
    return [];
  } catch { return []; }
}

// ---------- 响应后台请求 ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;

  if (msg.kind === 'ping') { sendResponse({ ok: true }); return; }

  if (msg.kind === 'fetchAsset') {
    (async () => {
      try {
        const r = await fetch(msg.url, { credentials: 'include' });
        if (!r.ok) return sendResponse({ ok: false, status: r.status });
        const ct = r.headers.get('content-type') || '';
        const cd = r.headers.get('content-disposition') || '';
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 48 * 1024 * 1024) {
          return sendResponse({ ok: false, error: 'file too large (>48MB)' });
        }
        sendResponse({ ok: true, ct, cd, b64: bufToB64(buf) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.kind === 'refetchConv') {
    (async () => {
      try { sendResponse(await fetchConvFull(msg.orgId, msg.convId)); }
      catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if (msg.kind === 'captureHere') {
    (async () => {
      try {
        const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
        if (!m) return sendResponse({ ok: false, error: '当前页面不是会话页(URL 中没有会话 ID)' });
        const convId = m[1];
        const orgs = await listOrgIds();
        if (!orgs.length) return sendResponse({ ok: false, error: '无法获取组织 ID(未登录?)' });
        for (const org of orgs.slice(0, 6)) {
          const r = await fetchConvFull(org, convId);
          if (r.ok) {
            send({ kind: 'capture', type: 'conversation', payload: { orgId: org, url: r.url, data: r.data, ts: Date.now() } });
            return sendResponse({ ok: true, convId, name: r.data.name });
          }
        }
        sendResponse({ ok: false, error: '所有组织下都未找到该会话' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
