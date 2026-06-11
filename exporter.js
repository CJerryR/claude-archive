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
    case 'thinking':
      return [
        '<details>',
        '<summary>🧠 思考过程</summary>',
        '',
        fence(b.thinking ?? b.text ?? ''),
        '',
        '</details>'
      ].join('\n');
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
  const head = [
    '---',
    `title: ${JSON.stringify(d.name ?? '未命名对话')}`,
    `uuid: ${uuid}`,
    `url: https://claude.ai/chat/${uuid}`,
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
// 已知字段优先,再对整份 JSON 做一次正则兜底扫描,兼容字段命名漂移。
export function collectAssets(data, orgId) {
  const out = new Map(); // absUrl -> suggested file name | null
  const add = (u, name) => {
    if (!u || typeof u !== 'string') return;
    if (/thumbnail/i.test(u)) return;
    try {
      const abs = new URL(u, 'https://claude.ai').href;
      if (!out.has(abs)) out.set(abs, name ?? null);
    } catch {}
  };

  for (const m of (data?.chat_messages || [])) {
    for (const a of (m.attachments || [])) {
      add(a.preview_url, a.file_name);
      add(a.file_url, a.file_name);
      add(a.document_url, a.file_name);
    }
    const files = [
      ...(Array.isArray(m.files) ? m.files : []),
      ...(Array.isArray(m.files_v2) ? m.files_v2 : [])
    ];
    for (const f of files) {
      add(f.preview_url, f.file_name);
      add(f.file_url, f.file_name);
      if (f.document && f.document.url) add(f.document.url, f.file_name);
      if (!f.preview_url && !f.file_url && f.file_uuid && orgId) {
        add(`/api/organizations/${orgId}/files/${f.file_uuid}/contents`, f.file_name);
      }
    }
  }

  try {
    const s = JSON.stringify(data);
    const re = /"((?:https:\/\/[a-z0-9.-]+)?\/api\/[^"]*?(?:\/files\/|\/attachments\/)[^"]*?)"/gi;
    let mt;
    while ((mt = re.exec(s))) add(mt[1].replace(/\\\//g, '/'));
  } catch {}

  return out;
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
    try {
      const p = new URL(url, 'https://claude.ai').pathname;
      const seg = p.split('/').filter(Boolean);
      name = seg[seg.length - 1] || 'file';
      // /files/{uuid}/contents 这类路径取 uuid 段更有辨识度
      if (/^(contents|download|preview|document_contents)$/i.test(name) && seg.length >= 2) {
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
