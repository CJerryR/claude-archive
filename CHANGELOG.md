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
## [1.8.0] - 2026-06-10

### 🐛 修复（Fixed）
- 修复点击图片会触发下载的问题：图片改为点击打开灯箱预览，下载改为独立按钮。
- 修复 Claude 生成文件无法在查看器打开的问题：按文件名与 uuid 解析，pdf/html 新标签打开。

### 🔧 改进（Changed）
- 扩展资源候选地址优先尝试 JSON 中的原始 variant（如 `/files/{uuid}/document_pdf`），主动排除缩略图。
## [1.9.0] - 2026-06-11

### ✨ 新增（Added）
- 新增「对话辨识码子目录」：产出文件按 `files/{对话uuid前8}/` 分目录存放，跨对话同名文件互不冲突。

### 🔧 改进（Changed）
- 同一对话内不同来源的同名文件以 `__{uuid8}` 后缀区分并全部保留；同路径同文件仅保留一份。
## [2.0.0] - 2026-06-11

### ✨ 新增（Added）
- 新增数学公式渲染：支持 `$$...$$` 与 `$...$`，经 KaTeX 渲染（CDN 加载失败时回退为可读原文）。
- 代码块新增「一键复制」按钮与语言标签。
- 新增 VSCode Dark+ 风格代码语法高亮（自写分词器，无外部依赖）。
- 每条消息底部新增页脚：显示最后更新时间（精确到秒）与该条 Claude 思考用时。
- 新增「统计」页面：对话数、消息与字数、累计思考时长、工具调用排行、最忙日期、跨越时间等。
- 扩展弹窗新增每对话文件下载进度条。

### 🔧 改进（Changed）
- 引用块样式改为 Claude 官网风格（浅色卡片 + 赤陶色左边条）。
## [2.1.0] - 2026-06-11

### 🔧 改进（Changed）
- 思考链中工具步骤的标题改用 Claude 的动作描述（`tool_use.message`，如「创建扩展项目目录」），工具名降级为右侧小标签；与官网思考链一致。机械占位「Generating…」自动过滤。
- 工具请求参数若带 `display_content.json_block`，按代码块语法高亮渲染。

### ⚡ 优化（Improved）
- 配色对齐 Claude 官网深色主题：主背景加深为 `#1f1e1d`，正文提亮为 `#faf9f5`。
- 代码块字号增大，等宽字体栈调整为 VSCode 风格（Cascadia Code / Consolas 优先）。

---

## 版本号说明

- **主版本（Major）**：发生破坏性变更或输出结构重大调整时递增（如 2.5.0 重构存储模型）。
- **次版本（Minor）**：新增向后兼容的功能时递增。
- **修订号（Patch）**：向后兼容的缺陷修复时递增。

## 关于早期版本日期

标注 _(开发期)_ 的版本为 1.0.0–1.8.0，于项目早期密集迭代完成，日期为对应开发阶段的近似值；
1.9.0 起的版本日期可精确对应。所有版本的功能演进均如实记录。
