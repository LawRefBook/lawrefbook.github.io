from model.law import FetchedLawResponse, FetchedDocumentResponse, LawListItem
from .cache_provider import CacheManager


class Provider:
    def __init__(self) -> None:
        self.cache_manager = CacheManager()

    def fetch(self, page_num=1, page_size=20, **kwargs) -> FetchedLawResponse:
        raise NotImplementedError("Subclasses must implement this method")

    def fetch_document(self, law: LawListItem) -> FetchedDocumentResponse:
        raise NotImplementedError("Subclasses must implement this method")
