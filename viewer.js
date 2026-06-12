'use strict';
const $ = (s,r=document)=>r.querySelector(s);
const ce = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

const state = { convs:[], byId:new Map(), folders:new Map(), activeId:null, query:'' };

/* ---------- 主题 ---------- */
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  try{ localStorage.setItem('cca_theme', t); }catch{}
}
applyTheme((()=>{ try{ return localStorage.getItem('cca_theme')||'dark'; }catch{ return 'dark'; } })());

/* ---------- Markdown(紧凑实现:标题/列表/引用/表格/代码/行内) ---------- */
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// 在文本里高亮搜索关键词(大小写不敏感),返回已转义 HTML;无 q 时等同 esc
function hlite(text, q){
  const s=String(text==null?'':text);
  if(!q) return esc(s);
  const ql=q.toLowerCase(), sl=s.toLowerCase();
  let out='', i=0;
  while(i<s.length){
    const at=sl.indexOf(ql, i);
    if(at<0){ out+=esc(s.slice(i)); break; }
    out+=esc(s.slice(i, at))+'<mark class="hk">'+esc(s.slice(at, at+ql.length))+'</mark>';
    i=at+ql.length;
  }
  return out;
}
function inlineMd(t){
  // 先抽出行内公式,避免被转义/加粗破坏
  const im=[];
  const keep=(tex)=>{ const i=im.length; im.push(tex); return '\uE002'+i+'\uE002'; };
  t = String(t==null?'':t);
  t = t.replace(/\\\(([\s\S]+?)\\\)/g,(m,x)=>keep(x));
  // $...$ 行内(避开 $$、转义\$、和纯货币如 $5 没有配对的情况由配对正则保证)
  t = t.replace(/(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\$)/g,(m,x)=>keep(x));
  t = esc(t);
  t = t.replace(/`([^`]+)`/g,(m,c)=>'<code>'+c+'</code>');
  t = t.replace(/\*\*([^*]+?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+?)\*(?=[^*\w]|$)/g,'$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 还原行内公式
  t = t.replace(/\uE002(\d+)\uE002/g,(m,n)=>renderMath(im[+n]||'',false));
  return t;
}

/* ---------- 公式渲染(KaTeX,缺失时回退原文) ---------- */
function renderMath(tex, display){
  tex = String(tex==null?'':tex);
  try{
    if(window.katex && window.katex.renderToString){
      return window.katex.renderToString(tex, {displayMode:!!display, throwOnError:false, output:'html'});
    }
  }catch(e){}
  // KaTeX 未加载/出错:保留可读原文
  const cls = display ? 'math-fallback math-block' : 'math-fallback';
  return '<'+(display?'div':'span')+' class="'+cls+'">'+esc((display?'':'')+tex)+'</'+(display?'div':'span')+'>';
}

/* ---------- 代码块:复制按钮 + VSCode Dark+ 高亮 ---------- */
let __cbSeq=0;
function renderCodeBlock(lang, raw){
  const id='cb'+(++__cbSeq);
  window.__codeStore=window.__codeStore||{}; window.__codeStore[id]=raw;
  const langLabel = lang ? esc(lang) : '';
  const highlighted = highlightCode(raw, lang);
  return '<div class="codewrap">'
    + '<div class="codebar"><span class="codelang">'+langLabel+'</span>'
    + '<button class="codecopy" data-cb="'+id+'" title="复制代码">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round"/></svg>'
    + '<span class="copytxt">复制</span></button></div>'
    + '<pre class="md-code"><code>'+highlighted+'</code></pre></div>';
}
// 轻量 VSCode Dark+ 风格 tokenizer(无外部依赖,覆盖常见语言)
function highlightCode(raw, lang){
  const S='\uE100', E='\uE101'; // 占位,避免嵌套替换
  const spans=[];
  const tok=(cls,txt)=>{ spans.push('<span class="tk-'+cls+'">'+txt+'</span>'); return S+(spans.length-1)+E; };
  let s = esc(raw);
  // 注释 // 和 # 和 /* */ ; 字符串 "..." '...' `...` ; 数字 ; 关键字
  // 顺序:先字符串/注释(防止内部被再次染色)
  s = s.replace(/(&quot;[^&\n]*?&quot;|&#39;[^&#\n]*?&#39;|`[^`\n]*?`)/g,(m)=>tok('str',m));
  s = s.replace(/(\/\/[^\n]*|#[^\n]*)/g,(m)=>tok('com',m));
  s = s.replace(/(\/\*[\s\S]*?\*\/)/g,(m)=>tok('com',m));
  // 数字
  s = s.replace(/\b(0x[0-9a-fA-F]+|\d+\.?\d*(?:e[+-]?\d+)?)\b/g,(m)=>tok('num',m));
  // 关键字(通用集合,覆盖 js/py/ts/c/java/go/rust/sh 常见词)
  const KW=/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|yield|def|elif|lambda|pass|with|as|None|True|False|and|or|not|is|print|self|public|private|protected|static|final|int|float|double|char|bool|boolean|string|String|struct|enum|interface|type|fn|let mut|mut|pub|use|impl|match|nil|null|undefined|echo|fi|then|do|done|esac|local|func|package|map|range)\b/g;
  s = s.replace(KW,(m)=>tok('kw',m));
  // 函数名(标识符后紧跟括号)
  s = s.replace(/\b([A-Za-z_]\w*)(?=\s*\()/g,(m)=>tok('fn',m));
  // 还原占位
  s = s.replace(new RegExp(S+'(\\d+)'+E,'g'),(m,n)=>spans[+n]);
  return s;
}
function splitRow(s){ return s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim()); }
function mdToHtml(src){
  src = String(src==null?'':src);
  const code=[];
  // 代码块:捕获语言 + 原始代码,渲染为带复制按钮 + 高亮的容器
  const stash = (lang, c)=>{
    const i=code.length;
    const raw=c.replace(/\s+$/,'');
    code.push(renderCodeBlock(lang, raw));
    return '\uE000'+i+'\uE000';
  };
  src = src.replace(/```([^\n`]*)\n([\s\S]*?)```/g,(m,lang,c)=>stash((lang||'').trim(),c));
  src = src.replace(/~~~([^\n]*)\n([\s\S]*?)~~~/g,(m,lang,c)=>stash((lang||'').trim(),c));

  // 公式:先把 $$...$$(行间)和 \[...\] 抽出占位,避免被 markdown 误伤
  const math=[];
  const mstash=(tex,display)=>{ const i=math.length; math.push({tex,display}); return '\uE001'+i+'\uE001'; };
  src = src.replace(/\$\$([\s\S]+?)\$\$/g,(m,t)=>mstash(t,true));
  src = src.replace(/\\\[([\s\S]+?)\\\]/g,(m,t)=>mstash(t,true));

  const lines = src.split('\n');
  const out=[]; let i=0;
  const blank = s=>/^\s*$/.test(s);
  const isBlockStart = s=>/^\s*(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s)/.test(s) || /^\uE000\d+\uE000\s*$/.test(s) || /^\s*([-*_])\1\1+\s*$/.test(s);
  while(i<lines.length){
    const line = lines[i];
    let m;
    if((m=line.match(/^\uE000(\d+)\uE000\s*$/))){ out.push(code[+m[1]]); i++; continue; }
    if(blank(line)){ i++; continue; }
    if((m=line.match(/^(#{1,6})\s+(.*)$/))){ const n=m[1].length; out.push('<h'+n+'>'+inlineMd(m[2])+'</h'+n+'>'); i++; continue; }
    if(/^\s*([-*_])\1\1+\s*$/.test(line)){ out.push('<hr>'); i++; continue; }
    if(/^\s*>\s?/.test(line)){ const buf=[]; while(i<lines.length && /^\s*>\s?/.test(lines[i])){ buf.push(lines[i].replace(/^\s*>\s?/,'')); i++; } out.push('<blockquote>'+mdToHtml(buf.join('\n'))+'</blockquote>'); continue; }
    if(/\|/.test(line) && i+1<lines.length && /\|/.test(lines[i+1]) && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i+1])){
      const header=splitRow(line); i+=2;
      const rows=[]; while(i<lines.length && /\|/.test(lines[i]) && !blank(lines[i])){ rows.push(splitRow(lines[i])); i++; }
      const th='<tr>'+header.map(c=>'<th>'+inlineMd(c)+'</th>').join('')+'</tr>';
      const tb=rows.map(r=>'<tr>'+r.map(c=>'<td>'+inlineMd(c)+'</td>').join('')+'</tr>').join('');
      out.push('<div class="md-tablewrap"><table class="md-table"><thead>'+th+'</thead><tbody>'+tb+'</tbody></table></div>');
      continue;
    }
    if(/^\s*[-*+]\s+/.test(line)){ const it=[]; while(i<lines.length && /^\s*[-*+]\s+/.test(lines[i])){ it.push(lines[i].replace(/^\s*[-*+]\s+/,'')); i++; } out.push('<ul>'+it.map(x=>'<li>'+inlineMd(x)+'</li>').join('')+'</ul>'); continue; }
    if(/^\s*\d+[.)]\s+/.test(line)){ const it=[]; while(i<lines.length && /^\s*\d+[.)]\s+/.test(lines[i])){ it.push(lines[i].replace(/^\s*\d+[.)]\s+/,'')); i++; } out.push('<ol>'+it.map(x=>'<li>'+inlineMd(x)+'</li>').join('')+'</ol>'); continue; }
    const para=[line]; i++;
    while(i<lines.length && !blank(lines[i]) && !isBlockStart(lines[i])){ para.push(lines[i]); i++; }
    out.push('<p>'+para.map(inlineMd).join('<br>')+'</p>');
  }
  let html = out.join('\n').replace(/\uE000(\d+)\uE000/g,(m,n)=>code[+n]||'');
  // 还原行间公式
  html = html.replace(/\uE001(\d+)\uE001/g,(m,n)=>{ const e=math[+n]; return e?renderMath(e.tex,true):''; });
  return html;
}

/* ---------- 活动分支(沿 current_leaf_message_uuid 回溯) ---------- */
function activePath(data, leafOverride){
  const msgs = Array.isArray(data&&data.chat_messages)?data.chat_messages:[];
  const by = new Map(msgs.map(m=>[m.uuid,m]));
  let leaf = leafOverride && by.has(leafOverride) ? leafOverride : (data && data.current_leaf_message_uuid);
  if(leaf && by.has(leaf)){
    // current_leaf 有时不是最深(后续消息未更新指针);沿"最新的子"继续下钻到真正叶子
    const kids=new Map();
    for(const m of msgs){ const p=m.parent_message_uuid||'__root__'; if(!kids.has(p))kids.set(p,[]); kids.get(p).push(m); }
    for(const arr of kids.values()) arr.sort((a,b)=>((a.index||0)-(b.index||0))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
    const dseen=new Set();
    while(!dseen.has(leaf)){
      dseen.add(leaf);
      const ch=kids.get(leaf);
      if(!ch||!ch.length) break;
      leaf=ch[ch.length-1].uuid; // 最新的子
    }
    const path=[]; const seen=new Set(); let cur=by.get(leaf);
    while(cur && !seen.has(cur.uuid)){ seen.add(cur.uuid); path.push(cur); cur=by.get(cur.parent_message_uuid); }
    path.reverse(); if(path.length) return path;
  }
  return msgs.slice().sort((a,b)=>((a.index||0)-(b.index||0))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
}

/* ---------- 渲染:思考 / 工具(仿 Claude) ---------- */
function preBlock(text){ const p=ce('pre','tool-pre'); p.textContent=String(text==null?'':text); return p; }
function toolResultText(b){
  const c=b&&b.content;
  if(typeof c==='string') return c;
  if(Array.isArray(c)) return c.map(x=>(x&&x.type==='text'&&typeof x.text==='string')?x.text:JSON.stringify(x,null,2)).join('\n');
  return JSON.stringify(c==null?b:c,null,2);
}
function sparkSvg(){ return '<svg class="spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke-linecap="round"/></svg>'; }
/* 时间线图标集(18px 灰描边,贴官方) */
function clockSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3.1 1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
function toolIconSvg(name){
  const n=String(name||'').toLowerCase();
  // 编辑类:铅笔
  if(/str_replace|create_file|^edit|write_file/.test(n)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 19.5l1-3.8L16.2 5a2 2 0 0 1 2.8 2.8L8.3 18.5l-3.8 1z" stroke-linejoin="round"/><path d="M14.5 6.7l2.8 2.8"/></svg>';
  // 读/看/产物:文件
  if(/view|read|file|present|cat\b/.test(n)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13.5 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7.5z" stroke-linejoin="round"/><path d="M13.5 3v4.5H18" stroke-linejoin="round"/></svg>';
  // 终端/脚本
  if(/bash|command|exec|terminal|run|shell|script|python|node/.test(n)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.2" y="4.5" width="17.6" height="15" rx="2.6"/><path d="M7.2 9.2l3 2.8-3 2.8M12.8 15h4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // 搜索/抓取
  if(/search|web|google|fetch|browse|http/.test(n)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="6.6"/><path d="M20.4 20.4L16 16" stroke-linecap="round"/></svg>';
  // 图像/可视化
  if(/image|photo|art|draw|render|visual|chart|diagram/.test(n)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16.5l-4.6-4.6L8 19.4" stroke-linejoin="round"/></svg>';
  // 兜底:方块
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/></svg>';
}
function baseNameOf(p){ const s=String(p==null?'':p); const i=Math.max(s.lastIndexOf('/'),s.lastIndexOf('\\')); return i>=0?s.slice(i+1):s; }
// 编辑徽章:文件名 + +新增行 -删除行(create_file 全为新增;str_replace 按 new/old 行数)
function editBadge(use){
  if(!use||!use.input) return null;
  const n=String(use.name||'').toLowerCase(), inp=use.input;
  const lines=s=>{ s=String(s==null?'':s); return s===''?0:s.split('\n').length; };
  if(n==='create_file'&&typeof inp.file_text==='string') return { file:baseNameOf(inp.path), add:lines(inp.file_text), del:0 };
  if(n==='str_replace') return { file:baseNameOf(inp.path), add:lines(inp.new_str), del:lines(inp.old_str) };
  if(/bash|script|command|shell/.test(n)) return { script:true };
  return null;
}
function thinkBlock(text){
  const d=ce('details','think');
  const s=ce('summary'); s.innerHTML=sparkSvg()+'<span>思考过程</span><span class="chev"></span>';
  d.appendChild(s);
  const body=ce('div','think-body'); body.innerHTML=mdToHtml(text||'');
  d.appendChild(body);
  return d;
}
function lbl(text,gap){ return ce('div','lbl'+(gap?' gap':''),esc(text)); }
function proseBox(text){ const d=ce('div','tool-prose'); d.innerHTML=mdToHtml(text||''); return d; }
function looksJson(s){ s=String(s==null?'':s).trim(); if(!(s[0]==='{'||s[0]==='[')) return false; try{ JSON.parse(s); return true; }catch{ return false; } }
function prettyJson(s){ try{ return JSON.stringify(JSON.parse(String(s)), null, 2); }catch{ return String(s==null?'':s); } }
function resultNode(b){
  const txt=toolResultText(b);
  if(looksJson(txt)) return preBlock(prettyJson(txt)); // 重新美化,中文正常显示
  return proseBox(txt);
}
function toolCard(name,kindLabel,bodyNodes,isErr){
  const d=ce('details','toolcard'+(isErr?' err':''));
  const s=ce('summary');
  s.innerHTML='<span class="tool-ic">'+toolIconSvg(name)+'</span>'+
    '<span class="tool-meta"><div class="tool-name">'+esc(name||'tool')+'</div><div class="tool-kind">'+esc(kindLabel)+'</div></span>'+
    '<span class="tool-chev"></span>';
  d.appendChild(s);
  const body=ce('div','tool-body');
  bodyNodes.forEach(n=>body.appendChild(n));
  d.appendChild(body);
  return d;
}
function blockEl(b){
  const t = b && b.type;
  if(t==='text' || (!t && typeof (b&&b.text)==='string')){ const d=ce('div','md'); d.innerHTML=mdToHtml(b.text||''); return d; }
  if(t==='thinking') return thinkBlock(b.thinking||b.text||'');
  if(t==='tool_use'){
    return toolCard(b.name||'工具','调用工具',[ lbl('请求参数'), preBlock(JSON.stringify(b.input||{},null,2)) ],false);
  }
  if(t==='tool_result'){
    return toolCard(b.name||'工具', b.is_error?'工具出错':'工具结果',
      [ lbl(b.is_error?'返回(错误)':'返回结果'), resultNode(b) ], !!b.is_error);
  }
  return toolCard(t||'block','原始数据',[ preBlock(JSON.stringify(b,null,2)) ],false);
}

/* ---------- 过程时间线(仿 Claude:思考标签 + 内嵌工具) ---------- */
function nodeIcon(kind,name){
  if(kind==='think') return sparkSvg();
  return toolIconSvg(name);
}
// 取 thinking 块的摘要(Claude 标签);返回 {tags:[...], text}
function thinkInfo(block){
  const text = (block && (block.thinking || block.text)) || '';
  const tags = (block && Array.isArray(block.summaries))
    ? block.summaries.map(s => s && s.summary).filter(Boolean)
    : [];
  return { tags, text, cutOff: !!(block && block.cut_off) };
}
function stepThink(block){
  const { text } = thinkInfo(block);
  // 像官方:思考正文直接平铺在时间线上(时钟图标),不再藏进二级折叠
  const d=ce('div','step s-think');
  d.innerHTML='<span class="node">'+clockSvg()+'</span>';
  const wrap=ce('div','tk-wrap');
  const tk=ce('div','tk-text'); tk.innerHTML=mdToHtml(text||'');
  wrap.appendChild(tk);
  // 长思考:超过约 12 行时渐隐 + 「显示更多」
  if((text||'').length>700 || (text||'').split('\n').length>14){
    wrap.classList.add('clamp');
    const btn=ce('button','showmore'); btn.type='button'; btn.textContent='显示更多';
    btn.addEventListener('click',()=>{ const c=wrap.classList.toggle('clamp'); btn.textContent=c?'显示更多':'收起'; });
    d.appendChild(wrap); d.appendChild(btn);
    return d;
  }
  d.appendChild(wrap);
  return d;
}
function stepTool(use, result){
  const name=(use&&use.name)||(result&&result.name)||'工具';
  const isErr=!!(result&&result.is_error);
  // 标题:优先 message(官方思考链每步的动作描述);占位/缺失时给中文兜底
  let title=(use&&use.message)||(result&&result.message)||'';
  if(!title || /^Generat(ing|ed)\b/i.test(title) || title===name){
    const n=String(name).toLowerCase();
    const p=use&&use.input&&(use.input.path||use.input.file_path||use.input.url)||'';
    if(/str_replace/.test(n)) title='编辑 '+baseNameOf(p);
    else if(/create_file/.test(n)) title='创建 '+baseNameOf(p);
    else if(/view|read/.test(n)) title=p?'查看 '+baseNameOf(p):'查看文件';
    else if(/bash|shell|command/.test(n)) title='运行命令';
    else if(/web_search/.test(n)) title='搜索网页';
    else if(/web_fetch/.test(n)) title='抓取网页';
    else if(/present/.test(n)) title='输出文件';
    else title='';
  }
  const d=ce('details','step s-tool'+(isErr?' s-err':''));
  const s=ce('summary');
  // 徽章:编辑 → 文件名 + +增 -删;脚本 → Script
  const b=editBadge(use);
  let badges='';
  if(b){
    if(b.script) badges='<div class="t-badges"><span class="t-badge">Script</span></div>';
    else badges='<div class="t-badges"><span class="t-badge">'+esc(b.file||'')+'</span>'
      +(b.add>0?'<span class="t-add">+'+b.add+'</span>':'')
      +(b.del>0?'<span class="t-del">-'+b.del+'</span>':'')+'</div>';
  }
  const titleHtml=title?esc(title):'<b>'+esc(name)+'</b>';
  s.innerHTML='<span class="node">'+toolIconSvg(name)+'</span>'+
    '<div class="t-main"><div class="t-title">'+titleHtml+'</div>'+badges+'</div>';
  d.appendChild(s);
  const body=ce('div','step-body');
  if(use){ body.appendChild(lbl('请求参数')); body.appendChild(toolInputNode(use)); }
  if(result){
    const isE=!!result.is_error;
    body.appendChild(lbl(isE?'返回(错误)':'返回结果', !!use));
    body.appendChild(resultNode(result));
  }
  d.appendChild(body);
  return d;
}
// 工具请求参数:若 display_content 带 json_block(语言+代码)则按代码块高亮渲染,否则美化 input
function toolInputNode(use){
  const dc=use && use.display_content;
  if(dc && dc.type==='json_block' && typeof dc.json_block==='string'){
    try{ const o=JSON.parse(dc.json_block); if(o && typeof o.code==='string'){ const wrap=ce('div'); wrap.innerHTML=renderCodeBlock(o.language||'',o.code); return wrap.firstChild; } }catch(e){}
  }
  return preBlock(JSON.stringify(use.input||{},null,2));
}
function processTimeline(steps){
  // steps: [{kind:'think',block} | {kind:'tool',use,result}]
  // 头部标签:优先用 thinking 的最后一条 summary(Claude 的"在做什么");
  // 若思考块没有 summary,则回退用第一个工具步骤的 message(动作描述);再无则计数。
  const labels=[];
  for(const st of steps){
    if(st.kind==='think'){
      const { tags } = thinkInfo(st.block);
      if(tags.length) labels.push(tags[tags.length-1]);
    }
  }
  const toolSteps=steps.filter(s=>s.kind==='tool');
  const nTool=toolSteps.length;
  const firstToolMsg=(()=>{
    for(const st of toolSteps){
      const msg=(st.use&&st.use.message)||(st.result&&st.result.message)||'';
      if(msg && !/^Generat(ing|ed)\b/i.test(msg)) return msg;
    }
    return '';
  })();
  let head;
  if(labels.length){
    head = esc(labels[labels.length-1]);
  } else if(firstToolMsg){
    head = esc(firstToolMsg);
  } else {
    head = '思考过程';
  }

  const d=ce('details','process');
  const s=ce('summary');
  s.innerHTML='<span class="ptitle">'+head+'</span><span class="chev"></span>';
  d.appendChild(s);
  const wrap=ce('div','steps');
  steps.forEach(st=>{
    if(st.kind==='think') wrap.appendChild(stepThink(st.block));
    else wrap.appendChild(stepTool(st.use, st.result));
  });
  d.appendChild(wrap);
  return d;
}
// 把一条消息的 content 分组:连续的 thinking/tool 收进时间线,text 作为普通 prose
function renderAssistantContent(content, container){
  let i=0;
  while(i<content.length){
    const b=content[i];
    const t=b&&b.type;
    if(t==='thinking'||t==='tool_use'||t==='tool_result'){
      const steps=[];
      while(i<content.length){
        const c=content[i], ct=c&&c.type;
        if(ct==='thinking'){ steps.push({kind:'think', block:c}); i++; }
        else if(ct==='tool_use'){
          const nxt=content[i+1];
          if(nxt && nxt.type==='tool_result'){ steps.push({kind:'tool',use:c,result:nxt}); i+=2; }
          else { steps.push({kind:'tool',use:c,result:null}); i++; }
        }
        else if(ct==='tool_result'){ steps.push({kind:'tool',use:null,result:c}); i++; }
        else break;
      }
      if(steps.length) container.appendChild(processTimeline(steps));
    } else {
      // text / 其它
      container.appendChild(blockEl(b));
      i++;
    }
  }
}

/* ---------- 资源解析(把 files/ 里的文件映射成可点链接/图片) ---------- */
const _urls=new Map();
function objUrl(f){ if(_urls.has(f))return _urls.get(f); const u=URL.createObjectURL(f); _urls.set(f,u); return u; }
function resolveAsset(conv, filename, uuid, subdir, msgUuid){
  if(!conv) return null;
  const e = state.folders.get(conv._folder); if(!e||!e.files) return null;
  const entries=[...e.files]; // [relName, File]
  const base=(n)=>n.split('/').pop();
  const inSub=(n)=> subdir ? (n===subdir+'/'+base(n) || n.startsWith(subdir+'/') || n.includes('/'+subdir+'/')) : true;
  // ★ 最优先:用「消息 uuid8 前缀」精确定位版本(新存档命名 = <msg8>__<原名>)
  //   这样点 12:00 的消息命中 12:00 那条产出,点 13:00 命中 13:00 那条,绝不串版本。
  const m8 = String(msgUuid||'').replace(/[^0-9a-fA-F]/g,'').slice(0,8).toLowerCase();
  if(m8 && m8.length===8 && filename){
    const want = (m8+'__'+String(filename)).toLowerCase();
    // 完整名(含可能的 __vN 兜底):先精确,再带后缀
    for(const [n,f] of entries){ if(base(n).toLowerCase()===want) return objUrl(f); }
    const fn=String(filename); const dot=fn.lastIndexOf('.');
    const stem=(dot>0?fn.slice(0,dot):fn).toLowerCase(); const ext=(dot>0?fn.slice(dot):'').toLowerCase();
    const pfxStem=(m8+'__'+stem);
    for(const [n,f] of entries){ const b=base(n).toLowerCase(); if(b===pfxStem+ext || b.startsWith(pfxStem+'__')) return objUrl(f); }
    // 该消息前缀下、扩展名一致的唯一文件(原名兜底)
    for(const [n,f] of entries){ const b=base(n).toLowerCase(); if(b.startsWith(m8+'__') && (!ext||b.endsWith(ext))) return objUrl(f); }
  }
  // 0) 若指定了轮次子目录:优先在该子目录里精确匹配文件名(每轮打开自己的文件)
  if(subdir && filename){
    const want=String(filename).toLowerCase();
    for(const [n,f] of entries){ if(inSub(n) && base(n).toLowerCase()===want) return objUrl(f); }
    // 子目录内 + uuid
    if(uuid){ const u8=String(uuid).slice(0,8).toLowerCase(); for(const [n,f] of entries){ if(inSub(n) && base(n).toLowerCase().includes(u8)) return objUrl(f); } }
    // 子目录内 + 同名主干
    const fn=String(filename); const dot=fn.lastIndexOf('.'); const stem=(dot>0?fn.slice(0,dot):fn).toLowerCase(); const ext=(dot>0?fn.slice(dot):'').toLowerCase();
    for(const [n,f] of entries){ if(!inSub(n))continue; const b=base(n).toLowerCase(); if(b===stem+ext||b.startsWith(stem+'__')) return objUrl(f); }
  }
  // 1) 文件名精确匹配(全局)
  if(filename){
    const want=String(filename).toLowerCase();
    for(const [n,f] of entries){ if(base(n).toLowerCase()===want) return objUrl(f); }
  }
  // 2) 按 uuid 短码匹配(去重命名会插入 __{uuid8})
  if(uuid){
    const u8=String(uuid).slice(0,8).toLowerCase();
    for(const [n,f] of entries){ if(base(n).toLowerCase().includes('__'+u8)) return objUrl(f); }
    for(const [n,f] of entries){ if(base(n).toLowerCase().includes(u8)) return objUrl(f); }
  }
  // 3) 同名主干 + 任意后缀(stem__xxx.ext)
  if(filename){
    const fn=String(filename); const dot=fn.lastIndexOf('.');
    const stem=(dot>0?fn.slice(0,dot):fn).toLowerCase();
    const ext=(dot>0?fn.slice(dot):'').toLowerCase();
    for(const [n,f] of entries){
      const b=base(n).toLowerCase();
      if(b===stem+ext) return objUrl(f);
      if(b.startsWith(stem+'__') && (!ext||b.endsWith(ext))) return objUrl(f);
    }
  }
  return null;
}
const DL_ICON='<svg class="cdl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12M7 11l5 4 5-4M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FILE_ICON='<svg class="cfile" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 3v5h5M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke-linejoin="round"/></svg>';
function blobUrlFor(text,key){
  if(_urls.has(key)) return _urls.get(key);
  const u=URL.createObjectURL(new Blob([String(text==null?'':text)],{type:'text/plain;charset=utf-8'}));
  _urls.set(key,u); return u;
}
function makeChip(obj, conv){
  const name = obj.file_name || obj.file_uuid || '文件';
  const uuid = obj.file_uuid || obj.uuid || null;
  const url = resolveAsset(conv, obj.file_name, uuid, obj._subdir||null, obj._msg||null);
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);

  // 独立下载按钮(右键/点击图标才下载),不影响主点击
  const dlBtn = (href, fname) => {
    const a=ce('a','chip-dl'); a.href=href; a.download=fname; a.title='下载';
    a.innerHTML=DL_ICON;
    a.addEventListener('click', e=>e.stopPropagation());
    return a;
  };

  // 图片:缩略图,点击开灯箱预览(不下载),右下角小下载按钮
  if(url && isImg){
    const wrap=ce('div','chip chip-img');
    const img=ce('img'); img.src=url; img.alt=name;
    img.addEventListener('click', ()=>openLightbox(url, name));
    wrap.appendChild(img);
    const cap=ce('div','cap');
    cap.appendChild(ce('span','cname',esc(name)));
    cap.appendChild(dlBtn(url, name));
    wrap.appendChild(cap);
    return wrap;
  }
  // 其它已存在的文件:点击预览(可视类型新标签打开;不可视如 zip/docx 也尝试新标签,浏览器自行处理),旁边独立下载
  if(url){
    const viewable=/\.(pdf|html?|txt|json|csv|md|svg)$/i.test(name);
    const wrap=ce('div','chip chip-file');
    const open=ce('a','chip-open'); open.href=url;
    open.target='_blank'; open.rel='noopener';
    open.title = viewable ? '点击打开预览' : '点击打开(浏览器可能直接下载此类型)';
    open.innerHTML=FILE_ICON+'<span class="cname">'+esc(name)+'</span>';
    wrap.appendChild(open);
    wrap.appendChild(dlBtn(url, name));
    return wrap;
  }
  // 仅有提取文本(上传文档无实际文件)→ 预览文本 + 下载 .txt
  const text = (typeof obj.extracted_content==='string' && obj.extracted_content) ? obj.extracted_content
             : (obj.file_kind==='text' && typeof obj.content==='string' ? obj.content : null);
  if(text){
    const href=blobUrlFor(text, conv._folder+'|'+name);
    const wrap=ce('div','chip chip-file');
    const open=ce('a','chip-open'); open.href=href; open.target='_blank'; open.rel='noopener'; open.title='点击查看提取的文本';
    open.innerHTML=FILE_ICON+'<span class="cname">'+esc(name)+' (文本)</span>';
    wrap.appendChild(open);
    wrap.appendChild(dlBtn(href, (String(name).replace(/\.[^.]+$/,'')||name)+'.txt'));
    return wrap;
  }
  // 文件未抓到本地:灰色标签 + 提示
  const span=ce('span','chip chip-missing'); span.title='此文件未保存到本地(用扩展重新抓取该对话即可)';
  span.innerHTML=FILE_ICON+'<span class="cname">'+esc(name)+'</span>';
  return span;
}

/* ---------- 图片灯箱预览 ---------- */
function openLightbox(url, name){
  let box=document.getElementById('cca-lightbox');
  if(!box){
    box=ce('div'); box.id='cca-lightbox';
    box.addEventListener('click', ()=>{ box.style.display='none'; box.innerHTML=''; });
    document.body.appendChild(box);
  }
  box.innerHTML='';
  const img=ce('img'); img.src=url; img.alt=name||'';
  const cap=ce('div','lb-cap'); cap.textContent=name||'';
  const dl=ce('a','lb-dl'); dl.href=url; dl.download=name||'image'; dl.textContent='下载'; dl.addEventListener('click',e=>e.stopPropagation());
  box.appendChild(img); box.appendChild(cap); box.appendChild(dl);
  box.style.display='flex';
}

/* ---------- 状态徽标(打断 / 工具上限) ---------- */
function statusBadge(stopReason){
  if(stopReason==='user_canceled'){
    const d=ce('div','statusbar cancel');
    d.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6" stroke-linecap="round"/></svg><span>此回复被你打断,未生成完整</span>';
    return d;
  }
  if(stopReason==='tool_use_limit' || stopReason==='max_tokens'){
    const d=ce('div','statusbar limit');
    const txt = stopReason==='max_tokens' ? '已达到本次回复长度上限' : '已达到工具调用次数上限,回复在此暂停';
    d.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8v5M12 16h.01M10.3 3.9 2.4 18a1.8 1.8 0 0 0 1.6 2.7h16a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a1.8 1.8 0 0 0-3.1 0z" stroke-linejoin="round"/></svg><span>'+txt+'</span>';
    return d;
  }
  return null;
}

/* ---------- 分支(同一父节点下的多个兄弟)---------- */
// 合并多份同一对话的 JSON:按 uuid 去重(取信息更全者),保留全部分支,leaf 用最新版
function mergeConversations(datas){
  if(datas.length===1) return datas[0];
  const sorted=datas.slice().sort((x,y)=>String(y.updated_at||'').localeCompare(String(x.updated_at||'')));
  const newest=sorted[0];
  const score=(m)=>{
    let s=(Array.isArray(m.content)?m.content.length:0)*10;
    s+=JSON.stringify(m).length/1000;
    if(m.stop_reason && m.stop_reason!=='user_canceled') s+=5; // 完成的优于被打断的
    return s;
  };
  const byUuid=new Map();
  for(const d of sorted){
    for(const m of (d.chat_messages||[])){
      const prev=byUuid.get(m.uuid);
      if(!prev || score(m)>score(prev)) byUuid.set(m.uuid, m);
    }
  }
  return {
    ...newest,
    chat_messages:[...byUuid.values()],
    current_leaf_message_uuid:newest.current_leaf_message_uuid,
    _archive:{...(newest._archive||{}), merged_from:datas.length}
  };
}
function buildChildMap(data){
  const msgs=Array.isArray(data&&data.chat_messages)?data.chat_messages:[];
  const kids=new Map();
  for(const m of msgs){
    const p=m.parent_message_uuid||'__root__';
    if(!kids.has(p)) kids.set(p,[]);
    kids.get(p).push(m);
  }
  for(const arr of kids.values()){
    arr.sort((a,b)=>((a.index||0)-(b.index||0))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
  }
  return kids;
}
// 取某节点子树里"最新"的叶子(沿 created_at 最大的子一路向下),用于切换分支后定位 leaf
function deepestLeaf(data, startUuid){
  const kids=buildChildMap(data);
  let cur=startUuid;
  for(;;){
    const ch=kids.get(cur);
    if(!ch||!ch.length) return cur;
    cur=ch[ch.length-1].uuid; // 最新的子
  }
}
function branchSwitcher(sibs, curUuid, conv){
  if(!sibs || sibs.length<2) return null;
  const idx=sibs.findIndex(s=>s.uuid===curUuid);
  const bar=ce('div','branchbar');
  const wrap=ce('div','bb');
  const prev=ce('button','barrow'); prev.title='上一个分支';
  prev.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const next=ce('button','barrow'); next.title='下一个分支';
  next.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const cnt=ce('span','bcount', (idx+1)+' / '+sibs.length);
  if(idx<=0) prev.disabled=true;
  if(idx>=sibs.length-1) next.disabled=true;
  const go=(targetUuid)=>{ conv._leaf = deepestLeaf(conv.data, targetUuid); renderThread({focusUuid: targetUuid}); };
  prev.addEventListener('click',(e)=>{ e.stopPropagation(); if(idx>0) go(sibs[idx-1].uuid); });
  next.addEventListener('click',(e)=>{ e.stopPropagation(); if(idx<sibs.length-1) go(sibs[idx+1].uuid); });
  wrap.appendChild(prev); wrap.appendChild(cnt); wrap.appendChild(next);
  bar.appendChild(wrap);
  return bar;
}

/* ---------- 渲染:单条消息 ---------- */
// 轮次目录名,需与扩展 exporter.roundOf 完全一致:r{序号}_{时分秒}_{uuid8}
function roundTagFor(m, idx){
  if(idx==null || idx<0) return null;
  const u8=String(m&&m.uuid||'').replace(/[^0-9a-zA-Z]/g,'').slice(0,8)||'x';
  let hms='';
  try{ const d=new Date(m.created_at); if(!isNaN(d)){ const p=n=>String(n).padStart(2,'0'); hms=`${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; } }catch(e){}
  return `r${String(idx).padStart(2,'0')}_${hms||'000000'}_${u8}`;
}
function messageEl(m, conv, sibs){
  const row=ce('div','msg '+(m.sender==='human'?'human':'assistant'));
  const inner=ce('div','msg-inner');

  // 分支切换器(该消息在父节点下有多个兄弟时)
  const bs=branchSwitcher(sibs, m.uuid, conv);
  if(bs) inner.appendChild(bs);

  const atts=Array.isArray(m.attachments)?m.attachments:[];
  const files=[].concat(Array.isArray(m.files)?m.files:[], Array.isArray(m.files_v2)?m.files_v2:[]).map(f=>{ if(f && !f._msg) f._msg=m.uuid||null; return f; });

  // Claude 生成的文件:藏在 present_files 等工具结果的 local_resource 里(m.files 常为空)
  // 兼容旧存档(轮次目录)同时支持新存档(对话级 + 版本化命名):传 round 仅作"优先尝试",
  // resolveAsset 找不到会回退到按文件名(含 __vN 版本)匹配。
  const mIdx = (conv.data && Array.isArray(conv.data.chat_messages)) ? conv.data.chat_messages.indexOf(m) : -1;
  const roundTag = roundTagFor(m, mIdx);
  const genFiles=[];
  for(const b of (Array.isArray(m.content)?m.content:[])){
    if(b && b.type==='tool_result' && Array.isArray(b.content)){
      for(const item of b.content){
        if(item && item.type==='local_resource' && item.file_path){
          const nm=item.name && /\.[a-z0-9]{1,8}$/i.test(item.name) ? item.name : (item.file_path.split('/').pop()||item.name||'文件');
          genFiles.push({ file_name:nm, file_uuid:item.uuid||null, _path:item.file_path, _subdir:roundTag, _msg:m.uuid||null });
        }
      }
    }
  }
  // 去重(同 path 只显示一次,保留最后一个)
  const seenPath=new Set(); const genUniq=[];
  for(let i=genFiles.length-1;i>=0;i--){ const p=genFiles[i]._path; if(!seenPath.has(p)){ seenPath.add(p); genUniq.unshift(genFiles[i]); } }

  // 用户上传的附件 → 放消息顶部(它们是输入)
  if(atts.length){
    const c=ce('div','chips'); atts.forEach(a=>{ a._msg=a._msg||m.uuid||null; c.appendChild(makeChip(a,conv)); }); inner.appendChild(c);
  }

  const content=(Array.isArray(m.content)&&m.content.length)?m.content:(m.text?[{type:'text',text:m.text}]:[]);
  if(m.sender==='human'){
    content.forEach(b=>inner.appendChild(blockEl(b)));
  } else {
    renderAssistantContent(content, inner);
  }

  // 生成 / 关联的文件 → 放消息末尾(m.files + present_files 产出)
  const allOut=[...files, ...genUniq];
  if(allOut.length){
    const c=ce('div','chips'); c.style.marginTop='6px';
    const lbl=ce('div','chips-label','Claude 生成的文件'); c.appendChild(lbl);
    allOut.forEach(f=>c.appendChild(makeChip(f,conv)));
    inner.appendChild(c);
  }

  // 状态徽标:打断 / 工具上限(放消息末尾)
  const badge=statusBadge(m.stop_reason);
  if(badge) inner.appendChild(badge);

  // 消息页脚:左下角显示最后更新时间(时:分:秒)+ 本条 Claude 思考用时
  const foot=ce('div','msg-foot');
  const parts=[];
  const ts=m.updated_at || m.created_at;
  if(ts){ parts.push('<span class="mf-time">'+esc(fmtClock(ts))+'</span>'); }
  if(m.sender!=='human'){
    const think=msgThinkMs(m);
    if(think>0) parts.push('<span class="mf-think">'+sparkSvgSmall()+' 思考 '+esc(fmtDur(think))+'</span>');
  }
  if(parts.length){ foot.innerHTML=parts.join('<span class="mf-dot">·</span>'); inner.appendChild(foot); }

  row.appendChild(inner);
  return row;
}

/* ---------- 时间/时长工具 ---------- */
function fmtClock(ts){ // 显示到 时:分:秒
  try{ const d=new Date(ts); if(isNaN(d)) return ''; 
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }catch(e){ return ''; }
}
function fmtDur(ms){
  if(!ms||ms<0) return '0秒';
  const s=Math.round(ms/1000);
  if(s<60) return s+'秒';
  const m=Math.floor(s/60), ss=s%60;
  if(m<60) return ss?`${m}分${ss}秒`:`${m}分`;
  const h=Math.floor(m/60), mm=m%60;
  return `${h}时${mm}分`;
}
// 一条 assistant 消息的"思考用时" = 各 thinking 块 (stop-start) 之和
function msgThinkMs(m){
  let total=0;
  for(const b of (Array.isArray(m.content)?m.content:[])){
    if(b && b.type==='thinking' && b.start_timestamp && b.stop_timestamp){
      const a=new Date(b.start_timestamp), z=new Date(b.stop_timestamp);
      if(!isNaN(a)&&!isNaN(z)&&z>=a) total+=(z-a);
    }
  }
  return total;
}
function sparkSvgSmall(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px;vertical-align:-1px"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke-linecap="round"/></svg>'; }

/* ---------- 渲染:对话线程 ---------- */
function renderThread(opts){
  const conv=state.byId.get(state.activeId);
  const thread=$('#thread'); thread.innerHTML='';
  if(!conv){ thread.appendChild(emptyState()); $('#topTitle').textContent=''; $('#topModel').textContent=''; return; }
  $('#topTitle').textContent=conv.name||'未命名对话';
  $('#topModel').textContent=conv.model||'';
  const mb=$('#topMerged');
  if(mb){
    if(conv._mergedFrom>1){ mb.style.display=''; mb.textContent='已合并 '+conv._mergedFrom+' 版·去重'; }
    else mb.style.display='none';
  }
  const wrap=ce('div','thread-inner');
  const kids=buildChildMap(conv.data);
  const path=activePath(conv.data, conv._leaf);
  let focusEl=null;
  for(const m of path){
    const sibs=kids.get(m.parent_message_uuid||'__root__')||[];
    const el=messageEl(m, conv, sibs);
    if(opts && opts.focusUuid && m.uuid===opts.focusUuid) focusEl=el;
    wrap.appendChild(el);
  }
  thread.appendChild(wrap);
  // 定位:切换分支时滚到该分支消息;否则(打开对话)滚到最新一条(底部),与 Claude 网页一致
  requestAnimationFrame(()=>{
    if(focusEl){
      focusEl.scrollIntoView({block:'center'});
      if(opts && opts.flash){ focusEl.classList.add('flash'); setTimeout(()=>focusEl.classList.remove('flash'),1900); }
    }
    else { thread.scrollTop = thread.scrollHeight; }
  });
}

/* ---------- 渲染:侧栏(按日期分组) ---------- */
function bucket(ts){
  const d=new Date(ts); if(isNaN(d)) return '未知日期';
  const now=new Date();
  const sod=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const diff=Math.round((sod-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  if(diff<=0) return '今天';
  if(diff===1) return '昨天';
  if(diff<7) return '过去 7 天';
  if(diff<30) return '过去 30 天';
  return d.getFullYear()+' 年 '+(d.getMonth()+1)+' 月';
}
function renderSidebar(){
  const list=$('#convList'); list.innerHTML='';
  let convs=state.convs.slice();
  const q=state.query.trim().toLowerCase();
  if(q) convs=convs.filter(c=>(c.name||'').toLowerCase().includes(q));
  convs.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  if(!convs.length){ list.appendChild(ce('div','side-empty',state.convs.length?'没有匹配的对话':'点上方「选择存档文件夹」<br>载入你的 ClaudeArchive')); $('#count').textContent=state.convs.length?(state.convs.length+' 个对话'):'尚未载入'; return; }
  const groups=new Map();
  for(const c of convs){ const k=bucket(c.updated_at); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(c); }
  for(const [k,items] of groups){
    const g=ce('div','side-group'); g.appendChild(ce('div','side-group-t',esc(k)));
    items.forEach(c=>{
      const it=ce('button','conv-item'+(c.uuid===state.activeId?' active':''),'<span class="conv-name">'+hlite(c.name||'未命名对话', q)+'</span>');
      it.addEventListener('click',()=>{ state.activeId=c.uuid; renderSidebar(); renderThread(); });
      g.appendChild(it);
    });
    list.appendChild(g);
  }
  $('#count').textContent=state.convs.length+' 个对话';
}

/* ---------- 空状态 ---------- */
function emptyState(){
  const e=ce('div','empty');
  e.innerHTML='<div class="logo">Claude</div>'+
    '<p>选择你的 <code>ClaudeArchive</code> 文件夹,在这里以 Claude 网页版的样子浏览全部对话 —— 含思考过程、工具调用与文件。<br>所有数据只在本机加载,不上传任何地方。</p>';
  const btn=ce('button','cta','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke-linejoin="round"/></svg>选择存档文件夹');
  btn.addEventListener('click',()=>pickFolder());
  e.appendChild(btn);
  return e;
}

/* ---------- 载入文件夹 ---------- */
async function handleFiles(fileList){
  const files=[...fileList];
  if(!files.length) return;

  // 1) 收集所有可能是"对话 JSON"的文件(conversation*.json 或任意 .json),以及各文件夹的 files/
  const jsonFiles=[]; // {file, folder}
  const folderFiles=new Map(); // folder -> Map(relName->File)
  for(const f of files){
    const rel=f.webkitRelativePath||f.name;
    const parts=rel.split('/');
    const base=parts[parts.length-1];
    const folder=parts.slice(0,-1).join('/');
    if(/\.json$/i.test(base) && base!=='_index.json'){
      jsonFiles.push({file:f, folder});
    }
    // files/ 子目录
    const fi=rel.indexOf('/files/');
    if(fi>=0){
      const fdr=rel.slice(0,fi);
      if(!folderFiles.has(fdr)) folderFiles.set(fdr,new Map());
      folderFiles.get(fdr).set(rel.slice(fi+7), f);
    }
  }

  // 2) 解析 JSON,按对话 uuid 分组(同一对话的多版本会聚到一起)
  const groups=new Map(); // uuid -> { datas:[], folders:Set }
  for(const {file, folder} of jsonFiles){
    let data; try{ data=JSON.parse(await file.text()); }catch{ continue; }
    if(!Array.isArray(data.chat_messages)) continue; // 不是对话 JSON,跳过
    const uuid=data.uuid||folder||file.name;
    if(!groups.has(uuid)) groups.set(uuid,{datas:[],folders:new Set()});
    groups.get(uuid).datas.push(data);
    if(folder) groups.get(uuid).folders.add(folder);
  }

  // 3) 每组合并去重;合并其涉及文件夹的 files/
  const convs=[]; const byId=new Map(); const foldersOut=new Map();
  let mergedCount=0;
  for(const [uuid,g] of groups){
    const data = g.datas.length>1 ? (mergedCount++, mergeConversations(g.datas)) : g.datas[0];
    // 合并这些文件夹的 files/(按文件名,后者不覆盖已存在)
    const fileMap=new Map();
    for(const fdr of g.folders){
      const fm=folderFiles.get(fdr);
      if(fm) for(const [n,fl] of fm){ if(!fileMap.has(n)) fileMap.set(n,fl); }
    }
    const key='__'+uuid+'__';
    foldersOut.set(key,{json:null,files:fileMap});
    const conv={ uuid, name:data.name||'未命名对话', updated_at:data.updated_at||data.created_at||'',
                 created_at:data.created_at||'', model:data.model||'', data, _folder:key,
                 _mergedFrom: g.datas.length>1 ? g.datas.length : 0 };
    convs.push(conv); byId.set(uuid, conv);
  }

  state.convs=convs; state.byId=byId; state.folders=foldersOut;
  if(convs.length){
    state.activeId=convs.slice().sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')))[0].uuid;
  } else { state.activeId=null; }
  renderSidebar(); renderThread();
  if(!convs.length) toast('未找到对话 JSON(需含 chat_messages)');
  else if(mergedCount) toast('已载入 '+convs.length+' 个对话('+mergedCount+' 个由多版本合并去重)');
  else toast('已载入 '+convs.length+' 个对话');
}

/* ---------- toast ---------- */
let _tt;
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>t.classList.remove('show'),2400);
}

/* ---------- 绑定到插件(直写模式):句柄存 IndexedDB,SW 直接读写磁盘 ---------- */
const IDB_NAME='cca', IDB_STORE='handles';
function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbSet(key,val){ const db=await idbOpen(); return new Promise((res,rej)=>{ const t=db.transaction(IDB_STORE,'readwrite').objectStore(IDB_STORE).put(val,key); t.onsuccess=()=>res(true); t.onerror=()=>rej(t.error); }); }
async function idbGet(key){ const db=await idbOpen(); return new Promise((res,rej)=>{ const t=db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key); t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); }); }
const inExtension = !!(window.chrome && chrome.runtime && chrome.runtime.id);

async function bindFolder(){
  if(!window.showDirectoryPicker){ toast('当前环境不支持文件夹绑定'); return; }
  let handle;
  try{
    handle = await window.showDirectoryPicker({ id:'claude-archive-root', startIn:'downloads', mode:'readwrite' });
  }catch(err){ if(err && err.name==='AbortError') return; toast('授权失败:'+(err&&err.message||err)); return; }
  try{
    await idbSet('root', handle);
  }catch(e){ toast('保存绑定失败:'+(e&&e.message||e)); return; }
  // 通知插件后台校验 + 扫描重建索引
  let scanMsg='';
  if(inExtension){
    try{
      const r = await chrome.runtime.sendMessage({ kind:'viewer:bound' });
      if(r && r.ok && r.scan && r.scan.ok) scanMsg = ` · 已从文件夹恢复 ${r.scan.found||0} 个对话索引`;
      else if(r && !r.ok) scanMsg = ' · 插件端未生效(状态:'+(r.status||'?')+')';
    }catch(e){}
  }
  toast('已绑定「'+(handle.name||'文件夹')+'」直写模式'+scanMsg);
  // 顺便把该文件夹载入查看器浏览
  try{
    const files = await readDirRecursive(handle, handle.name);
    await handleFiles(files);
  }catch(e){}
}

async function pickFolder(){
  // 1) 已绑定/选过 → 直接复用句柄(最多一次"允许"授权点击),不再弹文件夹选择器
  if(await loadFromBound(true)) return;
  // 2) 弹选择器:默认从「下载」目录开;Chrome 会按 id 记住上次位置
  if(window.showDirectoryPicker){
    let dirHandle;
    try{
      dirHandle = await window.showDirectoryPicker({ id:'claude-archive-root', startIn:'downloads', mode: inExtension?'readwrite':'read' });
    }catch(err){
      if(err && err.name==='AbortError') return; // 用户取消
      $('#folderInput').click(); return;          // 个别环境不支持 → 回退 input
    }
    try{
      await idbSet('root', dirHandle);            // 选一次就存下来(下次直接复用)
      if(inExtension){ try{ await chrome.runtime.sendMessage({ kind:'viewer:bound' }); }catch(e){} }
    }catch(e){}
    try{
      toast('正在读取文件夹…');
      const files = await readDirRecursive(dirHandle, dirHandle.name);
      await handleFiles(files);
    }catch(err){ toast('读取文件夹失败:'+(err && err.message || err)); }
    return;
  }
  $('#folderInput').click();
}
// 句柄权限:granted 直接过;prompt 时在页面里请求一次(有用户手势)
async function ensureHandlePerm(handle, mode){
  try{
    let p = await handle.queryPermission({ mode });
    if(p==='granted') return true;
    p = await handle.requestPermission({ mode });
    return p==='granted';
  }catch(e){ return false; }
}
// 复用 IndexedDB 里已存的根句柄读取存档;silent=true 时无句柄不提示
async function loadFromBound(silent){
  let handle=null;
  try{ handle = await idbGet('root'); }catch(e){}
  if(!handle){ if(!silent) toast('还没有选择/绑定过存档文件夹'); return false; }
  const ok = await ensureHandlePerm(handle, inExtension?'readwrite':'read');
  if(!ok){ if(!silent) toast('文件夹授权未通过,请重新选择'); return false; }
  try{
    toast('正在读取「'+(handle.name||'存档')+'」…');
    const files = await readDirRecursive(handle, handle.name);
    await handleFiles(files);
    if(inExtension){ try{ chrome.runtime.sendMessage({ kind:'viewer:bound' }); }catch(e){} }
    return true;
  }catch(e){ if(!silent) toast('读取失败:'+(e&&e.message||e)); return false; }
}
// 递归读取目录句柄 → File[](每个带 webkitRelativePath,兼容 handleFiles)
async function readDirRecursive(dirHandle, prefix){
  const out=[];
  async function walk(handle, path){
    for await (const [name, h] of handle.entries()){
      const rel = path ? path+'/'+name : name;
      if(h.kind==='file'){
        try{
          const f = await h.getFile();
          // 注入 webkitRelativePath(只读属性,用 defineProperty 覆盖)
          try{ Object.defineProperty(f,'webkitRelativePath',{value:rel,configurable:true}); }catch(e){}
          out.push(f);
        }catch(e){}
      } else if(h.kind==='directory'){
        // 跳过明显无关的超大目录可在此加判断;这里全量读取
        await walk(h, rel);
      }
    }
  }
  await walk(dirHandle, prefix);
  return out;
}

/* ---------- 事件 ---------- */
$('#themeBtn').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#loadBtn').addEventListener('click',pickFolder);
$('#refreshBtn').addEventListener('click',()=>loadFromBound(false));
// 扩展环境:打开查看器即自动载入已绑定的存档(回调内判断,避免 const 提前引用)
setTimeout(()=>{ try{ if(window.chrome&&chrome.runtime&&chrome.runtime.id&&!state.convs.length) loadFromBound(true); }catch(e){} }, 60);
$('#loadJsonBtn').addEventListener('click',()=>$('#jsonInput').click());
$('#reloadBtn').addEventListener('click',pickFolder);
$('#folderInput').addEventListener('change',e=>handleFiles(e.target.files));
$('#jsonInput').addEventListener('change',e=>handleFiles(e.target.files));
$('#searchInput').addEventListener('input',e=>{ state.query=e.target.value; renderSidebar(); });

/* ---------- 全局搜索:选范围 → 关键词高亮列出 → 点击跳转 → 可返回结果继续 ---------- */
state.gs={ q:'', scopes:{user:true,ai:true,think:true,tool:true}, range:'all', results:[] };
const SCOPE_ZH={user:'用户',ai:'AI 回答',think:'思考',tool:'工具·产物'};
function joinTexts(arr){ return arr.filter(Boolean).join('\n'); }
// 按范围抽取一条消息的可搜文本
function searchFieldsOf(m){
  const out={user:'',ai:'',think:'',tool:''};
  const texts=[],thinks=[],tools=[];
  for(const b of (Array.isArray(m.content)?m.content:[])){
    if(!b) continue;
    if(b.type==='text'&&b.text) texts.push(b.text);
    else if(b.type==='thinking'){
      if(b.thinking) thinks.push(b.thinking);
      if(Array.isArray(b.summaries)) for(const s of b.summaries) if(s&&s.summary) thinks.push(s.summary);
    }
    else if(b.type==='tool_use'){
      if(b.message) tools.push(b.message);
      if(b.name) tools.push(b.name);
      const i=b.input;
      if(i&&typeof i==='object'){ for(const k of ['command','path','file_path','url','query','description','new_str','old_str','file_text']) if(typeof i[k]==='string') tools.push(i[k]); }
    }
    else if(b.type==='tool_result'){
      if(b.message) tools.push(b.message);
      if(Array.isArray(b.content)) for(const it of b.content){ if(it&&it.type==='local_resource'){ if(it.name)tools.push(it.name); if(it.file_path)tools.push(it.file_path); } }
    }
  }
  for(const f of (m.files||[])) if(f&&f.file_name) tools.push(f.file_name);
  for(const a of (m.attachments||[])){ if(a&&a.file_name) tools.push(a.file_name); if(a&&typeof a.extracted_content==='string') tools.push(a.extracted_content); }
  if(m.sender==='human') out.user=joinTexts(texts); else out.ai=joinTexts(texts);
  out.think=joinTexts(thinks); out.tool=joinTexts(tools);
  return out;
}
function makeSnippet(txt,idx,q){
  const R=64, start=Math.max(0,idx-44), end=Math.min(txt.length, idx+q.length+R);
  let s=txt.slice(start,end).replace(/\s+/g,' ');
  return (start>0?'…':'')+hlite(s,q)+(end<txt.length?'…':'');
}
function runGlobalSearch(){
  const q=state.gs.q.trim();
  const box=$('#sRes'), foot=$('#sFoot');
  if(!q){ box.innerHTML='<div class="sres-empty">输入关键词开始搜索</div>'; foot.textContent=''; state.gs.results=[]; return; }
  const ql=q.toLowerCase();
  const fromV=$('#sFrom').value, toV=$('#sTo').value;
  const from=fromV?new Date(fromV+'T00:00:00'):null;
  const to=toV?new Date(toV+'T23:59:59.999'):null;
  const convs = state.gs.range==='cur'
    ? (state.byId.get(state.activeId)?[state.byId.get(state.activeId)]:[])
    : state.convs;
  const res=[]; const CAP=400;
  outer:
  for(const conv of convs){
    if(!conv||!conv.data) continue;
    for(const m of (conv.data.chat_messages||[])){
      if(from||to){
        const t=m.created_at?new Date(m.created_at):null;
        if(t&&!isNaN(t)){ if(from&&t<from) continue; if(to&&t>to) continue; }
      }
      const f=searchFieldsOf(m);
      for(const k of ['user','ai','think','tool']){
        if(!state.gs.scopes[k]) continue;
        const txt=f[k]; if(!txt) continue;
        const idx=txt.toLowerCase().indexOf(ql); if(idx<0) continue;
        res.push({convId:conv.uuid, msgUuid:m.uuid, scope:k, time:m.created_at||'', snippet:makeSnippet(txt,idx,q)});
        if(res.length>=CAP) break outer;
      }
    }
  }
  state.gs.results=res;
  renderSearchResults();
}
function renderSearchResults(){
  const box=$('#sRes'), foot=$('#sFoot');
  const res=state.gs.results;
  if(!res.length){ box.innerHTML='<div class="sres-empty">没有匹配结果。试试换个词,或放宽范围/时间。</div>'; foot.textContent='0 条结果'; return; }
  box.innerHTML='';
  for(const h of res){
    const conv=state.byId.get(h.convId);
    const it=ce('button','sitem');
    it.innerHTML='<div class="si-top"><span class="si-conv">'+esc(conv&&conv.name||'未命名对话')+'</span>'+
      '<span class="si-scope">'+SCOPE_ZH[h.scope]+'</span>'+
      '<span class="si-time">'+(h.time?esc(fmtClock(h.time)):'')+'</span></div>'+
      '<div class="si-snip">'+h.snippet+'</div>';
    it.addEventListener('click',()=>jumpToHit(h));
    box.appendChild(it);
  }
  foot.textContent=res.length+(res.length>=400?'+':'')+' 条结果 · 点击任意条跳转,跳转后可点底部「返回搜索结果」继续';
}
function jumpToHit(h){
  const conv=state.byId.get(h.convId); if(!conv) return;
  closeSearch(true);
  state.activeId=conv.uuid;
  // 命中消息可能在非活动分支:把叶子切到该消息所在分支
  const onPath=activePath(conv.data, conv._leaf).some(m=>m.uuid===h.msgUuid);
  if(!onPath) conv._leaf=deepestLeaf(conv.data, h.msgUuid);
  renderSidebar();
  renderThread({focusUuid:h.msgUuid, flash:true});
  $('#backToSearch').style.display='';
}
function openSearch(){
  $('#searchModal').style.display='flex';
  $('#backToSearch').style.display='none';
  setTimeout(()=>$('#gq').focus(),30);
}
function closeSearch(keepBack){
  $('#searchModal').style.display='none';
  if(!keepBack) $('#backToSearch').style.display='none';
}
let _gsT=null;
$('#gSearchBtn').addEventListener('click',openSearch);
$('#gClose').addEventListener('click',()=>closeSearch(false));
document.querySelector('#searchModal .smodal-bd').addEventListener('click',()=>closeSearch(state.gs.results.length>0));
$('#gq').addEventListener('input',e=>{ state.gs.q=e.target.value; clearTimeout(_gsT); _gsT=setTimeout(runGlobalSearch,260); });
$('#gq').addEventListener('keydown',e=>{ if(e.key==='Enter'){ clearTimeout(_gsT); state.gs.q=e.target.value; runGlobalSearch(); } });
document.querySelectorAll('#searchModal .schip').forEach(ch=>ch.addEventListener('click',()=>{
  const k=ch.dataset.scope; state.gs.scopes[k]=!state.gs.scopes[k]; ch.classList.toggle('on',state.gs.scopes[k]); runGlobalSearch();
}));
document.querySelectorAll('#searchModal .sseg').forEach(sg=>sg.addEventListener('click',()=>{
  state.gs.range=sg.dataset.range;
  document.querySelectorAll('#searchModal .sseg').forEach(x=>x.classList.toggle('on',x===sg));
  runGlobalSearch();
}));
$('#sFrom').addEventListener('change',runGlobalSearch);
$('#sTo').addEventListener('change',runGlobalSearch);
$('#backToSearch').addEventListener('click',()=>{ $('#searchModal').style.display='flex'; $('#backToSearch').style.display='none'; });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && $('#searchModal').style.display!=='none') closeSearch(state.gs.results.length>0); });
// 扩展环境:显示"绑定到插件"按钮;带 #bind 打开时给出醒目引导
if(inExtension && window.showDirectoryPicker){
  $('#bindBtn').style.display='';
  $('#bindHint').style.display='';
  $('#bindBtn').addEventListener('click',bindFolder);
  if(location.hash==='#bind'){
    toast('请点击左侧「绑定到插件(直写模式)」选择你的 ClaudeArchive 文件夹');
    $('#bindBtn').style.outline='2px solid var(--accent)';
    setTimeout(()=>{ $('#bindBtn').style.outline=''; }, 6000);
  }
}

// 代码块"一键复制"(事件委托)
document.addEventListener('click',(e)=>{
  const btn=e.target.closest && e.target.closest('.codecopy');
  if(!btn) return;
  const id=btn.getAttribute('data-cb');
  const raw=(window.__codeStore||{})[id];
  if(raw==null) return;
  const done=()=>{ btn.classList.add('copied'); const t=btn.querySelector('.copytxt'); const old=t?t.textContent:''; if(t)t.textContent='已复制'; setTimeout(()=>{ btn.classList.remove('copied'); if(t)t.textContent=old||'复制'; },1500); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(raw).then(done).catch(()=>fallbackCopy(raw,done)); }
  else fallbackCopy(raw,done);
});
function fallbackCopy(text,cb){ try{ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); cb&&cb(); }catch(e){} }

// KaTeX 异步加载完成后,补渲染当前线程里的公式回退占位
window.addEventListener('load',()=>{ if(window.katex && state.activeId) renderThread(); });

/* ---------- 统计页面 ---------- */
function computeStats(){
  const convs=state.convs||[];
  let humanMsgs=0, aiMsgs=0, humanChars=0, aiChars=0, thinkMs=0, toolCalls=0, files=0, thinkBlocks=0;
  const toolCount={}; const dayCount={}; let earliest=null, latest=null;
  for(const conv of convs){
    const msgs=(conv.data&&conv.data.chat_messages)||[];
    for(const m of msgs){
      const txt=(Array.isArray(m.content)?m.content:[]).filter(b=>b&&b.type==='text').map(b=>b.text||'').join('');
      if(m.sender==='human'){ humanMsgs++; humanChars+=txt.length; }
      else { aiMsgs++; aiChars+=txt.length; }
      for(const b of (Array.isArray(m.content)?m.content:[])){
        if(b.type==='tool_use'){ toolCalls++; toolCount[b.name]=(toolCount[b.name]||0)+1; }
        if(b.type==='thinking'){ thinkBlocks++; if(b.start_timestamp&&b.stop_timestamp){ const a=new Date(b.start_timestamp),z=new Date(b.stop_timestamp); if(!isNaN(a)&&!isNaN(z)&&z>=a) thinkMs+=(z-a); } }
      }
      files+=((m.files||[]).length);
      for(const bb of (Array.isArray(m.content)?m.content:[])){ if(bb.type==='tool_result'&&Array.isArray(bb.content)) files+=bb.content.filter(x=>x&&x.type==='local_resource').length; }
      const ts=m.created_at; if(ts){ const d=new Date(ts); if(!isNaN(d)){ if(!earliest||d<earliest)earliest=d; if(!latest||d>latest)latest=d; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; dayCount[key]=(dayCount[key]||0)+1; } }
    }
  }
  const days=Object.keys(dayCount).length;
  const busiest=Object.entries(dayCount).sort((a,b)=>b[1]-a[1])[0];
  const topTools=Object.entries(toolCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return {convs:convs.length,humanMsgs,aiMsgs,humanChars,aiChars,thinkMs,toolCalls,files,thinkBlocks,days,busiest,topTools,earliest,latest};
}
function openStats(){
  const s=computeStats();
  const body=$('#statsBody');
  const spanDays = (s.earliest&&s.latest)? Math.max(1, Math.round((s.latest-s.earliest)/86400000)+1) : 0;
  const cell=(num,lbl)=>`<div class="stat-cell"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`;
  let html='<div class="stat-grid">';
  html+=cell(s.convs,'个对话存档');
  html+=cell(s.humanMsgs,'你发的消息');
  html+=cell(s.humanChars.toLocaleString(),'你打的字数');
  html+=cell(s.aiMsgs,'Claude 回复');
  html+=cell(fmtDur(s.thinkMs),'Claude 累计思考');
  html+=cell(s.toolCalls.toLocaleString(),'工具调用次数');
  html+=cell(s.files,'保存的文件数');
  html+=cell(spanDays?spanDays+' 天':'—','跨越时间');
  html+='</div>';

  // 趣味
  html+='<div class="stat-sec">一些有意思的数字</div>';
  const ratio = s.humanMsgs? (s.aiChars/Math.max(1,s.humanChars)) : 0;
  html+=`<div class="stat-row"><span>平均每条你说</span><b>${s.humanMsgs?Math.round(s.humanChars/s.humanMsgs):0} 字</b></div>`;
  html+=`<div class="stat-row"><span>Claude 回复/你输入 字数比</span><b>${ratio?ratio.toFixed(1):0} 倍</b></div>`;
  html+=`<div class="stat-row"><span>平均每个对话思考</span><b>${s.convs?fmtDur(s.thinkMs/s.convs):'0秒'}</b></div>`;
  html+=`<div class="stat-row"><span>思考块总数</span><b>${s.thinkBlocks}</b></div>`;
  if(s.busiest) html+=`<div class="stat-row"><span>最忙的一天</span><b>${s.busiest[0]} (${s.busiest[1]} 条消息)</b></div>`;
  if(s.earliest) html+=`<div class="stat-row"><span>最早一条</span><b>${fmtClock(s.earliest.toISOString())}</b></div>`;
  if(s.latest) html+=`<div class="stat-row"><span>最近一条</span><b>${fmtClock(s.latest.toISOString())}</b></div>`;

  // 工具排行
  if(s.topTools.length){
    html+='<div class="stat-sec">最常用的工具</div>';
    const max=s.topTools[0][1];
    for(const [name,c] of s.topTools){
      html+=`<div class="stat-row" style="border:0;padding-bottom:2px"><span><b>${esc(name)}</b></span><span>${c} 次</span></div>`;
      html+=`<div class="stat-bar"><i style="width:${Math.round(c/max*100)}%"></i></div>`;
    }
  }
  if(!s.convs) html='<div style="color:var(--text-3);font-family:var(--sans);padding:20px 0;text-align:center">还没有载入任何对话。先「选择存档文件夹」。</div>';
  body.innerHTML=html;
  $('#statsModal').style.display='flex';
}
$('#statsBtn').addEventListener('click',openStats);
$('#statsClose').addEventListener('click',()=>$('#statsModal').style.display='none');
$('#statsModal').querySelector('.stats-bd').addEventListener('click',()=>$('#statsModal').style.display='none');

renderThread();
