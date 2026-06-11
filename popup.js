// popup.js
'use strict';

const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);

const TOGGLES = ['enabled', 'autoSave', 'saveAssets', 'refetchFull', 'keepHistory', 'keepStream'];

function toast(kind, text, hold = 2600) {
  const t = $('toast');
  t.className = `toast show ${kind}`;
  t.innerHTML = (kind === 'run' ? '<span class="spin"></span>' : '') + `<span>${text}</span>`;
  if (kind !== 'run') {
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, hold);
  }
}
function clearToast() { $('toast').className = 'toast'; }

function paintSettings(s) {
  for (const k of TOGGLES) if ($(k)) $(k).checked = !!s[k];
  const m = $('master');
  m.classList.toggle('on', !!s.enabled);
  $('masterState').textContent = s.enabled
    ? (s.autoSave ? '运行中 · 自动保存' : '运行中 · 仅手动')
    : '已暂停';
}

function paintState(r) {
  $('sConv').textContent = r.convCount ?? 0;
  $('sFile').textContent = (r.stats && r.stats.fileCount) || 0;
  $('sTrack').textContent = r.tracked ?? 0;

  const cur = r.current;
  const box = $('current');
  if (cur) {
    box.style.display = '';
    const pill = $('curPill');
    if (cur.captured) {
      pill.className = 'pill live';
      pill.textContent = cur.full ? '完整' : '已捕获';
    } else {
      pill.className = 'pill idle';
      pill.textContent = '等待';
    }
    $('curName').textContent = cur.name || '当前对话';
    $('curMeta').textContent = cur.captured
      ? (cur.full ? '思考链与工具调用已就绪' : '基础内容已捕获,发消息或点保存可补全')
      : '在此对话发一条消息即可开始捕获';
  } else {
    box.style.display = 'none';
  }
}

async function paintProgress() {
  const list = $('progressList');
  if (!list) return;
  let prog = {};
  try { prog = (await chrome.storage.local.get('progress')).progress || {}; } catch (e) {}
  const items = Object.values(prog).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12);
  if (!items.length) { list.innerHTML = '<div class="prog-empty">暂无记录,开始抓取后这里显示每个对话的文件保存进度。</div>'; return; }
  list.innerHTML = items.map(p => {
    const total = p.total || 0, saved = Math.min(p.saved || 0, total || p.saved || 0);
    const pct = total ? Math.round(saved / total * 100) : (saved ? 100 : 0);
    const done = total > 0 && saved >= total;
    return `<div class="prog-item ${done ? 'done' : ''}">
      <div class="prog-top"><span class="prog-name">${escHtml(p.name || '未命名对话')}</span>
      <span class="prog-cnt">${saved}/${total || saved} ${done ? '✓' : ''}</span></div>
      <div class="prog-bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
}
function escHtml(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function refresh() {
  try {
    const r = await send({ kind: 'popup:getState' });
    if (r && r.ok) { paintSettings(r.settings); paintState(r); }
    await paintProgress();
  } catch (e) {
    toast('err', '无法连接后台,请重载扩展');
  }
}

// 绑定开关
for (const k of TOGGLES) {
  document.addEventListener('DOMContentLoaded', () => {
    const el = $(k);
    if (!el) return;
    el.addEventListener('change', async () => {
      const r = await send({ kind: 'popup:setSettings', patch: { [k]: el.checked } });
      if (r && r.ok) paintSettings(r.settings);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}

  $('btnSaveCurrent').addEventListener('click', async () => {
    toast('run', '正在抓取当前对话…');
    const r = await send({ kind: 'popup:saveCurrent' });
    if (r && r.ok) {
      toast('ok', `已保存「${r.name || '对话'}」` + (r.files ? ` · ${r.files} 个文件` : ''));
      refresh();
    } else {
      toast('err', r?.error || '保存失败');
    }
  });

  $('btnSaveAll').addEventListener('click', async () => {
    toast('run', '正在保存本次跟踪的全部对话…');
    const r = await send({ kind: 'popup:saveAll' });
    if (r && r.ok) {
      toast('ok', `已保存 ${r.saved} 个对话` + (r.files ? ` · ${r.files} 文件` : ''));
      refresh();
    } else {
      toast('err', r?.error || '操作失败');
    }
  });

  $('btnIndex').addEventListener('click', async () => {
    const r = await send({ kind: 'popup:exportIndex' });
    if (r && r.ok) toast('ok', '索引已导出到 ClaudeArchive/_index.json');
    else toast('err', r?.error || '导出失败');
  });

  $('btnViewer').addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
      window.close();
    } catch (e) {
      toast('err', '无法打开查看器');
    }
  });

  refresh();
});
