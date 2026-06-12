#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ClaudeArchive 整理 / 查重工具(独立运行,无需 Claude Code)
================================================================
功能(对应 ORGANIZING_GUIDE.md v3):
  1) 按 SHA-256 内容去重(同一对话内,同名同内容只留一份,其余移入 _trash/)
  2) 把每个产出文件重命名为  <消息uuid前8>__<原名>  (msg8 绑定)
     —— 这样在查看器里点不同消息能精确下载到对应版本的文件
  3) 把零散布局(平铺 / 轮次目录)统一并入  files/<对话uuid前8>/
  4) 隔离垃圾文件(.crdownload / ~$ 锁文件 / 误存的会话正本副本)到 _trash/

安全:
  * 默认 dry-run(只打印计划,不动文件)。确认无误后加 --apply 真正执行。
  * 一切“删除”= 移动到 ClaudeArchive/_trash/(保留原相对路径),绝不真删。
  * 绝不动 conversation.json / conversation.md / history/ / _index.json / _runlog.txt。
  * 跨对话不合并、不去重。

用法:
  预览:  python organize_archive.py "C:\\Users\\17372\\Downloads\\ClaudeArchive"
  执行:  python organize_archive.py "C:\\Users\\17372\\Downloads\\ClaudeArchive" --apply
  (不传路径则尝试当前目录;Windows 双击运行会提示输入路径)
"""

import sys, os, re, json, hashlib, shutil, csv
from pathlib import Path
from datetime import datetime

# ---------- 常量 ----------
CANONICAL = {'conversation.json', 'conversation.md', '_index.json', '_runlog.txt'}
JUNK_SUFFIX = ('.crdownload',)
RE_CONV_DIR   = re.compile(r'^(?P<name>.+)__(?P<uuid8>[0-9a-f]{8})$', re.I)
RE_ROUND_DIR  = re.compile(r'^r\d+_\d{6}_(?P<msg8>[0-9a-z]{8})$', re.I)
RE_CODE_DIR   = re.compile(r'^[0-9a-f]{8}$', re.I)
RE_HAS_PREFIX = re.compile(r'^(?P<msg8>[0-9a-f]{8})__(?P<base>.+)$', re.I)
# 误存进 files/ 的会话正本副本
RE_CONV_COPY  = re.compile(r'^(?:\d{13}_)?conversation(?:[ _]?\(\d+\)|__\d+)?\.(?:json|md)$', re.I)

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def strip_to_base(name: str) -> str:
    """剥掉去重/版本后缀求 baseName(供分组)。先剥已有消息前缀与时间戳前缀,再循环剥末尾后缀。"""
    s = name
    m = RE_HAS_PREFIX.match(s)
    if m:
        s = m.group('base')          # 去掉已有 <msg8>__
    s = re.sub(r'^\d{13}_', '', s)    # 去掉前导时间戳
    # 循环剥末尾(扩展名前)的后缀
    while True:
        s2 = re.sub(r'\s\(\d+\)(?=\.[^.]+$)', '', s)   # " (2)"
        s2 = re.sub(r'__v\d+(?=\.[^.]+$)', '', s2)      # "__v2"
        s2 = re.sub(r'__\d+(?=\.[^.]+$)', '', s2)       # "__2"
        s2 = re.sub(r'_\d+(?=\.[^.]+$)', '', s2)        # "_3"
        s2 = re.sub(r'__[0-9a-f]{8}(?=\.[^.]+$)', '', s2, flags=re.I)  # "__a279bc82"
        if s2 == s:
            break
        s = s2
    return s

def split_ext(name: str):
    d = name.rfind('.')
    return (name[:d], name[d:]) if d > 0 else (name, '')

def build_file_to_msg(conv_json: Path):
    """读 conversation.json,建 文件basename(小写) -> [消息uuid8...] 映射(按出现顺序)。"""
    mapping = {}
    try:
        data = json.loads(conv_json.read_text(encoding='utf-8'))
    except Exception:
        return mapping
    def add(fname, muuid):
        if not fname or not muuid:
            return
        base = strip_to_base(str(fname)).lower()
        m8 = re.sub(r'[^0-9a-f]', '', str(muuid).lower())[:8]
        if len(m8) != 8:
            return
        mapping.setdefault(base, [])
        if m8 not in mapping[base]:
            mapping[base].append(m8)
    for m in (data.get('chat_messages') or []):
        mu = m.get('uuid')
        for a in (m.get('attachments') or []):
            add(a.get('file_name'), mu)
        for f in (m.get('files') or []) + (m.get('files_v2') or []):
            add(f.get('file_name') or f.get('file_uuid'), mu)
        for b in (m.get('content') or []):
            if isinstance(b, dict) and b.get('type') == 'tool_result':
                for it in (b.get('content') or []):
                    if isinstance(it, dict) and it.get('type') == 'local_resource' and it.get('file_path'):
                        add(str(it['file_path']).split('/')[-1], mu)
    return mapping

def is_junk(name: str) -> bool:
    low = name.lower()
    if low.endswith(JUNK_SUFFIX):
        return True
    if name.startswith('~$'):
        return True
    if RE_CONV_COPY.match(name):
        return True
    return False

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    apply = '--apply' in sys.argv
    root = Path(args[0]).expanduser() if args else Path.cwd()
    if not root.exists():
        # Windows 双击场景:交互式询问
        try:
            root = Path(input('请输入 ClaudeArchive 文件夹路径: ').strip().strip('"')).expanduser()
        except Exception:
            pass
    if not root.exists() or not root.is_dir():
        print(f'路径无效: {root}'); sys.exit(1)

    print('=' * 64)
    print(f'ClaudeArchive 整理工具  目录: {root}')
    print(f'模式: {"实际执行 (--apply)" if apply else "预览 dry-run(加 --apply 才真正移动)"}')
    print('提示: 建议先整目录备份一份再 --apply。')
    print('=' * 64)

    trash = root / '_trash'
    report_rows = []
    n_move = n_dedup = n_trash = n_keep = 0

    def plan_trash(src: Path, why: str):
        nonlocal n_trash
        rel = src.relative_to(root)
        dst = trash / rel
        report_rows.append((src.parent.name, str(rel), f'->_trash ({why})', 'trash', '', ''))
        print(f'  [垃圾] {rel}  ->  _trash/  ({why})')
        if apply:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        n_trash += 1

    # 遍历每个对话目录
    for conv_dir in sorted([d for d in root.iterdir() if d.is_dir() and d.name != '_trash']):
        mc = RE_CONV_DIR.match(conv_dir.name)
        conv_code = mc.group('uuid8').lower() if mc else None
        files_root = conv_dir / 'files'
        if not files_root.exists():
            continue
        print(f'\n■ 对话: {conv_dir.name}')

        f2m = build_file_to_msg(conv_dir / 'conversation.json')
        target_dir = files_root / (conv_code or 'unknown')

        # 收集所有产出文件
        records = []  # (path, base, msg8, sha, mtime)
        for p in files_root.rglob('*'):
            if not p.is_file():
                continue
            rel_in_conv = p.relative_to(conv_dir)
            # 跳过 history / 正本
            if 'history' in rel_in_conv.parts or p.name in CANONICAL:
                continue
            if is_junk(p.name):
                plan_trash(p, '临时/锁/正本副本')
                continue
            base = strip_to_base(p.name)
            # 推断 msg8
            msg8 = None
            mpfx = RE_HAS_PREFIX.match(p.name)
            if mpfx:
                msg8 = mpfx.group('msg8').lower()
            else:
                # 布局 C:父目录是轮次目录
                rd = RE_ROUND_DIR.match(p.parent.name)
                if rd:
                    msg8 = rd.group('msg8').lower()
                else:
                    cands = f2m.get(base.lower()) or []
                    if len(cands) == 1:
                        msg8 = cands[0]
                    elif len(cands) > 1:
                        # 多版本:本脚本无法确定该物理文件对应第几个消息,保守不强加
                        msg8 = None
            try:
                mtime = p.stat().st_mtime
            except Exception:
                mtime = 0
            records.append([p, base, msg8, None, mtime])

        # 计算哈希
        for r in records:
            try:
                r[3] = sha256(r[0])
            except Exception:
                r[3] = None

        # 分组: (msg8, base.lower())
        groups = {}
        for r in records:
            key = (r[2] or '', r[1].lower())
            groups.setdefault(key, []).append(r)

        for (msg8, baselow), rs in groups.items():
            rs.sort(key=lambda x: x[4])  # mtime 升序
            # 同组内按哈希去重
            seen_hash = {}
            kept = []
            for r in rs:
                h = r[3]
                if h and h in seen_hash:
                    # 重复 -> _trash
                    rel = r[0].relative_to(root)
                    report_rows.append((conv_dir.name, str(rel), '->_trash (dup)', 'dedup', msg8, h))
                    print(f'  [去重] {rel}  ->  _trash/  (与 {seen_hash[h].name} 同内容)')
                    if apply:
                        dst = trash / rel; dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(r[0]), str(dst))
                    n_dedup += 1
                else:
                    if h:
                        seen_hash[h] = r[0]
                    kept.append(r)
            # 为保留文件计算目标名(同组多个不同哈希 -> __v2/__v3)
            base = kept[0][1] if kept else baselow
            stem, ext = split_ext(base)
            for i, r in enumerate(kept):
                if msg8:
                    tgt = f'{msg8}__{base}' if i == 0 else f'{msg8}__{stem}__v{i+1}{ext}'
                else:
                    tgt = base if i == 0 else f'{stem}__v{i+1}{ext}'
                dst = target_dir / tgt
                src = r[0]
                if src.resolve() == dst.resolve():
                    n_keep += 1
                    report_rows.append((conv_dir.name, str(src.relative_to(root)), '保持', 'keep', msg8 or '', r[3] or ''))
                    continue
                # 目标已存在且内容相同 -> 源是重复
                if dst.exists():
                    try:
                        if r[3] and sha256(dst) == r[3]:
                            rel = src.relative_to(root)
                            print(f'  [去重] {rel}  ->  _trash/  (目标已存在相同内容)')
                            report_rows.append((conv_dir.name, str(rel), '->_trash (dup)', 'dedup', msg8 or '', r[3] or ''))
                            if apply:
                                d2 = trash / rel; d2.parent.mkdir(parents=True, exist_ok=True); shutil.move(str(src), str(d2))
                            n_dedup += 1
                            continue
                    except Exception:
                        pass
                    # 目标存在但内容不同 -> 顺延版本号
                    k = i + 2
                    while dst.exists():
                        tgt = f'{msg8}__{stem}__v{k}{ext}' if msg8 else f'{stem}__v{k}{ext}'
                        dst = target_dir / tgt; k += 1
                action = 'rename' if src.parent.resolve() == target_dir.resolve() else 'move'
                print(f'  [{ "改名" if action=="rename" else "归位" }] {src.relative_to(conv_dir)}  ->  files/{conv_code}/{tgt}')
                report_rows.append((conv_dir.name, str(src.relative_to(root)), f'files/{conv_code}/{tgt}', action, msg8 or '', r[3] or ''))
                if apply:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), str(dst))
                n_move += 1

        # 清空被搬空的轮次/老目录
        if apply:
            for d in sorted([x for x in files_root.rglob('*') if x.is_dir()], key=lambda x: -len(x.parts)):
                try:
                    if d.resolve() != target_dir.resolve() and not any(d.iterdir()):
                        d.rmdir()
                except Exception:
                    pass

    # 写报告
    rep = root / 'cleanup-report.csv'
    try:
        with open(rep, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['对话', '原路径', '新路径/去向', '动作', 'msg8', 'SHA256'])
            w.writerows(report_rows)
        print(f'\n报告已写出: {rep}')
    except Exception as e:
        print(f'报告写出失败: {e}')

    print('\n' + '=' * 64)
    print(f'统计  归位/改名 {n_move} · 去重 {n_dedup} · 垃圾 {n_trash} · 保持 {n_keep}')
    if not apply:
        print('当前为预览模式,未移动任何文件。确认无误后重新运行并加  --apply')
    else:
        print('已执行。重复/垃圾文件在 _trash/,人工确认后再手动删除。')
    print('=' * 64)
    if os.name == 'nt' and not args:
        try: input('\n按回车关闭…')
        except Exception: pass

if __name__ == '__main__':
    main()
