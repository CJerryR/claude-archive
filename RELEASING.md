# 发布流程（维护者）

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

## 版本号规则

- **主版本 MAJOR**：破坏性变更、输出结构重大调整（如 2.5.0 重构存储模型）。
- **次版本 MINOR**：向后兼容的新功能。
- **修订号 PATCH**：向后兼容的缺陷修复。

## 发布步骤

1. 确认 `main` 上所有改动已合并、自测通过：
   ```bash
   for f in interceptor.js bridge.js offscreen.js popup.js background.js exporter.js; do node --check "$f"; done
   node -e "import('./exporter.js').then(()=>console.log('ok'))"
   ```
2. **更新版本号**：编辑 `manifest.json` 的 `version`。
3. **整理 CHANGELOG**：把 `[Unreleased]` 内容落到新版本号下，标注日期（`YYYY-MM-DD`），重建空的 `[Unreleased]`，更新底部对比链接。
4. **生成发布说明**：运行脚本把 CHANGELOG 拆分为每版本一份：
   ```bash
   node scripts/gen-release-notes.mjs
   ```
   产物在 `docs/releases/vX.Y.Z.md`。
5. **提交并打 tag**：
   ```bash
   git add -A
   git commit -m "chore(release): vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push && git push --tags
   ```
6. **GitHub Release**：基于 tag 新建 Release，正文粘贴 `docs/releases/vX.Y.Z.md`，并附打包的扩展 ZIP 作为附件。

## 打包扩展 ZIP（发布附件）

把扩展目录打包（排除仓库元文件）：

```bash
zip -r claude-archive-vX.Y.Z.zip . \
  -x ".git/*" ".github/*" "docs/*" "scripts/*" "*.zip" \
     "CONTRIBUTING.md" "RELEASING.md" "CODE_OF_CONDUCT.md"
```

> 用户加载扩展只需含 `manifest.json` 的核心文件；标准仓库文件不影响运行，但打包时可精简。
