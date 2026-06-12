# 贡献指南

感谢你考虑为 Claude Archive Suite 做贡献！

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 如何贡献

### 报告问题（Issue）

- 先搜索 [现有 Issue](../../issues)，避免重复。
- 使用对应的 Issue 模板（Bug 报告 / 功能建议）。
- Bug 报告请尽量附上：浏览器与版本、扩展版本、复现步骤、**「调试日志」导出的 `_runlog.txt`**（设置里开启「调试日志」后复现，再点「导出日志」）。

### 提交代码（Pull Request）

1. Fork 本仓库并新建分支：`git checkout -b feature/简述` 或 `fix/简述`。
2. 修改后自测（见下方「开发与自测」）。
3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：
   - `feat: 新增 xxx`、`fix: 修复 xxx`、`docs: ...`、`refactor: ...`、`chore: ...`
4. 在 PR 描述中说明动机、改动点；涉及破坏性变更请标注 **[破坏性变更]** 并说明影响范围。
5. 如改动面向用户，请在 `CHANGELOG.md` 的 `[Unreleased]` 区块补一条。

## 开发与自测

本项目**无构建步骤**，原生 JS + HTML + CSS。

```bash
# 语法检查所有脚本
for f in interceptor.js bridge.js offscreen.js popup.js background.js exporter.js; do
  node --check "$f"
done

# 校验 ES Module 是否能正确链接（node --check 查不出的导出错误）
node -e "import('./exporter.js').then(()=>console.log('ok'))"

# 校验 viewer.html / tools/cleanup-report.html 内联脚本（抽出 <script> 再 --check）
```

加载扩展：浏览器扩展页 → 开发者模式 → 加载已解压的扩展程序 → 选含 `manifest.json` 的目录。

### 代码风格

- 与现有代码保持一致：2 空格缩进、原生 API、必要的中文注释。
- 不要引入打包器或重型依赖；查看器须保持**单文件可直接打开**。
- 改动存储/目录逻辑时，务必兼顾**向下兼容**历史存档（查看器需能读取旧布局）。

## 版本与发布

- 遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
- 维护者发布流程见 [RELEASING.md](RELEASING.md)。

## 许可

提交即表示你同意你的贡献以 [MIT 许可](LICENSE) 发布。
