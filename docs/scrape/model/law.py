from dataclasses import dataclass
from typing import List
from pathlib import Path


@dataclass
class LawListItem:
    id: str
    title: str
    released_by: str
    type: str
    publication_date: str | None = None
    in_effect_date: str | None = None
    type_code: int | None = None
    file_link: str | None = None

    @property
    def short_title(self) -> str:
        return self.title.replace("中华人民共和国", "")


@dataclass
class FetchedLawResponse:
    total: int
    items: List[LawListItem]


@dataclass
class FetchedDocumentResponse:
    law: LawListItem
    path_to_file: Path | None
