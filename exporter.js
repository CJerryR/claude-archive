// exporter.js — 共享模块(background / viewer 共用)
// 会话 JSON → Markdown / JSON 导出,资源 URL 收集,文件名工具。
'use strict';

export const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';

export function safeName(s, max = 60) {
  s = String(s ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  if (!s) return '';
  return s.length > max ? s.slice(0, max).trim() : s;
}

export function dirFor(conv) {
  const name = safeName(conv?.data?.name ?? conv?.name ?? '') || 'untitled';
  const id = String(conv?.uuid ?? conv?.data?.uuid ?? 'unknown').slice(0, 8);
  return `${name}__${id}`;
}

// 对话辨识码:取 uuid 前 8 位(稳定、可读、足够区分)
export function convHash(conv) {
  return String(conv?.uuid ?? conv?.data?.uuid ?? 'unknown').replace(/[^0-9a-zA-Z-]/g, '').slice(0, 8) || 'unknown';
}
// files 下每个对话独立子目录:files/{对话码}/  —— 即使多对话文件汇到一处也不冲突
export function filesDirFor(conv) {
  return `files/${convHash(conv)}`;
}

// ---------- 活动分支重建 ----------
// tree=True 时 chat_messages 含全部分支;沿 current_leaf_message_uuid 向上走出当前路径。
export function activePath(data) {
  const msgs = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
  const byUuid = new Map(msgs.map(m => [m.uuid, m]));
  const leaf = data?.current_leaf_message_uuid;
  if (leaf && byUuid.has(leaf)) {
    const path = [];
    const seen = new Set();
    let cur = byUuid.get(leaf);
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid);
      path.push(cur);
      cur = byUuid.get(cur.parent_message_uuid);
    }
    path.reverse();
    if (path.length) return { path, total: msgs.length };
  }
  const sorted = [...msgs].sort((a, b) =>
    ((a.index ?? 0) - (b.index ?? 0)) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  );
  return { path: sorted, total: msgs.length };
}

// ---------- Markdown ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// 围栏长度自适应:比内容里最长的反引号串更长,保证任意内容都能安全包裹
function fence(s, lang = '') {
  s = String(s ?? '');
  let t = '```';
  while (s.includes(t)) t += '`';
  return `${t}${lang}\n${s}\n${t}`;
}

const fmtTime = t => {
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); }
  catch { return String(t ?? ''); }
};

const fmtSize = n => {
  n = Number(n) || 0;
  if (!n) return '';
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1024)) + ' KB';
};

function toolResultText(b) {
  const c = b?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(x => (x && x.type === 'text' && typeof x.text === 'string')
      ? x.text
      : JSON.stringify(x, null, 2)
    ).join('\n');
  }
  return JSON.stringify(c ?? b ?? null, null, 2);
}

export function blockToMd(b) {
  switch (b?.type) {
    case 'text':
      return String(b.text ?? '');
    case 'thinking': {
      const sums = Array.isArray(b.summaries) ? b.summaries.map(s => s && s.summary).filter(Boolean) : [];
      const label = sums.length ? sums[sums.length - 1] : '思考过程';
      const stageList = (sums.length > 1 && sums.length <= 3) ? sums.map(s => `- ${s}`).join('\n') + '\n\n' : '';
      return [
        '<details>',
        `<summary>🧠 ${esc(label)}</summary>`,
        '',
        stageList + fence(b.thinking ?? b.text ?? ''),
        '',
        '</details>'
      ].join('\n');
    }
    case 'tool_use':
      return [
        '<details>',
        `<summary>🔧 工具调用 — <b>${esc(b.name ?? 'tool')}</b></summary>`,
        '',
        fence(JSON.stringify(b.input ?? {}, null, 2), 'json'),
        '',
        '</details>'
      ].join('\n');
    case 'tool_result': {
      const tag = b.is_error ? '❌ 工具出错' : '📥 工具结果';
      return [
        '<details>',
        `<summary>${tag} — <b>${esc(b.name ?? 'tool')}</b></summary>`,
        '',
        fence(toolResultText(b)),
        '',
        '</details>'
      ].join('\n');
    }
    default:
      return [
        '<details>',
        `<summary>📦 ${esc(b?.type ?? 'block')}</summary>`,
        '',
        fence(JSON.stringify(b ?? null, null, 2), 'json'),
        '',
        '</details>'
      ].join('\n');
  }
}

export function messageToMd(m) {
  const who = m.sender === 'human' ? '🧑 用户' : '🤖 Claude';
  const lines = [`## ${who} · ${fmtTime(m.created_at)}`, ''];

  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  const files = [
    ...(Array.isArray(m.files) ? m.files : []),
    ...(Array.isArray(m.files_v2) ? m.files_v2 : [])
  ];
  if (atts.length || files.length) {
    for (const a of atts) {
      const meta = [a.file_type, fmtSize(a.file_size)].filter(Boolean).join(', ');
      lines.push(`> 📎 附件:**${a.file_name ?? '未命名'}**${meta ? ` (${meta})` : ''}${a.extracted_content ? ' — 文本内容已捕获' : ''}`);
    }
    for (const f of files) {
      lines.push(`> 🗂 文件:**${f.file_name ?? f.file_uuid ?? '文件'}**${f.file_kind ? ` (${f.file_kind})` : ''}`);
    }
    lines.push('');
  }

  const content = (Array.isArray(m.content) && m.content.length)
    ? m.content
    : (m.text ? [{ type: 'text', text: m.text }] : []);
  for (const b of content) {
    lines.push(blockToMd(b));
    lines.push('');
  }
  return lines.join('\n');
}

export function buildMarkdown(conv) {
  const d = conv?.data || {};
  const { path, total } = activePath(d);
  const uuid = d.uuid ?? conv?.uuid ?? '';
  const origin = (conv?.origin || 'https://claude.ai').replace(/\/$/, '');
  const head = [
    '---',
    `title: ${JSON.stringify(d.name ?? '未命名对话')}`,
    `uuid: ${uuid}`,
    `url: ${origin}/chat/${uuid}`,
    d.model ? `model: ${d.model}` : null,
    `created_at: ${d.created_at ?? ''}`,
    `updated_at: ${d.updated_at ?? ''}`,
    `exported_at: ${new Date().toISOString()}`,
    `messages_active: ${path.length}`,
    `messages_total: ${total}`,
    '---',
    '',
    `# ${d.name ?? '未命名对话'}`,
    ''
  ].filter(x => x !== null);
  const body = path.map(messageToMd).join('\n---\n\n');
  return head.join('\n') + '\n' + body + '\n';
}

export function buildJson(conv) {
  const out = {
    ...(conv?.data || {}),
    _archive: {
      exported_at: new Date().toISOString(),
      org_id: conv?.orgId ?? null,
      full_fetch: !!conv?.full,
      last_request: conv?.lastRequest ?? null,
      last_stream: conv?.lastStream ?? null
    }
  };
  return JSON.stringify(out, null, 2);
}

// ---------- 资源 URL 收集 ----------
// 关键:不在这里补全域名(官方 claude.ai,中转站 claude.hk.cn 等各不同)。
// 返回按"文件"去重的条目:{ key, name, path }。path 是相对路径,
// 由页面端 bridge.js 按 location.origin 补全并展开成多个候选逐个尝试。
export function collectAssets(data, orgId, convId) {
  const byKey = new Map(); // uuid/path/url -> { name, path }
  const norm = (u) => {
    if (!u || typeof u !== 'string') return null;
    u = u.replace(/\\\//g, '/').trim();
    if (!u) return null;
    const m = u.match(/^https?:\/\/[^/]+(\/.*)$/i);
    if (m) u = m[1];
    return u.startsWith('/') ? u : null;
  };
  const uuidOf = (p) => { const m = p && p.match(/\/files\/([0-9a-f-]{36})/i); return m ? m[1].toLowerCase() : null; };
  const pathOf = (p) => { const m = p && p.match(/[?&]path=([^&]+)/i); return m ? decodeURIComponent(m[1]).toLowerCase() : null; };
  const consider = (u, name, msgUuid) => {
    const p = norm(u);
    if (!p) return;
    if (/\/thumbnail(\b|$|\?)/i.test(p)) return; // 缩略图不要
    const fu = uuidOf(p);                 // 文件 uuid(图片类有)
    const key = fu || pathOf(p) || p;     // 同一文件的去重 key
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { name: name || null, path: p, uuid: fu || null, msgUuid: msgUuid || null }); return; }
    if (name && !prev.name) prev.name = name;
    if (fu && !prev.uuid) prev.uuid = fu;
    if (msgUuid && !prev.msgUuid) prev.msgUuid = msgUuid;
    const better = /\/(original|full|contents|download)(\b|$|\?)/i.test(p) && !/\/(original|full|contents|download)(\b|$|\?)/i.test(prev.path);
    if (better) prev.path = p;
  };
  // 非图片文件(file_kind=blob 或有 path 字段,如 docx/json/md/zip)→ wiggle 下载接口
  const considerBlob = (f, name, msgUuid) => {
    const fp = f && typeof f.path === 'string' ? f.path : null;
    if (fp && orgId && convId) {
      consider(`/api/organizations/${orgId}/conversations/${convId}/wiggle/download-file?path=${encodeURIComponent(fp)}`, name, msgUuid);
      return true;
    }
    return false;
  };

  // 生成文件:按"轮次(消息)+ 路径"去重 —— 不同轮次的同名文件视为不同版本,各自保留
  const considerByPath = (fp, name, uuid, round, msgUuid) => {
    if (!fp || typeof fp !== 'string' || !orgId || !convId) return;
    const u = `/api/organizations/${orgId}/conversations/${convId}/wiggle/download-file?path=${encodeURIComponent(fp)}`;
    const p = norm(u);
    if (!p) return;
    const base = fp.split('/').pop() || name || null;  // 真实文件名(带扩展名)
    const key = 'gen:' + (round||'') + ':' + fp.toLowerCase();  // 轮次+路径 为去重键
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { name: base, path: p, uuid: uuid || null, subdir: round || null, round: round || null, msgUuid: msgUuid || null }); return; }
    if (base && !prev.name) prev.name = base;
    if (msgUuid && !prev.msgUuid) prev.msgUuid = msgUuid;
  };

  // 轮次目录名:r{消息序号}_{时分秒}_{uuid8},直观且唯一,保证不同轮次同名文件共存
  const roundOf = (m, idx) => {
    const u8 = String(m.uuid || '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'x';
    let hms = '';
    try { const d = new Date(m.created_at); if (!isNaN(d)) { const p = n => String(n).padStart(2, '0'); hms = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; } } catch {}
    return `r${String(idx).padStart(2, '0')}_${hms || '000000'}_${u8}`;
  };

  const msgArr = data?.chat_messages || [];
  for (let mi = 0; mi < msgArr.length; mi++) {
    const m = msgArr[mi];
    const mu = m.uuid || null;            // 产生这些文件的消息 uuid(版本归属钥匙)
    for (const a of (m.attachments || [])) {
      consider(a.preview_url, a.file_name, mu);
      consider(a.file_url, a.file_name, mu);
      consider(a.document_url, a.file_name, mu);
      considerBlob(a, a.file_name, mu); // 附件带 path 时走 wiggle
      const fid = a.file_uuid || a.id;
      if (!a.preview_url && !a.file_url && !a.document_url && !a.path && fid && orgId) {
        consider(`/api/${orgId}/files/${fid}/preview`, a.file_name, mu);
      }
    }
    const files = [
      ...(Array.isArray(m.files) ? m.files : []),
      ...(Array.isArray(m.files_v2) ? m.files_v2 : [])
    ];
    for (const f of files) {
      const name = f.file_name || f.file_uuid || null;
      const isImage = f.file_kind === 'image' || !!f.preview_url || !!(f.preview_asset && f.preview_asset.url);
      consider(f.preview_url, name, mu);
      if (f.preview_asset && f.preview_asset.url) consider(f.preview_asset.url, name, mu);
      consider(f.file_url, name, mu);
      consider(f.url, name, mu);
      if (f.document && f.document.url) consider(f.document.url, name, mu);
      const gotBlob = !isImage && considerBlob(f, name, mu);
      const fid = f.file_uuid || f.uuid;
      if (fid && orgId && isImage && !f.preview_url && !(f.preview_asset && f.preview_asset.url)) {
        consider(`/api/${orgId}/files/${fid}/preview`, name, mu);
      }
      if (!isImage && !gotBlob && fid && orgId) {
        consider(`/api/${orgId}/files/${fid}/preview`, name, mu);
      }
    }

    // ★ Claude 生成的文件(present_files 的 local_resource):按"轮次"归档,版本共存
    const round = roundOf(m, mi);
    for (const b of (m.content || [])) {
      if (b && b.type === 'tool_result') {
        const c = b.content;
        if (Array.isArray(c)) {
          for (const item of c) {
            if (item && item.type === 'local_resource' && item.file_path) {
              considerByPath(item.file_path, item.name, item.uuid, round, mu);
            }
          }
        }
      }
    }
  }

  // 兜底:扫描整份 JSON 里任何 /api/.../files|attachments|download-file 地址
  try {
    const s = JSON.stringify(data);
    const re = /"((?:https?:\/\/[^"/]+)?\/api\/[^"]*?(?:\/files\/|\/attachments\/|download-file)[^"]*?)"/gi;
    let mt;
    while ((mt = re.exec(s))) consider(mt[1]);
  } catch {}

  // 返回数组:{ path(相对), name(建议名,可空), uuid(文件 uuid,可空) }
  return [...byKey.values()];
}

// 给一批资源分配"文件夹内不冲突"的最终文件名(确定性,可跨次复现)。
// 规则:
//  - 先按 (推断名) 分组;
//  - 组内只有 1 个、或多个但同 uuid(同一文件)→ 用原名;
//  - 组内多个不同 uuid(真正不同的同名文件)→ 加 __{uuid8} 后缀区分;无 uuid 则加序号。
// 入参 assets: [{path,name,uuid}]; nameFor(asset)->推断名(交给调用方,通常用 pickFileName)
export function assignFileNames(assets, nameFor) {
  const groups = new Map(); // baseName -> [asset...]
  for (const a of assets) {
    const nm = nameFor(a);
    a._nm = nm;
    if (!groups.has(nm)) groups.set(nm, []);
    groups.get(nm).push(a);
  }
  const result = new Map(); // path -> finalName
  for (const [nm, arr] of groups) {
    const uuids = new Set(arr.map(a => a.uuid).filter(Boolean));
    const sameFile = arr.every(a => a.uuid && a.uuid === arr[0].uuid); // 全同 uuid = 同一文件
    if (arr.length === 1 || sameFile) {
      for (const a of arr) result.set(a.path, nm);
      continue;
    }
    // 多个不同文件同名 → 加后缀区分
    const dot = nm.lastIndexOf('.');
    const stem = dot > 0 ? nm.slice(0, dot) : nm;
    const ext = dot > 0 ? nm.slice(dot) : '';
    let seq = 0;
    const usedSuffix = new Set();
    for (const a of arr) {
      let suffix;
      if (a.uuid) suffix = a.uuid.slice(0, 8);
      else { seq++; suffix = String(seq); }
      // 防止极端情况后缀也撞
      let cand = `${stem}__${suffix}${ext}`;
      while (usedSuffix.has(cand)) { seq++; cand = `${stem}__${suffix}_${seq}${ext}`; }
      usedSuffix.add(cand);
      result.set(a.path, cand);
    }
  }
  return result; // path -> 最终文件名
}

// 从响应头/建议名/URL 推断文件名,并按 content-type 补扩展名
const EXT_BY_CT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'application/pdf': '.pdf', 'text/plain': '.txt',
  'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'text/html': '.html', 'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx'
};

export function pickFileName(contentDisposition, suggested, url, contentType) {
  let name = '';
  const cd = String(contentDisposition || '');
  let m = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (m) { try { name = decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {} }
  if (!name) {
    m = cd.match(/filename="?([^";]+)"?/i);
    if (m) name = m[1].trim();
  }
  if (!name && suggested) name = String(suggested);
  if (!name) {
    // wiggle 下载:?path=/mnt/.../xxx.docx → 取 basename
    const pm = String(url || '').match(/[?&]path=([^&]+)/i);
    if (pm) {
      try { const dec = decodeURIComponent(pm[1]); name = dec.split('/').filter(Boolean).pop() || ''; } catch {}
    }
  }
  if (!name) {
    try {
      // base 仅用于把相对路径解析出 pathname,域名无关紧要
      const p = new URL(url, 'http://x').pathname;
      const seg = p.split('/').filter(Boolean);
      name = seg[seg.length - 1] || 'file';
      // /files/{uuid}/preview|contents|thumbnail 这类:取 uuid 段更有辨识度
      if (/^(contents|download|preview|thumbnail|document_contents|download-file)$/i.test(name) && seg.length >= 2) {
        name = seg[seg.length - 2];
      }
    } catch { name = 'file'; }
  }
  name = safeName(name, 80) || 'file';
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (EXT_BY_CT[ct]) name += EXT_BY_CT[ct];
  }
  return name;
}

// ── 版本归属:用产生文件的「消息 uuid 前 8 位」作前缀,使不同消息的同名文件天然区分且可精确定位 ──
// 形如 e5f6a7b8__A.webp。msg8 取消息 uuid 前 8 位(十六进制)。
export function msgPrefix(msgUuid) {
  const s = String(msgUuid || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 8).toLowerCase();
  return s.length === 8 ? s : null;
}
export function msgPrefixedName(msgUuid, baseName) {
  const p = msgPrefix(msgUuid);
  return p ? `${p}__${baseName}` : baseName;
}
// 从带前缀的文件名解析出 {msg8, base};无前缀则 msg8=null
export function parsePrefixed(fileName) {
  const m = String(fileName || '').match(/^([0-9a-f]{8})__(.+)$/i);
  return m ? { msg8: m[1].toLowerCase(), base: m[2] } : { msg8: null, base: String(fileName || '') };
}
