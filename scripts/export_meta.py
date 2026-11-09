#!/usr/bin/env python3
"""从 Laws 仓库的数据库导出网站用的法律信息，写到 data/laws.json，由 Hugo 模板读取。

导出的内容和 App 的规则一致（见 App 的 TLaw、LawVersions、LawDatabase）：
  - 每部法律的状态：现行、未施行、已修订、已废止、已失效
  - 版本：同一部法律的各个版本（修订链，没有修订关系时按同名），列表里只显示一个版本
  - 分类名称、分组和排序，法律在分类里的排序
  - 首页的修订动态：最近半年修订的、即将施行的
  - 收录统计

用法：python3 scripts/export_meta.py [法律目录，默认 content/docs] [输出文件，默认 data/laws.json]
只用标准库，CI 里不需要装依赖。
"""

import hashlib
import json
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# 状态按北京时间的日期算，和网站的读者一致
TODAY = datetime.now(timezone(timedelta(hours=8))).date()
# 数据库里现行法律的失效日期默认是 2099-12-31，不是真正的失效日期；
# 部分已失效的法律不知道哪天失效，记成 1970-01-01
FOREVER_YEAR = 2099
UNKNOWN_DATE = date(1970, 1, 1)
RECENT_MONTHS = 6


def parse_date(text):
    if not text:
        return None
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def iso(d):
    return d.isoformat() if d else None


def table_names(conn):
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


class Law:
    def __init__(self, row, category, key):
        self.id = row["id"]
        self.name = row["name"]
        self.level = row["level"]
        self.publish = parse_date(row["publish"])
        self.valid_from = parse_date(row["valid_from"])
        valid_to = parse_date(row["valid_to"])
        self.valid_to = valid_to
        self.known_valid_to = valid_to if valid_to and valid_to.year < FOREVER_YEAR and valid_to != UNKNOWN_DATE else None
        self.order = row["order"]
        self.category = category
        self.key = key
        self.lineage = None
        self.superseded = False
        self.abolisher = None

    # 和 App 一样：失效日期当天起失效，施行日期当天起施行
    @property
    def expired(self):
        return self.valid_to is not None and self.valid_to <= TODAY

    @property
    def pending(self):
        return self.valid_from is not None and self.valid_from > TODAY

    @property
    def in_force(self):
        return not self.expired and not self.pending

    # 排版本先后用的日期，见 App 的 TLaw.versionDate
    @property
    def version_date(self):
        d = self.publish or self.valid_from
        if d:
            return (d, 1)
        if self.expired:
            # 一定早于在它失效当天公布的新版
            return (self.valid_to, 0)
        return None

    @property
    def status(self):
        if self.expired:
            if self.superseded:
                return "revised"
            if self.abolisher:
                return "abolished"
            return "expired"
        if self.pending:
            return "pending"
        return "current"


def newest_first(laws):
    return sorted(laws, key=lambda l: l.version_date or (date.min, 0), reverse=True)


def file_candidates(category_folder, row):
    """App 找正文文件的顺序，见 TLaw.getNames"""
    names = []
    if row["filename"]:
        names.append(row["filename"])
    elif row["publish"]:
        names.append(f"{row['name']}({str(row['publish'])[:10]})")
    names.append(row["name"])
    if row.get("subtitle"):
        names.append(row["subtitle"])
    return [f"{category_folder}/{n}" for n in names]


def read_database(db_path, content_root, prefix):
    """读一个数据库。prefix 是这个库的法律目录相对 content_root 的位置，本体库为空"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    tables = table_names(conn)

    categories = {}
    for row in conn.execute('SELECT * FROM category ORDER BY "order"'):
        folder = prefix + row["folder"]
        categories[row["id"]] = {
            "folder": folder,
            "name": row["name"],
            "group": row["group"],
            "order": row["order"],
        }

    law_cols = columns(conn, "law")
    laws = []
    missing = 0
    for row in conn.execute("SELECT * FROM law"):
        row = dict(row)
        row.setdefault("subtitle", None)
        category = categories.get(row["category_id"])
        if not category:
            continue
        key = None
        for candidate in file_candidates(category["folder"], row):
            if (content_root / f"{candidate}.md").is_file():
                key = candidate
                break
        if key is None:
            missing += 1
            continue
        if "valid_to" not in law_cols:
            row["valid_to"] = None
        laws.append(Law(row, category, key))

    by_id = {law.id: law for law in laws}

    # 修订链：source 替代了 target。每个版本记修订链上最早版本的 id，见 App 的 TRelationship.lineages
    previous = {}
    abolishers = {}
    if "relationship" in tables:
        for source, target in conn.execute("SELECT source_id, target_id FROM relationship WHERE type='supersedes'"):
            previous[source] = target
        for target, source in conn.execute("SELECT target_id, source_id FROM relationship WHERE type='abolishes'"):
            abolishers[target] = source

    lineages = {}
    for law_id in set(previous) | set(previous.values()):
        root, visited = law_id, {law_id}
        while root in previous and previous[root] not in visited:
            root = previous[root]
            visited.add(root)
        lineages[law_id] = root
    superseded = set(previous.values())

    for law in laws:
        law.superseded = law.id in superseded
        # 不在修订链上的法律按同名算，限在同一个分类里
        if law.id in lineages:
            law.lineage = f"{prefix}#{lineages[law.id]}"
        else:
            law.lineage = f"{prefix}#{law.category['folder']}:{law.name}"
        source = by_id.get(abolishers.get(law.id))
        if source:
            # 按编拆开的法典显示法典名，链接到法典的目录，见 App 的 TRelationship.abolishers
            code = source.category["name"]
            if source.name.startswith(code + " "):
                law.abolisher = {"name": code, "section": source.category["folder"]}
            else:
                law.abolisher = {"name": source.name, "key": source.key}
        elif law.id in abolishers:
            # 废止它的法律不在网站上，只写状态，不链接
            law.abolisher = {"name": None}

    conn.close()
    return list(categories.values()), laws, missing


def law_sort_key(law):
    """分类里的顺序，见 App 的 TCategory.sortedLaws"""
    vd = law.publish or date.min
    return (law.order is None, law.order or 0, law.name, -vd.toordinal())


def short_id(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def export(content_root, out_path):
    databases = [(content_root / "db.sqlite3", "")]
    for db in sorted((content_root / "DLC").glob("*/db.sqlite3")):
        databases.append((db, f"DLC/{db.parent.name}/"))

    all_categories = []
    all_laws = []
    for db_path, prefix in databases:
        if not db_path.is_file():
            continue
        categories, laws, missing = read_database(db_path, content_root, prefix)
        all_categories.extend(categories)
        all_laws.extend(laws)
        label = prefix.rstrip("/") or "本体"
        print(f"{label}: {len(laws)} 部法律" + (f"，{missing} 部找不到正文文件" if missing else ""), file=sys.stderr)

    groups = {}
    for law in all_laws:
        groups.setdefault(law.lineage, []).append(law)

    laws_out = {}
    lineages_out = {}
    feed_recent, feed_upcoming = [], []
    listed = set()

    for lineage, versions in groups.items():
        versions = newest_first(versions)
        lineage_id = short_id(lineage)
        # 列表里每部法律只显示一个版本：优先现在有效的，其次是最新的（App 的 currentVersions）
        shown = next((v for v in versions if v.in_force), versions[0])
        listed.add(shown.id)
        upcoming = None
        if shown.in_force and shown.version_date:
            newer = [v for v in versions if v.version_date and v.version_date > shown.version_date and v.pending]
            if newer:
                upcoming = min(newer, key=lambda v: v.valid_from)
        if len(versions) > 1:
            lineages_out[lineage_id] = [v.key for v in versions]

        for v in versions:
            entry = {
                "name": v.name,
                "level": v.level,
                "status": v.status,
                "pub": iso(v.publish),
                "from": iso(v.valid_from),
                "to": iso(v.known_valid_to),
                "versions": len(versions),
            }
            if len(versions) > 1:
                entry["lineage"] = lineage_id
            if v.id == shown.id:
                entry["list"] = True
                if upcoming:
                    entry["upcoming"] = {"key": upcoming.key, "from": iso(upcoming.valid_from)}
            elif v.status != "abolished":
                # 不是列表里显示的版本时，正文顶部提示去看哪一版
                entry["replacement"] = {
                    "key": shown.key,
                    "pub": iso(shown.publish),
                    "from": iso(shown.valid_from),
                    "pending": shown.pending,
                }
            if v.abolisher:
                entry["abolisher"] = v.abolisher
            laws_out[v.key] = entry

        # 修订动态，见 App 的 LawRevisionFeed：每部法律只看最新版本
        latest = versions[0]
        if latest.publish and not latest.expired:
            if latest.pending and latest.valid_from:
                feed_upcoming.append(latest)
            elif latest.publish >= TODAY - timedelta(days=RECENT_MONTHS * 30) and len(versions) > 1:
                feed_recent.append(latest)

    # 法律在分类里的顺序；列表里相邻的两部（只算列出的版本），用于正文页的“上一部”“下一部”
    by_category = {}
    for law in all_laws:
        by_category.setdefault(law.category["folder"], []).append(law)
    for folder, laws in by_category.items():
        ordered = sorted(laws, key=law_sort_key)
        for rank, law in enumerate(ordered):
            laws_out[law.key]["rank"] = rank
        shown = [law for law in ordered if law.id in listed]
        for i, law in enumerate(shown):
            if i > 0:
                laws_out[law.key]["prev"] = shown[i - 1].key
            if i < len(shown) - 1:
                laws_out[law.key]["next"] = shown[i + 1].key

    categories_out = {}
    # 没有 _index.md 的目录 Hugo 不当作分类，里面的法律会并到上一级。
    # 网站的 content/_content.gotmpl 按这个列表补上分类页，见那个文件
    sections_out = []
    for c in all_categories:
        count = sum(1 for law in by_category.get(c["folder"], []) if law.id in listed)
        categories_out[c["folder"]] = {
            "name": c["name"],
            "group": c["group"] or "",
            "order": c["order"] if c["order"] is not None else 9999,
            "count": count,
        }
        folder = content_root / c["folder"]
        if folder.is_dir() and not (folder / "_index.md").is_file():
            sections_out.append({"key": c["folder"], "title": c["name"]})
    # 各地的地方性法规放在 DLC/<地区>地方法规/地方性法规/<地区> 下，补一个总的分类把它们放在一起
    if (content_root / "DLC").is_dir() and not (content_root / "DLC" / "_index.md").is_file():
        sections_out.append({"key": "DLC", "title": "地方性法规"})
    sections_out.sort(key=lambda s: s["key"])

    # 收录统计：每部法律算一次，不算历史版本
    stats = {}
    for law in all_laws:
        if law.id not in listed:
            continue
        level = "地方性法规" if law.key.startswith("DLC/") else law.level
        stats[level] = stats.get(level, 0) + 1

    feed_recent.sort(key=lambda l: (l.publish, l.name), reverse=True)
    feed_upcoming.sort(key=lambda l: (l.valid_from, l.name))

    out = {
        "updated": TODAY.isoformat(),
        "stats": stats,
        "categories": categories_out,
        "sections": sections_out,
        "feed": {
            "recent": [l.key for l in feed_recent],
            "upcoming": [l.key for l in feed_upcoming],
        },
        "lineages": lineages_out,
        "laws": laws_out,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # 每部法律一行，内容更新时 git 的差异小
    with out_path.open("w", encoding="utf-8") as f:
        f.write("{\n")
        for i, (name, value) in enumerate(out.items()):
            sep = "," if i < len(out) - 1 else ""
            if name in ("laws", "lineages", "categories"):
                f.write(f"{json.dumps(name)}: {{\n")
                items = sorted(value.items())
                for j, (k, v) in enumerate(items):
                    comma = "," if j < len(items) - 1 else ""
                    f.write(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False, sort_keys=True)}{comma}\n")
                f.write(f"}}{sep}\n")
            else:
                f.write(f"{json.dumps(name)}: {json.dumps(value, ensure_ascii=False, sort_keys=True)}{sep}\n")
        f.write("}\n")

    print(f"共 {len(laws_out)} 个文件，{len(listed)} 部法律 → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/docs")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data/laws.json")
    if not (root / "db.sqlite3").is_file():
        sys.exit(f"找不到 {root / 'db.sqlite3'}，先拉取 content/docs 子模块")
    export(root, out)
