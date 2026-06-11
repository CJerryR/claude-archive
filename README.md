<div align="center">

# Claude Archive Suite

**把 Claude.ai / 镜像站的对话完整、本地化地存下来 —— 含思考链、工具调用、上传与生成的文件,并用「仿 Claude 网页版」的本地查看器离线浏览。**

[![License: MIT](https://img.shields.io/badge/License-MIT-d97757.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.9.0-d97757.svg)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/Chrome%2FEdge-MV3-4285F4.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![No Build](https://img.shields.io/badge/build-none-success.svg)](#)
[![Local Only](https://img.shields.io/badge/privacy-100%25%20local-2ea44f.svg)](#隐私)

[功能](#功能) · [安装](#安装) · [使用](#使用) · [目录结构](#存档目录结构) · [更新日志](CHANGELOG.md) · [贡献](CONTRIBUTING.md)

</div>

---

## 简介

Claude Archive Suite 是一套**纯本地运行**的工具,在你正常使用 Claude 时于后台自动归档对话:

- **浏览器扩展**（Chrome / Edge，Manifest V3）：实时捕获对话的完整文本、**思考过程**、**工具调用链**（参数 + 结果）、你上传的文件、Claude 生成的文件，导出为 **Markdown** 与 **JSON**。
- **本地查看器**（单文件 `viewer.html`）：界面与 Claude 网页版一致，离线浏览全部存档，支持思考链展开、分支切换、公式渲染、代码高亮、统计页等。
- **整理工具**：历史文件归类报告（只读）+ 给 Claude Code 的整理规则手册。

> 官方导出不含思考链与工具调用；本工具用全参数抓取（`render_all_tools=true`）补全这些内容。

---

## 功能

| 能力 | 说明 |
|------|------|
| 完整捕获 | 用户与 Claude 的全部文本、思考链、工具调用参数与结果 |
| 文件归档 | 上传文件、附件、Claude 生成的文件（按内容指纹版本化，去重保存） |
| 双格式 | 同时输出可读 Markdown 与结构化 JSON |
| 仿真查看器 | 暗/亮主题、思考链时间线、分支切换、KaTeX 公式、VSCode 风格代码高亮、一键复制 |
| 多版本合并 | 同一对话多份 JSON / 历史快照自动按 uuid 合并去重 |
| 实时自动保存 | 回复结束即归档；已存文件不重复下载、不弹"替换"框 |
| 批量与体检 | 全部下载、检查保存完整性（补下缺失文件） |
| 统计页 | 消息数、字数、累计思考时长、工具排行、活跃日期等 |
| 调试日志 | 可开关，定位"对话追踪不上"等问题 |
| 镜像站支持 | `claude.ai`、`*.claude.ai`、`claude.hk.cn` |

---

## 安装

> 未上架商店，使用「开发者模式」本地加载，完全在你电脑上运行。

1. 下载本仓库（`Code → Download ZIP`，或 `git clone`）。
2. 浏览器打开扩展页：Chrome → `chrome://extensions`；Edge → `edge://extensions`。
3. 打开 **开发者模式 / Developer mode**。
4. 点 **加载已解压的扩展程序 / Load unpacked**，选择含 `manifest.json` 的扩展目录。
5. 工具栏出现图标即成功，建议固定。

**本地查看器**：直接用浏览器打开 `viewer.html`，点「选择存档文件夹」选中下载目录里的 `ClaudeArchive`。

---

## 使用

1. 安装后正常使用 Claude，扩展会在后台自动捕获并保存当前对话。
2. 点扩展图标可见控制台：开关各项设置、保存当前/全部对话、检查完整性、打开查看器。
3. 历史旧对话：在 Claude 里打开它（必要时 **F5 刷新**触发抓取），再点「保存当前对话」。

> **为何要刷新**：扩展靠拦截页面发出的对话请求来捕获；若对话已被前端缓存（未发请求）就抓不到，刷新会强制重新请求。开启「调试日志」可确认卡在哪一步。

---

## 存档目录结构

```
ClaudeArchive/
  _index.json                     # 全局对话索引
  <对话名>__<uuid8>/
    conversation.json             # 结构化（含所有分支）
    conversation.md               # 可读（仅活动分支）
    history/                      # 带时间戳的历史快照（自动合并用）
    files/
      <对话码>/                    # = 对话 uuid 前 8 位
        viewer.html               # 产出文件第 1 版
        viewer__v2.html           # 内容变化后的新版本
        <图片>.webp / <上传文件>
```

文件按 **SHA-256 内容指纹**版本化：同一文件多轮出现但内容只变 N 次，仅保存 N 个版本，不产生重复副本。详见 [CHANGELOG](CHANGELOG.md) 与 `ORGANIZING_GUIDE.md`。

---

## 技术栈

- **扩展**：Manifest V3 —— Service Worker、双世界内容脚本（MAIN 拦截 `fetch`/`XHR`、ISOLATED 桥接）、Offscreen Document。
- **语言**：原生 JavaScript（ES Modules）、HTML、CSS，**无构建步骤、无前端框架**。
- **Web API**：`chrome.downloads` / `storage.local` / `tabs`、`crypto.subtle`（SHA-256）、文件夹读取。
- **查看器**：单文件 HTML；KaTeX（CDN）渲染公式；自写 VSCode Dark+ 分词器做代码高亮。

---

## 隐私

所有数据仅保存在你本机的浏览器下载目录，**不上传任何服务器**。扩展仅在 Claude 域名下运行，仅访问归档所需的对话与文件接口。

---

## 文档

- 🚀 [新手使用手册 docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)（**分享给别人看这份**）
- 🗂️ [快速上手卡片 docs/quick-start-card.html](docs/quick-start-card.html)（一页图文，可打印）
- [详细使用指南 docs/USAGE.md](docs/USAGE.md)
- [更新日志 CHANGELOG.md](CHANGELOG.md)
- [贡献指南 CONTRIBUTING.md](CONTRIBUTING.md)
- [安全策略 SECURITY.md](SECURITY.md)
- [行为准则 CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [各版本发布说明 docs/releases/](docs/releases/)

---

## 许可

[MIT](LICENSE) © 2026 CJerryR

> 本项目与 Anthropic 无关，"Claude" 为 Anthropic 的商标。本工具仅用于帮助用户备份**自己**的对话数据。
