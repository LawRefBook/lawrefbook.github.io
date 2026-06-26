import requests
from model.law import FetchedLawResponse, LawListItem, FetchedDocumentResponse
from .base import Provider
from .cache_provider import cache, CacheType
import re


class NationalLawDatabaseProvider(Provider):
    BASE_URL = "https://flk.npc.gov.cn"
    HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://flk.npc.gov.cn",
        "Referer": "https://flk.npc.gov.cn/search",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
    }

    def fetch(self, page_num=1, page_size=20, **kwargs) -> FetchedLawResponse:
        response = self.__search(
            page_num=page_num,
            page_size=page_size,
            **kwargs
        )

        rows = response.get("rows", [])

        def map_item(item: dict):
            title = item.get("title", "")
            # remove html tags
            title = re.sub(r"<[^>]*>", "", title)
            return LawListItem(
                id=item.get("bbbs", ""),
                title=title,
                released_by=item.get("zdjgName", ""),
                publication_date=item.get("gbrq", ""),
                in_effect_date=item.get("sxrq", ""),
                type=item.get("flxz", ""),
                type_code=item.get("flfgCodeId", 0),
            )
        return FetchedLawResponse(
            total=response.get("total", 0),
            items=list(map(map_item, rows)),
        )

    def fetch_document(self, law: LawListItem) -> FetchedDocumentResponse | None:
        full_url = f"{self.BASE_URL}/law-search/download/pc?format=docx&bbbs={law.id}"
        response = requests.get(
            full_url,
            headers=self.HEADERS,
        )
        response.raise_for_status()
        response_data = response.json()
        download_url = response_data.get("data", {}).get("url", "")
        if not download_url:
            return None

        path = self.cache_manager.download_binary(
            download_url,
            CacheType.WordDocument,
        )
        if path is None:
            return None
        return FetchedDocumentResponse(
            law=law,
            path_to_file=path,
        )

    @cache(CacheType.WebPage, filetype="json")
    def __search(self, page_num=1, page_size=20, **kwargs) -> dict:
        use_high_search = kwargs.get("use_high_search", False)

        payload = {
        }

        if use_high_search:
            # Sample
            # dataList = [("title", "xxxx")]
            dataList = kwargs.get("dataList", [])
            dataList = list(map(lambda x: {"fieldName": x[0], "values": [
                            x[1]], "link": 0, "searchType": 1, "index": 0}, dataList))
            payload = {
                "dataList": dataList,
                "orderByParam": {},
                "pageNum": page_num,
                "pageSize": page_size
            }
        else:
            payload = {
                "searchRange": 1,
                "sxrq": [],
                "gbrq": [],
                "searchType": 2,
                "sxx": [4, 3],  # 现行有效、未生效
                "gbrqYear": [],
                "flfgCodeId": [102, 110, 120, 130, 140, 150, 160, 170, 180, 190, 195],
                "zdjgCodeId": [],
                "searchContent": "",
                "orderByParam": {"order": "gbrq", "sort": "DESC"},
                "pageNum": page_num,
                "pageSize": page_size,
                **kwargs,
            }

        url = self.BASE_URL + "/law-search/search/list"
        if use_high_search:
            url = self.BASE_URL + "/law-search/highSearch/highSearch"

        response = requests.post(
            url,
            headers=self.HEADERS,
            json=payload
        )

        response.raise_for_status()
        return response.json()
