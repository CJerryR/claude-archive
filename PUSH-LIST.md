# Push 清单(v2.9.1)

> 本仓库 push 的全部文件如下。除此之外的任何文件（尤其 `*.zip` 打包产物、`ClaudeArchive/` 用户数据、`_runlog.txt`、`_index.json`、`cleanup-report.csv/json`、`.DS_Store` 等）**都不 push**，已在 `.gitignore` 中排除。

## 一、扩展核心（运行必需）
```
manifest.json          扩展清单（MV3）
background.js          Service Worker：捕获→归档→直写/下载、串行锁、限速
interceptor.js        页面注入：拦截 fetch/XHR 捕获对话
bridge.js             ISOLATED↔MAIN 桥接
exporter.js           Markdown/JSON 导出、资产收集、目录命名
offscreen.html        Offscreen 文档（blob→dataURL）
offscreen.js
popup.html            扩展弹窗 UI
popup.js              弹窗逻辑（设置/保存/批量/Star/邮件）
viewer.html           本地查看器（结构）— 必须与 viewer.js 同目录
viewer.js             本地查看器（脚本）— 思考链 UI / 全局搜索 / 直写绑定
icons/16.png
icons/48.png
icons/128.png
```

## 二、tools/ — 工具（查重）
```
tools/cleanup-report.html    查重报告（只读网页，SHA-256 标重复，导出 JSON/CSV）
tools/ORGANIZING_GUIDE.md    查重/整理 Prompt（交给 Claude Code 执行的整理规则）
tools/README.md              tools 说明
```

## 三、guides/ — 用户使用指南
```
guides/GETTING_STARTED.md    新手图文手册（分享给别人看这份）
guides/quick-start-card.html 一页式快速上手卡片
guides/USAGE.md              详细使用指南
guides/README.md             guides 说明
```

## 四、docs/ — 开发记录
```
docs/releases/README.md      发布说明索引
docs/releases/v1.0.0.md … v2.9.1.md   各版本发布说明（19 份）
```

## 五、开源项目标准文件（根目录）
```
README.md                项目主页
CHANGELOG.md             完整更新日志（开发记录主文件）
LICENSE                  MIT
CONTRIBUTING.md          贡献指南
CODE_OF_CONDUCT.md       行为准则
SECURITY.md              安全策略
RELEASING.md             发布流程
.gitignore               忽略规则
PUSH-LIST.md             本清单
scripts/gen-release-notes.mjs   由 CHANGELOG 生成发布说明的脚本
.github/ISSUE_TEMPLATE/bug_report.yml
.github/ISSUE_TEMPLATE/feature_request.yml
.github/ISSUE_TEMPLATE/config.yml
.github/PULL_REQUEST_TEMPLATE.md
```

## 不 push（.gitignore 已排除）
- `*.zip`（所有打包产物；发布时作为 GitHub Release 附件上传，不进仓库）
- `ClaudeArchive/`、`_index.json`、`_runlog.txt`、`cleanup-report.csv/json`（用户数据/运行产物）
- `share/`、`suite/`、`gh_repo/`、`push_repo/`（本地打包临时目录）
- `.DS_Store`、`node_modules/`、编辑器配置、`*.crdownload`、`~$*` 等
