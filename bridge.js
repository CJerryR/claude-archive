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

// 把传入地址(相对或绝对)规整为当前域名下的候选 URL 列表,逐个尝试
function assetCandidates(input) {
  let path = String(input || '').replace(/\\\//g, '/').trim();
  if (!path) return [];
  // 绝对 → 取 path+query;同域直接用,跨域也改挂到当前 origin(中转站通常同源代理)
  const m = path.match(/^https?:\/\/[^/]+(\/.*)$/i);
  if (m) path = m[1];
  if (!path.startsWith('/')) return [location.origin + '/' + path];

  const out = [];
  const push = (p) => { const full = location.origin + p; if (!out.includes(full)) out.push(full); };

  // 文件型:/api/.../files/{uuid}/{variant}  → 依次尝试原图/下载/preview
  const fm = path.match(/^(.*\/files\/[0-9a-f-]{36})(?:\/(\w+))?(\?.*)?$/i);
  if (fm) {
    const base = fm[1];
    const q = fm[3] || '';
    // 全质量优先,preview 兜底(thumbnail 不要)
    for (const v of ['', '/original', '/full', '/contents', '/download', '/preview']) {
      push(base + v + q);
    }
    // 同时保留原始传入的 variant(若不是上面列出的)
    if (fm[2] && !['original','full','contents','download','preview','thumbnail'].includes(fm[2].toLowerCase())) {
      push(base + '/' + fm[2] + q);
    }
    return out;
  }

  // 其它(attachments 等):原样 + 去掉/补一个 contents
  push(path);
  if (!/\/(contents|download)(\?|$)/i.test(path)) push(path.replace(/\/?(\?|$)/, '/contents$1'));
  return out;
}

// 中转站路径为 /api/{org}/...,官方为 /api/organizations/{org}/...;两种都试
function convUrlCandidates(orgId, convId) {
  return [
    `${location.origin}/api/organizations/${orgId}/chat_conversations/${convId}?${FULL_PARAMS}`,
    `${location.origin}/api/${orgId}/chat_conversations/${convId}?${FULL_PARAMS}`
  ];
}

async function fetchConvFull(orgId, convId) {
  for (const u of convUrlCandidates(orgId, convId)) {
    try {
      const r = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.chat_messages)) return { ok: true, orgId, data: j, url: u };
    } catch {}
  }
  return { ok: false, error: 'all conversation endpoints failed' };
}

async function listOrgIds() {
  for (const u of [`${location.origin}/api/organizations`, `${location.origin}/api/bootstrap`]) {
    try {
      const r = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      let ids = [];
      if (Array.isArray(j)) ids = j.map(o => o && o.uuid).filter(Boolean);
      else if (j && Array.isArray(j.organizations)) ids = j.organizations.map(o => o && o.uuid).filter(Boolean);
      else if (j && j.account && Array.isArray(j.account.memberships)) {
        ids = j.account.memberships.map(m => m && m.organization && m.organization.uuid).filter(Boolean);
      }
      if (ids.length) return ids;
    } catch {}
  }
  return [];
}

// ---------- 响应后台请求 ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;

  if (msg.kind === 'ping') { sendResponse({ ok: true }); return; }

  if (msg.kind === 'fetchAsset') {
    (async () => {
      try {
        // msg.url 可能是相对路径(/api/...)或绝对地址;统一按当前真实域名补全
        const tried = [];
        for (const cand of assetCandidates(msg.url)) {
          tried.push(cand);
          let r;
          try { r = await fetch(cand, { credentials: 'include' }); }
          catch { continue; }
          if (!r.ok) continue;
          const ct = r.headers.get('content-type') || '';
          // 命中 HTML 多半是登录页/错误页,不是文件 —— 跳过试下一个候选
          if (/text\/html/i.test(ct)) continue;
          const cd = r.headers.get('content-disposition') || '';
          const buf = await r.arrayBuffer();
          if (buf.byteLength === 0) continue;
          if (buf.byteLength > 48 * 1024 * 1024) {
            return sendResponse({ ok: false, error: 'file too large (>48MB)' });
          }
          return sendResponse({ ok: true, ct, cd, b64: bufToB64(buf), from: cand });
        }
        sendResponse({ ok: false, error: 'no candidate succeeded', tried });
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
