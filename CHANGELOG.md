# 更新日志（Changelog）

本项目所有重要变更都记录于此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本（Semantic Versioning）](https://semver.org/lang/zh-CN/)。

---

## 项目信息

- **项目名称**：Claude Archive Suite（Claude 对话本地存档套件）
- **项目简介**：一套用于将 Claude.ai / 镜像站对话**完整、本地化**归档的工具。浏览器扩展实时捕获对话的完整思考链、工具调用、上传文件与 Claude 生成的文件，导出为 Markdown 与 JSON；配套「仿 Claude 网页版」的本地查看器离线浏览，以及历史文件整理报告与整理规则手册。全程本地运行，不上传任何数据。
- **技术栈**：
  - 浏览器扩展：Chrome / Edge **Manifest V3**（Service Worker、双世界内容脚本 MAIN/ISOLATED、Offscreen Document）
  - 语言：原生 JavaScript（ES Modules）、HTML、CSS，无构建步骤、无前端框架
  - 关键 Web API：`fetch`/`XHR` 拦截、`chrome.downloads`、`chrome.storage.local`、`chrome.tabs`、`crypto.subtle`（SHA-256）、`File System Access`（文件夹读取）
  - 查看器：单文件 HTML + 内联 JS/CSS；公式渲染用 KaTeX（CDN）；代码高亮为自写 VSCode Dark+ 风格分词器
  - 适配站点：`claude.ai`、`*.claude.ai`、`claude.hk.cn`

---

## [1.0.0] - 2026-06-08

### ✨ 新增（Added）
- 首个可用版本。Chrome / Edge Manifest V3 扩展：通过 MAIN 世界拦截 `fetch`/`XHR` 捕获对话 JSON 与 SSE 流，经 ISOLATED 世界桥接转发至 Service Worker。
- 将对话导出为 Markdown 与 JSON，保存至浏览器下载目录的 `ClaudeArchive/` 下。
- 支持上传文件与图片的下载（图片为服务器提供的 webp 预览）。
- 通过 Offscreen Document 将文本 / base64 内容转换为可下载的 data URL。
- 适配 `claude.ai`、`*.claude.ai`、`claude.hk.cn`。
## [1.1.0] - 2026-06-09

### ✨ 新增（Added）
- 新增「仿 Claude 网页版」本地查看器 `viewer.html`：载入 `ClaudeArchive` 文件夹离线浏览全部对话。
- 新增扩展弹窗控制台：开关启用、自动保存、保存文件、全量补全抓取、保留历史快照、保留事件流等选项。

### 🔧 改进（Changed）
- 产出文件由扁平存放改为每对话独立子目录 `{对话名}__{uuid8}/`。
## [1.2.0] - 2026-06-09

### ✨ 新增（Added）
- 新增完整保真抓取：回复结束后以 `tree=True&rendering_mode=messages&render_all_tools=true` 重新抓取，确保完整思考链与全部工具调用、所有分支。
- 同时导出 Markdown 与 JSON 双格式。

### ⚡ 优化（Improved）
- 抓取改为防抖写盘，避免短时间内重复归档。
## [1.3.0] - 2026-06-09

### ✨ 新增（Added）
- 新增历史快照：每次抓取另存带时间戳的 `history/conversation_{ISO}.json`，便于多版本合并。
- 查看器新增深色 / 浅色主题切换、对话搜索、侧栏按日期分组。
## [1.4.0] - 2026-06-10

### ✨ 新增（Added）
- 新增思考链时间线：将思考块与工具调用合并为单一内联时间线，各节点可独立展开查看请求参数与返回结果。
- 思考折叠标题采用思考阶段摘要（`summaries`）。

### 🔧 改进（Changed）
- 工具调用由独立卡片改为思考链内的时间线节点。
## [1.5.0] - 2026-06-10

### ✨ 新增（Added）
- 新增对话分支切换：父消息存在多个子节点时显示 `‹n/N›` 切换器，切换后重新定位至该分支最深叶子。
- 新增状态徽标：被打断（`user_canceled`）、已达工具调用上限（`tool_use_limit`）、已达长度上限（`max_tokens`）。
## [1.6.0] - 2026-06-10

### ✨ 新增（Added）
- 新增多版本 JSON 自动合并去重：载入文件夹时按对话 uuid 分组合并，保留全部分支，叶子取最新版本，顶部显示「已合并 N 版」徽标。
- 新增「选 JSON（可多选合并）」入口。

### 🔧 改进（Changed）
- `history/` 历史快照参与自动合并。
## [1.7.0] - 2026-06-10

### ✨ 新增（Added）
- 新增抓取 Claude 生成的文件：从 `present_files` 工具结果的 `local_resource` 解析 `file_path`，经 wiggle 下载接口获取。
- 查看器新增「Claude 生成的文件」分组，展示于消息末尾。

---

## 版本号说明

- **主版本（Major）**：发生破坏性变更或输出结构重大调整时递增（如 2.5.0 重构存储模型）。
- **次版本（Minor）**：新增向后兼容的功能时递增。
- **修订号（Patch）**：向后兼容的缺陷修复时递增。

## 关于早期版本日期

标注 _(开发期)_ 的版本为 1.0.0–1.8.0，于项目早期密集迭代完成，日期为对应开发阶段的近似值；
1.9.0 起的版本日期可精确对应。所有版本的功能演进均如实记录。
