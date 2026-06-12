# tools/ — 历史文件整理工具

| 文件 | 用途 |
|------|------|
| `cleanup-report.html` | **查重报告**(只读)。浏览器打开,选中 `ClaudeArchive` 文件夹,扫描并按对话 + 版本归类,用 SHA-256 标出内容重复的文件,可导出 JSON/CSV 清单。**不修改任何文件。** |
| `ORGANIZING_GUIDE.md` | **查重 / 整理 Prompt**。交给 Claude Code 执行的整理规则:把多代历史布局统一并入 `files/<对话码>/`,按内容哈希去重、`__vN` 版本化,垃圾/重复移入 `_trash/`(不直接删)。 |

> 典型用法:先用 `cleanup-report.html` 看清重复情况,再把 `ORGANIZING_GUIDE.md` 交给 Claude Code 实际整理。
