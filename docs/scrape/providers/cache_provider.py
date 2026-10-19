import json
import logging
import re
from enum import Enum
from pathlib import Path
from typing import Any, List, Dict, Set
from functools import wraps
from hashlib import sha1

import requests
import urllib.parse

logger = logging.getLogger(__name__)


class CacheType(Enum):
    WebPage = "api"
    WordDocument = "words"
    HTMLDocument = "html"


class CacheManager(object):
    def __init__(self) -> None:
        self.base_path = Path("./__cache__")

    def get(self, key: str, type: CacheType, filetype=None):
        full_path = self.__get_path(key, type, filetype)
        if not full_path.exists():
            return None
        try:
            with open(full_path, "r") as f:
                if filetype == "json":
                    return json.load(f)
                return f.read()
        except Exception as e:
            logger.error(e)
        return None

    def set(self, key: str, type: CacheType, data: Any, filetype=None):
        full_path = self.__get_path(key, type, filetype)
        with open(full_path, "w") as f:
            if filetype == "json":
                json.dump(data, f, ensure_ascii=False, indent=4)
            else:
                f.write(data if isinstance(data, str) else str(data))

    def download_binary(self, url: str, type: CacheType, headers=None) -> Path | None:
        u = urllib.parse.urlparse(url)

        # https://flkoss.obs-bj2.cucloud.cn/prod/20251128/5f98d6b9eca7456aa8e53a9f73ef7c7e.docx
        # extract the filename `5f98d6b9eca7456aa8e53a9f73ef7c7e.docx`
        filename = u.path.split("/")[-1]

        name = filename
        path = self.__get_path(name, type)
        if not path.exists():
            try:
                response = requests.get(url, headers=headers, stream=True)
                response.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
            except Exception as e:
                logger.error(f"Failed to download {url}: {e}")
                if path.exists():
                    path.unlink()
                return None
        return path

    def list(self, type: CacheType):
        p: Path = self.base_path / type.value
        return [f.name for f in p.iterdir()]

    def __get_path(self, key: str, type: CacheType, filetype=None) -> Path:
        if filetype:
            key = f"{key}.{filetype}"
        p: Path = self.base_path / type.value
        if not p.exists():
            p.mkdir(parents=True)
        return p / key

    # def is_exists(self, key: str, type: CacheType, filetype=None):
    #     full_path = self.path(key, type, filetype)
    #     return full_path.exists(), full_path

    # def get(self, key: str, type: CacheType, filetype=None):
    #     full_path = self.path(key, type, filetype)
    #     if not full_path.exists():
    #         return None
    #     try:
    #         with open(full_path, "r") as f:
    #             if filetype == "json":
    #                 return json.load(f)
    #             return f.read()
    #     except Exception as e:
    #         logger.error(e)
    #     return None

    # def set(self, key: str, type: CacheType, data: Any, filetype=None):
    #     full_path = self.path(key, type, filetype)
    #     with open(full_path, "w") as f:
    #         if filetype == "json":
    #             json.dump(data, f, ensure_ascii=False, indent=4)
    #         else:
    #             f.write(data if isinstance(data, str) else str(data))

    # @property
    # def OUTPUT_PATH(self):
    #     p = self.base_path / "out"
    #     if not p.exists():
    #         p.mkdir(parents=True)
    #     return p

    def get_all_laws(self) -> Dict[str, Set[str]]:
        full_path = self.base_path / "out"
        r = re.compile(r"(.+)\((\d{4}-\d{2}-\d{2})\)\.md")
        normalized_laws = {}
        for f in full_path.glob("**/*.md"):
            match = r.match(f.name)
            if not match:
                continue
            title = match.group(1)
            date = match.group(2)
            if title not in normalized_laws:
                normalized_laws[title] = set()
            normalized_laws[title].add(date)
        return normalized_laws

    def write_law(self, path: Path, data: List[str]):
        full_path = self.base_path / "out" / path
        folder_path = full_path.parent
        if not folder_path.exists():
            folder_path.mkdir(parents=True)
        with open(full_path, "w") as f:
            result = "\n\n".join(data)
            result = result.replace("<!-- TABLE -->\n", "<!-- TABLE -->")
            result = result.replace(
                "\n<!-- TABLE END -->", "<!-- TABLE END -->")
            result = result.replace("|\n\n|", "|\n|")
            result = re.sub("\n{2,}", "\n\n", result)
            f.write(result)

    # def word_output_path(self, key: str, type: CacheType, path: Path | str):
    #     p = self.base_path / type.value / path
    #     if not p.exists():
    #         p.mkdir(parents=True)
    #     return p / key


cache_manager = CacheManager()


def cache(type: CacheType, filetype=None):
    def decorator(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            cache_key = f"{func.__name__}_" + "_".join(
                [str(arg) for arg in args] +
                [f"{k}-{v}" for k, v in kwargs.items()]
            )
            cached_data = cache_manager.get(
                cache_key, type, filetype)
            if cached_data is not None:
                return cached_data
            result = func(self, *args, **kwargs)
            cache_manager.set(cache_key, type, result, filetype)
            return result
        return wrapper
    return decorator
