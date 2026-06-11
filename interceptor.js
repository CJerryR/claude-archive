// interceptor.js — 运行在页面 MAIN world(document_start)
// 职责:包裹 fetch / XMLHttpRequest,捕获:
//   1. 会话完整 JSON(GET /api/organizations/{org}/chat_conversations/{uuid})
//   2. 生成请求体(POST .../completion 的 prompt、附件、工具列表)
//   3. SSE 流(可选保留原始事件),并在流结束后通知后台做"全参数补全抓取"
// 所有数据经 window.postMessage 交给 bridge.js(隔离世界)转发到 service worker。
(() => {
  'use strict';
  if (window.__claudeArchiveInstalled) return;
  window.__claudeArchiveInstalled = true;

  const ORIGIN = location.origin;
  const CONV_RE = /\/api\/organizations\/([0-9a-f-]{36})\/chat_conversations\/([0-9a-f-]{36})(?:$|[/?#])/i;
  const COMPLETION_RE = /\/chat_conversations\/([0-9a-f-]{36})\/(?:retry_)?completion(?:$|[/?#])/i;
  const ORG_RE = /\/organizations\/([0-9a-f-]{36})\//i;

  // 由 bridge.js 推送的配置(是否保留原始 SSE 流)
  let CFG = { keepStream: false };
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__cca_cfg === true && e.data.cfg) {
      CFG = e.data.cfg;
    }
  });

  const post = (type, payload) => {
    try { window.postMessage({ __cca: true, type, payload }, ORIGIN); } catch {}
  };

  const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

  // ---------- 捕获会话 JSON ----------
  function captureConversation(url, json) {
    if (!json || !Array.isArray(json.chat_messages)) return;
    const m = String(url).match(CONV_RE);
    post('conversation', {
      orgId: m ? m[1] : null,
      url: String(url),
      data: json,
      ts: Date.now()
    });
  }

  // ---------- SSE 流读取 ----------
  async function readSse(res, meta) {
    let events = [];
    let count = 0;
    try {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let curEvent = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line.startsWith('event:')) {
            curEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            count++;
            if (CFG.keepStream) {
              const d = line.slice(5).trim();
              events.push({ event: curEvent, data: safeJson(d) ?? d });
            }
          } else if (line === '') {
            curEvent = null;
          }
        }
      }
    } catch {}
    post('completion_done', {
      orgId: meta.orgId,
      convId: meta.convId,
      eventCount: count,
      events: CFG.keepStream ? events : null,
      ts: Date.now()
    });
  }

  // ---------- fetch 包裹 ----------
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    let url = '';
    let method = 'GET';
    let reqForBody = null;
    try {
      if (typeof input === 'string' || input instanceof URL) {
        url = String(input);
        method = ((init && init.method) || 'GET').toUpperCase();
      } else if (input && typeof input.url === 'string') {
        url = input.url;
        method = (input.method || (init && init.method) || 'GET').toUpperCase();
        reqForBody = input;
      }
    } catch {}

    // 捕获生成请求体(prompt / 附件 / 工具)
    let completionMeta = null;
    try {
      const cm = url.match(COMPLETION_RE);
      if (cm && method === 'POST') {
        const om = url.match(ORG_RE);
        completionMeta = { convId: cm[1], orgId: om ? om[1] : null };
        let bodyText = null;
        if (init && typeof init.body === 'string') bodyText = init.body;
        else if (reqForBody) { try { bodyText = await reqForBody.clone().text(); } catch {} }
        if (bodyText) {
          post('completion_request', {
            ...completionMeta,
            body: safeJson(bodyText) ?? bodyText,
            ts: Date.now()
          });
        }
      }
    } catch {}

    const res = await origFetch.apply(this, arguments);

    try {
      const resUrl = res.url || url;
      if (method === 'GET' && res.ok && CONV_RE.test(resUrl)) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          res.clone().json().then(j => captureConversation(resUrl, j)).catch(() => {});
        }
      }
      if (completionMeta && res.ok && res.body) {
        readSse(res.clone(), completionMeta);
      }
    } catch {}

    return res;
  };

  // ---------- XHR 包裹(兜底) ----------
  try {
    const XP = XMLHttpRequest.prototype;
    const origOpen = XP.open;
    const origSend = XP.send;
    XP.open = function (m, u) {
      try { this.__cca = { m: String(m || 'GET').toUpperCase(), u: String(u || '') }; } catch {}
      return origOpen.apply(this, arguments);
    };
    XP.send = function () {
      const info = this.__cca;
      if (info && info.m === 'GET' && CONV_RE.test(info.u)) {
        this.addEventListener('load', () => {
          try {
            const j = safeJson(this.responseText);
            captureConversation(info.u, j);
          } catch {}
        });
      }
      return origSend.apply(this, arguments);
    };
  } catch {}
})();
