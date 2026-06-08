#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.request import Request, urlopen

KIND_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "report" / "data" / "listed-stocks.json"


@dataclass
class ListedStock:
    companyName: str
    marketType: str
    stockCode: str
    sector: str
    products: str
    listedAt: str
    fiscalMonth: str
    ceo: str
    homepage: str
    region: str


def clean_text(value: str) -> str:
    text = unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_name(value: str) -> str:
    name = clean_text(value)
    name = re.sub(r"^(주식회사|㈜)", "", name)
    name = re.sub(r"[,'\"“”‘’()\[\]]", "", name)
    name = re.sub(r"(은|는|이|가|도|을|를|에|서|로|과|와|만)$", "", name)
    return name.strip()


def parse_rows(html: str) -> list[ListedStock]:
    rows = re.findall(r"<tr>(.*?)</tr>", html, re.S | re.I)
    parsed: list[ListedStock] = []

    for row in rows[1:]:
        cols = [
            clean_text(cell)
            for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)
        ]
        if len(cols) != 10:
            continue
        company_name, market_type, stock_code, sector, products, listed_at, fiscal_month, ceo, homepage, region = cols
        if not stock_code:
            continue
        parsed.append(
            ListedStock(
                companyName=company_name,
                marketType=market_type,
                stockCode=stock_code.zfill(6) if stock_code.isdigit() else stock_code,
                sector=sector,
                products=products,
                listedAt=listed_at,
                fiscalMonth=fiscal_month,
                ceo=ceo,
                homepage=homepage,
                region=region,
            )
        )

    return parsed


def build_lookup(stocks: Iterable[ListedStock]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for stock in stocks:
        normalized = normalize_name(stock.companyName)
        if not normalized:
            continue
        for key in {normalized, normalized.replace(" ", ""), normalized.upper()}:
            lookup.setdefault(key, stock.stockCode)
    return lookup


def fetch_kind_html() -> str:
    request = Request(
        KIND_LIST_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; HermesRealtimeSurgeBot/1.0)",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("euc-kr", "ignore")


def load_existing_payload() -> dict | None:
    if not OUTPUT_PATH.exists():
        return None
    try:
        payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    stocks = payload.get("stocks")
    lookup = payload.get("lookup")
    if not isinstance(stocks, list) or not stocks:
        return None
    if not isinstance(lookup, dict) or not lookup:
        return None
    return payload


def use_existing_payload(reason: Exception) -> bool:
    payload = load_existing_payload()
    if payload is None:
        return False
    print(
        json.dumps(
            {
                "ok": True,
                "fallback": "existing-listed-stocks-cache",
                "reason": f"{type(reason).__name__}: {reason}",
                "count": payload.get("count", len(payload.get("stocks", []))),
                "generatedAt": payload.get("generatedAt"),
                "output": str(OUTPUT_PATH),
            },
            ensure_ascii=False,
        )
    )
    return True


def main() -> None:
    try:
        html = fetch_kind_html()
    except Exception as error:
        if use_existing_payload(error):
            return
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "KIND listed stocks refresh failed and no valid cache is available.",
                    "reason": f"{type(error).__name__}: {error}",
                    "output": str(OUTPUT_PATH),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        raise

    stocks = parse_rows(html)
    if not stocks:
        raise RuntimeError("KIND listed stocks refresh returned zero parsed rows.")
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "KRX KIND listed corporations download",
        "sourceUrl": KIND_LIST_URL,
        "count": len(stocks),
        "lookup": build_lookup(stocks),
        "stocks": [asdict(stock) for stock in stocks],
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "count": len(stocks), "output": str(OUTPUT_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
