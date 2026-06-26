from collections import defaultdict
from pathlib import Path
from uuid import uuid4
import sys
import re
from typing import List
import peewee

from datetime import datetime
from sqlite3 import Cursor

database = peewee.SqliteDatabase(None)  # Defer initialization


class BaseModel(peewee.Model):
    class Meta:
        database = database  # This model uses the "people.db" database.


class Category(BaseModel):
    id = peewee.UUIDField(primary_key=True, default=uuid4)
    name = peewee.TextField()
    folder = peewee.TextField()
    isSubFolder = peewee.BooleanField(default=False)
    group = peewee.TextField(null=True)
    order = peewee.IntegerField(null=True)

    def __repr__(self) -> str:
        return f"<Category {self.name}>"

    __str__ = __repr__

    @staticmethod
    def get_or_create_category(folder: Path) -> "Category":
        try:
            return Category.get(folder=folder)
        except Category.DoesNotExist:
            pass
        return Category.create(**{"name": folder.parts[-1], "folder": folder})


class Law(BaseModel):
    id = peewee.UUIDField(primary_key=True, default=uuid4)
    level = peewee.TextField()
    name = peewee.TextField(index=True)
    subtitle = peewee.TextField(null=True)

    filename = peewee.TextField(null=True)
    publish = peewee.DateField(formats="%Y-%m-%d", null=True)
    valid_from = peewee.DateField(formats="%Y-%m-%d", null=True)
    valid_to = peewee.DateField(
        formats="%Y-%m-%d", null=False, default="2099-12-31")
    order = peewee.IntegerField(null=True)
    ver = peewee.IntegerField(null=False, default=0)

    tags = peewee.TextField(null=True)

    category_id = peewee.UUIDField(null=False)

    def __repr__(self) -> str:
        return f"<Law {self.name} {self.publish}>"

    __str__ = __repr__

    @staticmethod
    def query_all() -> List["Law"]:
        return Law.select()

    @staticmethod
    def query(name: str = None, publish_at: str | datetime = None) -> List["Law"]:
        if publish_at and isinstance(publish_at, datetime):
            publish_at = publish_at.strftime("%Y-%m-%d")
        expr = None
        if name:
            expr = (Law.name == name) | (Law.subtitle == name)
        if publish_at:
            expr = expr & (Law.publish == publish_at)
        if expr:
            return Law.select().where(expr)
        return []

    def file_path(self):
        cateogry = Category.get(id=self.category_id)
        filename = self.filename
        if not filename:
            filename = self.name
            if self.publish:
                filename += f"({self.publish})"
            filename += ".md"
        base = Path("./")
        return base / cateogry.folder / filename


def get_law_level_by_folder(folder: Path) -> str:
    root_folder = folder.parts[0]
    r = re.match("^((司法解释)|(地方性法规)|(宪法)|(案例)|(行政法规)|(部门规章))$", root_folder)
    if r:
        return root_folder
    return "法律"


class Database(object):
    def __init__(self, sqlite_file: Path) -> None:
        self.tables = [Category, Law]
        self.sqlite_file = sqlite_file
        self.db = database
        self.db.init(sqlite_file)
        self.prepare()

    def prepare(self):
        if self.sqlite_file.exists():
            assert self.sqlite_file.is_file()
        else:
            assert self.sqlite_file.name == "db.sqlite3"
            self.db.create_tables(self.tables)

    def reset(self):
        yes = False
        for _ in range(0, 3):
            yes = input("Are you sure to reset database? [y/N]").lower() == "y"
            if not yes:
                break
        if yes:
            self.db.drop_tables(self.tables)
            self.db.create_tables(self.tables)

    def extract_valid_from(self, content: str, publish):
        valid_since_publish_keys = [
            "本解释公布施行后",
            "自公布之日起施行",
            "自发布之日起施行"
        ]
        for key in valid_since_publish_keys:
            if key in content:
                return publish
        pattern = re.compile(r"自(\d{4})年(\d{1,2})月(\d{1,2})日起施行")
        m = pattern.search(content)
        if m:
            return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        return None

    def read_valid_from(self, law: Law):
        root_folder = self.sqlite_file.parent  # parten of sqlite file
        file_path: Path = root_folder / law.file_path()
        if not file_path.exists():
            raise Exception(f"File not found: {file_path}")
        with open(file_path, "r") as f:
            content = f.read()
        return self.extract_valid_from(content, law.publish)

    # 更新法律版本
    # 如果任意法律有多个版本（即同名，但多个 publish, 则将 ver 设为其数量）
    # 除最新版本的法律, 其余均设为 expired.
    def update_versions(self):
        self.db.execute_sql(
            "update law set ver = (select count(1) from law t where t.name = law.name)"
        )
        laws_multi_version = Law.select().where(Law.ver > 1)
        m = defaultdict(list)
        for law in laws_multi_version:
            m[law.name].append(law)
        expired_laws = []
        for _, laws in m.items():
            levels = set(map(lambda x: x.level, laws))
            if len(levels) > 1:
                print(
                    f"Warning: laws with multiple versions but different levels: {[law.name for law in laws]}")
                continue
            level = levels.pop()
            if level == "司法解释":
                continue

            # ensure all laws has publish date
            if any(map(lambda x: x.publish is None, laws)):
                print(
                    f"Warning: laws with multiple versions but some has no publish date: {[law.name for law in laws]}")
                continue
            laws.sort(key=lambda x: x.publish)

            for i in range(len(laws)):
                law = laws[i]
                extracted_valid_from = self.read_valid_from(law)

                # Determine valid_from for this version
                # law.publish is a date object or None
                publish_str = str(law.publish) if law.publish else None

                if extracted_valid_from:
                    if not publish_str:
                        valid_from = extracted_valid_from
                    else:
                        # Scenario 1 & 2:
                        # If extracted date (from text) is today or future relative to publish date,
                        # it's a future effective law.
                        # If extracted date is in the past relative to publish date,
                        # it's an amendment/republication of an old law, so we use publish date.
                        if extracted_valid_from >= publish_str:
                            valid_from = extracted_valid_from
                        else:
                            valid_from = publish_str
                else:
                    valid_from = publish_str

                if not valid_from:
                    print(
                        f"Warning: {law} has no valid from date and no publish date")
                    continue

                if i > 0:
                    previous_law = laws[i-1]
                    if previous_law.valid_to != valid_from:
                        previous_law.valid_to = valid_from
                        previous_law.save()
                        print(f"✅ {previous_law} 失效于 {valid_from}")

                if law.valid_from != valid_from:
                    law.valid_from = valid_from
                    law.save()
                    print(f"✅ {law} 生效于 {valid_from}")

    @property
    def lookup_path(self) -> Path:
        return self.sqlite_file.parent

    def load_ignore_folders(self):
        ignore_file = self.lookup_path / ".lawignore"
        if not ignore_file.exists():
            return []
        with open(ignore_file, "r") as f:
            return [self.lookup_path / line.strip() for line in f.readlines()]

    def __ignore(self, ignore_folders: List[Path], file: Path) -> bool:
        for ignore_folder in ignore_folders:
            if ignore_folder in file.parents:
                return True

    def load_laws(self):
        ignore_folders = self.load_ignore_folders()
        for markdown_file in self.lookup_path.glob("**/**/*.md"):
            if self.__ignore(ignore_folders, markdown_file):
                # print(f"ignore {markdown_file}")
                continue
            r = re.search(
                r"\((\d{4,4}\-\d{2,2}\-\d{2,2})\)", markdown_file.stem)
            if not r:
                continue
            yield markdown_file, r.group(1), markdown_file.stem[: r.span()[0]]

    def update_law_level(self, laws: List[Law], level: str) -> int:
        updated_count = 0
        for law in filter(lambda x: x.level != level, laws):
            updated_count += 1
            law.level = level
            law.save()
        return updated_count

    def migrate(self):
        # 1. Check existing columns
        cursor = self.db.execute_sql("PRAGMA table_info(law)")
        columns = [row[1] for row in cursor.fetchall()]

        # 2. Add valid_from if not exist
        if 'valid_from' not in columns:
            try:
                self.db.execute_sql(
                    'ALTER TABLE law ADD COLUMN valid_from DATE')
                print("Added valid_from column")
            except Exception as e:
                print(f"Error adding valid_from column: {e}")

        # 3. Add valid_to if not exist
        if 'valid_to' not in columns:
            try:
                # Note: null=False and default requires care in ALTER TABLE
                self.db.execute_sql(
                    "ALTER TABLE law ADD COLUMN valid_to DATE NOT NULL DEFAULT '2099-12-31'")
                print("Added valid_to column")
            except Exception as e:
                print(f"Error adding valid_to column: {e}")

        # 4. Migrate data from expired to valid_to
        if 'expired' in columns:
            try:
                # Set expired ones to 1970-01-01
                self.db.execute_sql(
                    "UPDATE law SET valid_to = '1970-01-01' WHERE expired = 1")
                # Set non-expired ones to default
                self.db.execute_sql(
                    "UPDATE law SET valid_to = '2099-12-31' WHERE expired = 0")
                print("Migrated data from expired to valid_to")

                # Try to drop expired if supported (SQLite 3.35.0+)
                try:
                    self.db.execute_sql("ALTER TABLE law DROP COLUMN expired")
                    print("Dropped expired column")
                except Exception:
                    print(
                        "Could not drop expired column (likely older SQLite version), it will be ignored by the model.")
            except Exception as e:
                print(f"Error migrating data: {e}")

    def validate(self):
        for law_file, publish_at, law_name in self.load_laws():
            content = law_file.read_text(encoding="utf-8")
            lines = content.splitlines()
            titles = list(filter(lambda x: x.startswith("## "), lines))
            if not titles:
                continue

            if len(titles) == len(set(titles)):
                continue

            print(f"Duplicate titles in {law_file}")

            # find line idx == <!-- INFO END -->
            info_end_idx = None
            for idx, line in enumerate(lines):
                if line.strip().startswith("<!-- INFO END -->"):
                    info_end_idx = idx
                    break
            info_end_idx = info_end_idx + 1
            first_title = list(
                filter(
                    lambda x: x[1].replace(
                        " ", "") == titles[0].replace(" ", ""),
                    enumerate(lines),
                )
            )
            start_idx = first_title[-1][0]
            # remove lines betwween info_end_idx and start_idx
            lines = lines[:info_end_idx] + lines[start_idx:]
            law_file.write_text("\n".join(lines), encoding="utf-8")

    def update_database(self):
        count = {
            "laws": self.get_law_count(),
            "handled": 0,
            "updated": 0,
            "created": 0,
        }
        for law_file, publish_at, law_name in self.load_laws():
            count["handled"] += 1

            folder = law_file.relative_to(self.lookup_path).parent
            law_level = get_law_level_by_folder(folder)
            in_db_laws = Law.query(name=law_name, publish_at=publish_at)
            if in_db_laws:
                updated = self.update_law_level(in_db_laws, law_level)
                count["updated"] += updated
                continue
            # Law 不存在于数据库中
            category = Category.get_or_create_category(folder)
            Law.create(
                name=law_name,
                publish=publish_at,
                category_id=category.id,
                level=law_level,
            )
            count["created"] += 1
        self.update_versions()
        self.update_category()
        count["invalidated"] = self.invalidate_laws()
        return count

    def update_category(self):
        # if it's dlc, the filepath is ./DLC*/
        # then it should only has 1 category
        # and make sure the subfolder is True
        isDLC = "DLC" in self.sqlite_file.parts
        if not isDLC:
            print("Not DLC, skip update category")
            return
        categories = Category.select()
        assert len(categories) == 1
        category = categories[0]

        changed = False

        if not category.isSubFolder:
            print("Setting subfolder to True")
            category.isSubFolder = True
            changed = True

        if not category.group:
            print("Setting group to 地方法规")
            category.group = "地方法规"
            changed = True

        if changed:
            category.save()

    def extract_abolished_law_names(self, content: str) -> List[str]:
        # 匹配紧邻「（同时）废止」之前、由、和，分隔的连续《...》法律名
        # 避免匹配「修改或者废止」「修订、废止」等无具体法律名的情形
        names = []
        clause = re.compile(r"((?:《[^》]+》[、和，]?)+)(?:同时)?废止")
        for m in clause.finditer(content):
            for name_m in re.finditer(r"《([^》]+)》", m.group(1)):
                # 去除「中华人民共和国」前缀以匹配数据库中存储的法律名
                name = re.sub(r"^中华人民共和国", "", name_m.group(1))
                names.append(name)
        return names

    def invalidate_laws(self):
        print("Invalidating laws")
        count = 0
        for law_file, publish_at, law_name in self.load_laws():
            content = law_file.read_text(encoding="utf-8")
            abolished_names = self.extract_abolished_law_names(content)
            if not abolished_names:
                continue

            valid_from = self.extract_valid_from(
                content, publish_at) or publish_at
            if not valid_from:
                print(f"Warning: {law_name}({publish_at}) 含废止条款但无生效日期")
                continue

            for name in abolished_names:
                # 同名版本之间的失效衔接由 update_versions 处理，此处只处理跨法律废止
                if name == law_name:
                    continue
                versions = list(Law.query(name=name))
                if not versions:
                    continue
                # 取最后一个版本，将其 valid_to 设为废止法律的生效日期
                versions.sort(key=lambda x: x.publish or "")
                last = versions[-1]
                # 仅当该版本在废止生效日期之前已发布时才失效；
                # 否则多为同名但实为另一部法律（如旧《国家安全法》→《反间谍法》）
                if last.publish and str(last.publish) >= str(valid_from):
                    continue
                if str(last.valid_to) != str(valid_from):
                    last.valid_to = valid_from
                    last.save()
                    print(f"✅ {last} 因《{law_name}》废止于 {valid_from}")
                    count += 1

        return count

    def get_law_count(self):
        return Law.select().count()


def main():
    args = sys.argv[1:]
    if len(args) != 2:
        print("Usage: python3 database.py <command(update/drop)> <sqlite_file>")
        return
    command = args[0]
    sqlite_file = Path(args[1])
    db = Database(sqlite_file)

    if command == "drop":
        db.reset()
        return

    if command == "update":
        count = db.update_database()
        print(f"Total: {count['laws']}")
        print(f"Handled: {count['handled']}")
        print(f"Updated: {count['updated']}")
        print(f"Created: {count['created']}")
        print(f"Invalidated: {count['invalidated']}")
        return

    if command == "migrate":
        db.migrate()
        return

    print("Unknown command")


if __name__ == "__main__":
    main()
