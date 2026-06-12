// popup.js
'use strict';

const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);

const TOGGLES = ['enabled', 'autoSave', 'saveAssets', 'refetchFull', 'keepHistory', 'silentDownload', 'keepStream', 'debugLog'];

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

let _allTaskTimer = null;
async function paintAllTask() {
  const box = document.getElementById('allTask');
  if (!box) return;
  let t = null;
  try { t = (await chrome.storage.local.get('allTask')).allTask; } catch (e) {}
  if (!t) { box.style.display = 'none'; return; }
  const pct = t.total ? Math.round((t.done || 0) / t.total * 100) : 0;
  const phase = t.phase === 'check' ? '检查完整性' : '全部下载';
  box.style.display = '';
  box.innerHTML = `${phase} · ${t.done || 0}/${t.total || 0}
    <span class="at-cur">正在处理：${escHtml(t.cur || '')}</span>
    <span class="at-bar"><i style="width:${pct}%"></i></span>`;
}
function startAllTaskPoll() { stopAllTaskPoll(); _allTaskTimer = setInterval(paintAllTask, 700); paintAllTask(); }
function stopAllTaskPoll() { if (_allTaskTimer) { clearInterval(_allTaskTimer); _allTaskTimer = null; } const b = document.getElementById('allTask'); if (b) b.style.display = 'none'; }

async function refresh() {
  try {
    const r = await send({ kind: 'popup:getState' });
    if (r && r.ok) { paintSettings(r.settings); paintState(r); paintBind(r.direct); paintSpeed(r.settings); }
    await paintProgress();
    await paintSites();
  } catch (e) {
    toast('err', '无法连接后台,请重载扩展');
  }
}

// 直写模式绑定状态
function paintBind(d) {
  const bar = $('bindBar'), txt = $('bindTxt'), bBind = $('btnBind'), bScan = $('btnRescan');
  if (!bar) return;
  bar.classList.remove('ok', 'warn');
  const st = d && d.status;
  if (st === 'granted') {
    bar.classList.add('ok');
    txt.textContent = `直写模式:已绑定「${d.name || 'ClaudeArchive'}」· 零下载记录 · 文件夹即跟踪`;
    bBind.style.display = 'none'; bScan.style.display = '';
  } else if (st === 'need-reauth') {
    bar.classList.add('warn');
    txt.textContent = '直写模式:需重新授权(浏览器重启后需确认一次)';
    bBind.style.display = ''; bBind.textContent = '重新授权'; bScan.style.display = 'none';
  } else {
    txt.textContent = '直写模式:未绑定(当前用下载方式保存)';
    bBind.style.display = ''; bBind.textContent = '绑定文件夹'; bScan.style.display = 'none';
  }
}
function paintSpeed(s) {
  const sel = $('maxSpeed'); if (!sel) return;
  sel.value = String(Number(s && s.maxSpeedMBps || 0));
}

// 中转站列表渲染
async function paintSites() {
  const box = $('siteList'); if (!box) return;
  let r; try { r = await send({ kind: 'popup:listSites' }); } catch (e) { return; }
  if (!r || !r.ok) return;
  box.innerHTML = '';
  for (const h of (r.builtin || [])) {
    const row = document.createElement('div'); row.className = 'site-row';
    row.innerHTML = `<span class="host">${h}</span><span class="tag builtin">内置</span>`;
    box.appendChild(row);
  }
  if (!(r.sites || []).length) {
    const e = document.createElement('div'); e.className = 'site-empty'; e.textContent = '还没有添加自定义中转站。';
    box.appendChild(e);
  }
  for (const h of (r.sites || [])) {
    const row = document.createElement('div'); row.className = 'site-row';
    row.innerHTML = `<span class="host">${h}</span><span class="tag">自定义</span><button class="rm" title="移除并撤销权限">✕</button>`;
    row.querySelector('.rm').addEventListener('click', async () => {
      const rr = await send({ kind: 'popup:removeSite', host: h });
      if (rr && rr.ok) { toast('ok', `已移除 ${h}`); paintSites(); }
    });
    box.appendChild(row);
  }
}
// 规范化输入 → host
function hostFromInput(v) {
  let s = String(v || '').trim(); if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).hostname || null; } catch (e) { return null; }
}
async function addSite() {
  const inp = $('siteInput'); if (!inp) return;
  const host = hostFromInput(inp.value);
  if (!host) { toast('err', '请输入有效域名,如 cloudlian.cn'); return; }
  const origin = `https://${host}/*`;
  let granted = false;
  // 权限请求必须在用户手势内直接调用
  try { granted = await chrome.permissions.request({ origins: [origin] }); }
  catch (e) { toast('err', '权限请求失败:' + (e && e.message || e)); return; }
  if (!granted) { toast('err', '未授予该网站权限,无法添加'); return; }
  const r = await send({ kind: 'popup:addSiteGranted', host });
  if (r && r.ok) { inp.value = ''; toast('ok', `已添加 ${r.host},在该站点刷新即可自动存档`); paintSites(); }
  else toast('err', r?.error || '添加失败');
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

  // 绑定/重新授权:打开查看器的绑定引导页(弹窗里直接选目录会因失焦关闭而中断)
  $('btnBind') && $('btnBind').addEventListener('click', () => {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') + '#bind' }); window.close(); } catch {}
  });
  // 从已绑定文件夹重新扫描,恢复跟踪索引
  $('btnRescan') && $('btnRescan').addEventListener('click', async () => {
    toast('run', '正在扫描绑定文件夹…');
    const r = await send({ kind: 'popup:scanFolder' });
    if (r && r.ok) { toast('ok', `扫描完成:发现 ${r.found || 0} 个对话存档(新增 ${r.added || 0})`); refresh(); }
    else toast('err', r?.error === 'need-reauth' ? '需先重新授权文件夹' : (r?.error || '扫描失败'));
  });
  // 抓取限速
  $('maxSpeed') && $('maxSpeed').addEventListener('change', async (e) => {
    const r = await send({ kind: 'popup:setSettings', patch: { maxSpeedMBps: Number(e.target.value) || 0 } });
    if (r && r.ok) toast('ok', Number(e.target.value) ? `限速 ${e.target.value} MB/s` : '已取消限速');
  });
  // GitHub Star / 联系作者
  $('btnStar') && $('btnStar').addEventListener('click', () => {
    try { chrome.tabs.create({ url: 'https://github.com/CJerryR/claude-archive' }); } catch {}
  });
  $('btnMail') && $('btnMail').addEventListener('click', () => {
    try { chrome.tabs.create({ url: 'mailto:2513100@mail.nankai.edu.cn?subject=' + encodeURIComponent('Claude Archive 反馈') }); } catch {}
  });

  // 添加中转站
  $('btnAddSite') && $('btnAddSite').addEventListener('click', addSite);
  $('siteInput') && $('siteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });

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
    toast('run', '正在下载全部已跟踪对话…(会逐个加载,请稍候)');
    startAllTaskPoll();
    const r = await send({ kind: 'popup:saveAll' });
    stopAllTaskPoll();
    if (r && r.ok) {
      toast('ok', `完成 · 保存 ${r.saved}/${r.total} 个对话` + (r.files ? ` · ${r.files} 文件` : '') + (r.failed ? ` · ${r.failed} 个未能加载` : ''));
      refresh();
    } else {
      toast('err', r?.error || '操作失败');
    }
  });

  $('btnCheck').addEventListener('click', async () => {
    toast('run', '正在检查保存完整性…(逐个核对并补下缺失)');
    startAllTaskPoll();
    const r = await send({ kind: 'popup:checkIntegrity' });
    stopAllTaskPoll();
    if (r && r.ok) {
      if (r.note) toast('ok', r.note);
      else if (r.fixed > 0) toast('ok', `检查 ${r.checked} 个对话 · 补下 ${r.fixed} 个缺失文件(${r.convWithMissing} 个对话有缺失)`);
      else toast('ok', `检查完成 · ${r.checked} 个对话都完整,无缺失`);
      refresh();
    } else {
      toast('err', r?.error || '检查失败');
    }
  });

  $('btnIndex').addEventListener('click', async () => {
    const r = await send({ kind: 'popup:exportIndex' });
    if (r && r.ok) toast('ok', '索引已导出到 ClaudeArchive/_index.json');
    else toast('err', r?.error || '导出失败');
  });

  $('btnLog').addEventListener('click', async () => {
    const r = await send({ kind: 'popup:exportLog' });
    if (r && r.ok) toast('ok', `运行日志已导出(${r.count} 条)到 ClaudeArchive/_runlog.txt`);
    else toast('err', r?.error || '没有日志可导出');
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
