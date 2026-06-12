# tools/ — 历史文件整理工具

| 文件 | 用途 |
|------|------|
| `cleanup-report.html` | **查重报告**(只读)。浏览器打开,选中 `ClaudeArchive` 文件夹,SHA-256 标出重复文件,导出 JSON/CSV。不修改任何文件。 |
| `ORGANIZING_GUIDE.md` | **查重/整理 Prompt(v3)**。交给 Claude Code 执行:按内容哈希去重,并把产出文件重命名为 `<消息uuid前8>__<原名>`,使查看器能按消息精确定位文件版本。 |
