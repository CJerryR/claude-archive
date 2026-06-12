# tools/ — 历史文件整理工具

| 文件 | 用途 |
|------|------|
| `organize_archive.py` | **独立整理/查重脚本(推荐,无需 Claude Code)**。Python 运行,按 SHA-256 去重并把产出文件重命名为 `<消息uuid前8>__<原名>`,使查看器能按消息精确定位版本。默认 dry-run,加 `--apply` 执行;“删除”移入 `_trash/`,不动正本/history;生成 `cleanup-report.csv`。 |
| `cleanup-report.html` | **查重报告(只读网页)**。浏览器打开选中 ClaudeArchive,SHA-256 标出重复文件,导出 JSON/CSV。不改任何文件。 |
| `ORGANIZING_GUIDE.md` | **整理规则说明(v3)**,`organize_archive.py` 即按此实现。 |

## 用 organize_archive.py
```bash
python organize_archive.py "C:\Users\你\Downloads\ClaudeArchive"          # 预览
python organize_archive.py "C:\Users\你\Downloads\ClaudeArchive" --apply  # 执行
```
需 Python 3.8+。执行前请整目录备份;去重/垃圾移入 `_trash/`,确认后再手动删。
