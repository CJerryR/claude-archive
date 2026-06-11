#!/usr/bin/env node
// 从 CHANGELOG.md 拆分出每个版本的发布说明,写入 docs/releases/vX.Y.Z.md
// 用法: node scripts/gen-release-notes.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const outDir = path.join(ROOT, 'docs', 'releases');
fs.mkdirSync(outDir, { recursive: true });

const lines = changelog.split('\n');
// 匹配 "## [2.7.0] - 2026-06-12" 或 "## [Unreleased]"
const headRe = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?(.*)$/;

const sections = [];
let cur = null;
for (const line of lines) {
  const m = line.match(headRe);
  // 非版本的二级标题(## 版本号说明 / ## 关于早期版本日期 等)→ 结束当前 section 并停止
  const isOtherH2 = /^## (?!\[)/.test(line);
  if (m) {
    if (cur) sections.push(cur);
    cur = { version: m[1], date: m[2] || '', note: (m[3] || '').trim(), body: [] };
  } else if (isOtherH2 && cur) {
    sections.push(cur);
    cur = null;
  } else if (cur) {
    if (/^\[[^\]]+\]:\s*https?:\/\//.test(line)) continue;
    cur.body.push(line);
  }
}
if (cur) sections.push(cur);

const index = [];
let count = 0;
for (const s of sections) {
  if (s.version.toLowerCase() === 'unreleased') continue;
  const ver = s.version.replace(/^v/i, '');
  const file = `v${ver}.md`;
  const dateStr = s.date ? s.date : '未定';
  // 去掉 body 末尾多余空行 / 分隔线
  let body = s.body.join('\n').replace(/\n*---\s*$/,'').trim();
  const tag = s.note && /开发期/.test(s.note) ? '  \n> 注:此版本为项目早期开发阶段发布,日期为近似值。' : '';
  const md = `# Release v${ver}

**发布日期**: ${dateStr}${tag}

${body}

---

- 完整更新日志: [CHANGELOG.md](../../CHANGELOG.md)
- 安装与使用: [README](../../README.md)
`;
  fs.writeFileSync(path.join(outDir, file), md);
  index.push({ ver, dateStr, note: s.note });
  count++;
}

// 生成 releases 索引
const idxMd = `# 发布说明索引（Release Notes）

各版本发布说明，按版本倒序。完整变更见 [CHANGELOG.md](../../CHANGELOG.md)。

| 版本 | 日期 | 说明 |
|------|------|------|
${index.map(i => `| [v${i.ver}](v${i.ver}.md) | ${i.dateStr} | ${/开发期/.test(i.note) ? '早期开发阶段' : ''} |`).join('\n')}
`;
fs.writeFileSync(path.join(outDir, 'README.md'), idxMd);

console.log(`已生成 ${count} 份发布说明 + 索引 → docs/releases/`);
