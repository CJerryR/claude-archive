Claude Archive Suite v2.8.0
===========================
1) extension/   -> the browser extension. Install: Extensions page -> Developer mode ->
   Load unpacked -> select this folder.
2) viewer/viewer.html -> double-click to open the local viewer; pick your ClaudeArchive folder.
3) tools/ -> cleanup-report.html (read-only history report) + ORGANIZING_GUIDE.md (rules for Claude Code).
4) GETTING_STARTED.md -> beginner guide (Chinese text inside).

This release fixes: save logic (never overwrite / skip identical hash / bump __vN on name clash,
no more Windows rename dialog), silent download, viewer scrolls to latest message & branch,
keyword highlight, inline-code color. See CHANGELOG.md.
