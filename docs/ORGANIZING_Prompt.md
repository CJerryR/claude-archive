# ClaudeArchive 整理手册(交给 Claude Code 执行)· v3(消息版本绑定)

> 目的:把 `ClaudeArchive` 里多个历史版本扩展产生的、命名/布局各不相同的文件,归并成统一结构,
> **按 SHA-256 去重**,并把每个产出文件**重命名为 `<消息uuid前8>__<原名>`**,
> 使查看器能在"点不同消息时精确下载到该消息对应的文件版本"。
> 适用目录:`<下载目录>/ClaudeArchive`(示例:`C:\Users\17372\Downloads\ClaudeArchive`)。
>
> **执行前先整目录备份一次。** 所有"删除"都先移动到 `_trash/`,绝不直接删。

> ⚠️ **为什么要加 `<msg8>__` 前缀(本版核心)**:
> 同一个对话里,12:00 和 13:00 两条消息可能各产出一个 **同名但内容不同**的文件(如都叫 `A.webp`)。
> 查看器靠文件名找文件;若两份都叫 `A.webp`,点哪条消息都只会命中第一份。
> 解决办法:把文件名前面加上**产生它的那条消息的 uuid 前 8 位**——
> 12:00 的 → `a1b2c3d4__A.webp`,13:00 的 → `e5f6a7b8__A.webp`。
> 查看器渲染某条消息的文件时,会优先用该消息的 uuid8 前缀精确命中它自己的版本。
>
> 这取代了旧版的 `__vN` 方案(`__vN` 要靠猜"第几次出现",多分支/补抓时会猜错;`<msg8>__` 是确定性绑定)。

---

## 0. 一句话目标

每个对话:产出文件统一进 `files/<对话uuid前8>/`;
**按内容(SHA-256)去重**;保留的文件**重命名为 `<msg8>__<原名>`**(msg8 = 产生它的消息 uuid 前 8 位);
同一消息内若仍有同名不同内容的,再加 `__v2`/`__v3` 兜底;
垃圾/重复移 `_trash/`;会话正本与 `history/` 不动。

---

## 1. 关键前提:如何确定"文件属于哪条消息"

整理脚本必须读取每个对话的 `conversation.json`,从中建立 **文件 → 消息uuid** 的映射。
遍历 `chat_messages` 数组,对每条消息 `m`(其 `m.uuid` 即该消息 uuid),收集它名下引用的文件:

- **用户上传/附件**:`m.attachments[].file_name`、`m.attachments[].preview_url`、`m.attachments[].file_url`。
- **消息文件**:`m.files[]` / `m.files_v2[]` 的 `file_name`、`preview_url`、`file_url`、`file_uuid`。
- **Claude 生成的文件**:`m.content[]` 里 `type==='tool_result'` 的 `content[]` 中 `type==='local_resource'` 项,
  取其 `file_path`(末段即文件名)、`uuid`、`name`。

把每个文件的"原始文件名(basename)"与"它所属消息的 `m.uuid`"对应起来。
- 一个文件名在多条消息出现 → 它有多个版本,每个版本归属各自消息。
- 用 `m.uuid` 前 8 位(十六进制,小写)作为该版本的前缀 `msg8`。

> 若某磁盘文件在 JSON 里找不到对应消息(无法判定归属),**保留原名不动、只参与哈希去重**,不强加前缀。

---

## 2. 现状:历史命名 / 布局(四代)

| 代 | 布局 | 例子 | 处理 |
|----|------|------|------|
| A 最早(<=v1.8) | `files/<文件>` 平铺 | `files/preview.webp` | 并入 `files/<对话码>/`,加 msg8 前缀 |
| B 中期(v1.9-2.1) | `files/<对话uuid前8>/<文件>` | `files/85523dd2/F_hero.webp` | 保留目录,文件加 msg8 前缀 |
| C 过渡(v2.2-2.4) | `files/r<序号>_<时分秒>_<msg8>/<文件>` | `files/r12_131904_019eb513/viewer.html` | **轮次目录名里已含 msg8**!直接用它当前缀,文件并入 `files/<对话码>/` |
| D 现行(v2.5+) | `files/<对话码>/<msg8>__<原名>` 或 `__vN` | `files/e97526ef/viewer.html` | 目标形态;补齐缺前缀的 |

> 对话顶层目录名:`<对话名>__<对话uuid前8>`,例 `claudesave1__e97526ef`。
> **布局 C 的福利**:轮次目录名 `r12_131904_019eb513` 里第三段 `019eb513` 就是该轮消息 uuid8,
> 可直接作为该目录内文件的 `msg8` 前缀,无需再查 JSON。

### 1.2 去重 / 版本后缀(识别用,求 baseName 时剥掉)
| 规律 | 例子 |
|------|------|
| ` (N)` | `viewer (3).html` |
| `_N` | `preview_3.webp` |
| `__N` | `conversation__2.json` |
| `__<8位hex>` | `p_expanded__a279bc82.webp`(老版文件uuid后缀) |
| `__vN` | `viewer__v2.html` |
| 前导 `<13位时间戳>_` | `1781205852796_home.txt` |
| **前导 `<8位hex>__`** | `e5f6a7b8__A.webp`(**本方案的消息前缀,若已有则别重复加**) |

### 1.3 图片：一律 `.webp`(原始 PNG 拿不到)。
### 1.4 会话级固定文件(绝不动):`conversation.json`、`conversation.md`、`history/`、根 `_index.json`、`_runlog.txt`。
### 1.5 垃圾(移 `_trash/`):`*.crdownload`、`~$*`、手动副本目录、`files/` 里的 `<时间戳>_conversation.json`/`conversation__N.*`/`conversation (N).md`。

---

## 3. 去重 + 重命名(核心流程)

对每个对话,对每个**产出文件**(非正本/history/_index/_runlog)算 **SHA-256**:

1. **求 baseName**:剥掉去重/版本后缀(见第 7 节),得到原始名,如 `A.webp`。
   - 若文件名已是 `<8hex>__xxx` 形式(已有消息前缀),baseName 取 `__` 之后的部分,且记下已有前缀。
2. **定 msg8**(版本归属):
   - 布局 C:取轮次目录名第三段;
   - 其它:用第 1 节的 文件→消息 映射,取该文件所属消息 uuid8;
   - 找不到归属:msg8 = 空(保留原名,仅去重)。
3. **同 (msg8, baseName) 分组去重**:组内哈希相同的只留 mtime 最早一份,余者移 `_trash/`。
4. **目标文件名**:
   - 有 msg8:`<msg8>__<baseName>`;
   - 同一 (msg8, baseName) 下仍有**多个不同哈希**(同消息多次改同名文件,罕见):
     按 mtime 升序,第一个 `<msg8>__<baseName>`,其余 `<msg8>__<stem>__v2.<ext>`、`__v3`;
   - 无 msg8:保留原 baseName(同样按需 `__v2` 防撞)。
5. 把文件 `shutil.move` 到 `files/<对话uuid前8>/<目标文件名>`(目标目录没有就建)。
6. **跨对话不合并、不去重**。去重**只认内容哈希**。

> 例:对话 `claudesave1__e97526ef`,消息 `a1b2c3d4...`@12:00 与 `e5f6a7b8...`@13:00 各产出 `A.webp`(内容不同):
> 结果 `files/e97526ef/a1b2c3d4__A.webp` 与 `files/e97526ef/e5f6a7b8__A.webp`,两份都在,查看器点各自消息精确命中。

---

## 4. 目标结构

```
ClaudeArchive/
  _index.json
  _runlog.txt
  _trash/<原相对路径>/...
  <对话名>__<对话uuid8>/
    conversation.json
    conversation.md
    history/conversation_<ISO>.json ...
    files/
      <对话uuid前8>/
        <msg8>__<原名>            # 例 a1b2c3d4__A.webp
        <msg8>__<原名>            # 例 e5f6a7b8__A.webp(同名不同消息=不同版本)
        <msg8>__<stem>__v2.<ext>  # 仅同一消息同名多版本时
```

---

## 5. 执行步骤(Python:pathlib + hashlib + shutil + json)

> **全程先 dry-run 打印计划,确认后再真正移动。**

1. **备份**:确认已整体复制 `ClaudeArchive`。
2. **逐对话**:读 `conversation.json` → 建 文件basename→消息uuid8 映射(第 1 节)。
3. **扫描** `files/` 下所有产出文件 → 记录 `(相对路径, baseName, 已有前缀?, 推断msg8, SHA256, mtime, 大小)`。
4. **垃圾隔离**(1.5)→ `_trash/`。
5. **去重 + 重命名 + 归位**(第 3 节)→ 移入 `files/<对话码>/<msg8>__<baseName>`。
6. **清空空目录**(被搬空的轮次目录等)。
7. **报告**:`cleanup-report.csv`,每行 `对话, 原路径, 新路径(或→_trash), 动作(move/rename/dedup/trash), msg8, SHA256`。
8. 打印统计。**不要自动清空 `_trash/`**。

---

## 6. 关键正则

```
对话顶层目录:^(?P<name>.+)__(?P<uuid8>[0-9a-f]{8})$
轮次目录(布局C):^r\d+_\d{6}_(?P<msg8>[0-9a-z]{8})$     # 第三段即 msg8
对话码目录(布局B/D):^[0-9a-f]{8}$
已有消息前缀:^(?P<msg8>[0-9a-f]{8})__(?P<base>.+)$
```

## 7. 后缀剥离(求 baseName)

循环剥末尾(扩展名前)后缀,再剥前导时间戳;**注意先剥/识别消息前缀**:
```
^([0-9a-f]{8})__            # 已有消息前缀(记录下来,不重复添加)
^\d{13}_                    # 上传时间戳前缀
\s\(\d+\)(?=\.[^.]+$)       # " (2)"
__v\d+(?=\.[^.]+$)          # "__v2"
__\d+(?=\.[^.]+$)           # "__2"
_\d+(?=\.[^.]+$)            # "_3"
__[0-9a-f]{8}(?=\.[^.]+$)   # "__a279bc82"(老版文件uuid后缀,在末尾)
```
仅剥**紧贴扩展名之前**的后缀;别误伤 `page-1.webp` 的 `-1`、`fig2_x.webp` 中间的 `2_`。

---

## 8. 安全红线

- 绝不 `rm`;一切"删除"= 移 `_trash/`。
- 绝不动 `conversation.json` / `conversation.md` / `history/` / `_index.json` / `_runlog.txt`。
- 跨对话不合并、不去重。
- 先 dry-run 打印完整计划并要求确认。

---

## 9. 查看器兼容性

查看器(`viewer.html` + `viewer.js`,需同目录)的 `resolveAsset()` **最优先用消息 uuid8 前缀**精确命中版本,
其次回退到精确文件名 / stem 匹配。所以:
- 带 `<msg8>__` 前缀的文件 → 点对应消息精确下载该版本(本方案目标);
- 没加前缀的老文件 → 回退按文件名匹配,照常可开。
