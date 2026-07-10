#!/usr/bin/env python3
import io
import json
import math
import os
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
from html.parser import HTMLParser
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


MARKETS = ("KOSPI", "KOSDAQ")
LOOKBACK_DAYS = 14
NAVER_INVESTOR_TREND_URL = "https://finance.naver.com/sise/investorDealTrendDay.naver"
NAVER_MARKET_CODES = {"KOSPI": "01", "KOSDAQ": "02"}
NAVER_UNIT_KRW = 100_000_000
NAVER_COLUMNS = (
    "retail",
    "foreign",
    "institution",
    "financial_investment",
    "insurance",
    "investment_trust_private_equity",
    "bank",
    "other_finance",
    "pension_funds",
    "other_corporations",
)
INVESTOR_COLUMNS = {
    "foreign": ("외국인합계", "외국인"),
    "institution": ("기관합계", "기관"),
    "retail": ("개인",),
    "financial_investment": ("금융투자",),
    "insurance": ("보험",),
    "investment_trust": ("투신",),
    "private_equity": ("사모",),
    "bank": ("은행",),
    "other_finance": ("기타금융",),
    "pension_funds": ("연기금 등", "연기금등", "연기금"),
    "other_corporations": ("기타법인",),
}


class InvestorTrendTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, _attrs):
        if tag == "tr":
            self._row = []
        elif tag == "td" and self._row is not None:
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self._cell is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
            self._cell = None


def now_kst():
    return datetime.now(ZoneInfo("Asia/Seoul"))


def ymd(value):
    return value.strftime("%Y%m%d")


def iso_date(value):
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    text = str(value)
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text[:10]


def parse_naver_date(value):
    return datetime.strptime(value.strip(), "%y.%m.%d").date()


def parse_naver_amount(value):
    return int(value.replace(",", "").replace("+", "").strip()) * NAVER_UNIT_KRW


def parse_naver_investor_rows(html):
    parser = InvestorTrendTableParser()
    parser.feed(html)
    rows = []
    for cells in parser.rows:
        if len(cells) < len(NAVER_COLUMNS) + 1:
            continue
        try:
            trading_date = parse_naver_date(cells[0])
            values = [parse_naver_amount(value) for value in cells[1:11]]
        except (ValueError, TypeError):
            continue
        rows.append(
            {
                "date": trading_date.isoformat(),
                "netBuy": dict(zip(NAVER_COLUMNS, values)),
            }
        )
    if not rows:
        raise RuntimeError("empty_naver_investor_flow_rows")
    return sorted(rows, key=lambda row: row["date"])


def json_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return int(number)


def first_value(row, names):
    for name in names:
        if name in row:
            value = json_number(row[name])
            if value is not None:
                return value
    return None


def row_to_flow(row):
    return {
        key: first_value(row, columns)
        for key, columns in INVESTOR_COLUMNS.items()
        if first_value(row, columns) is not None
    }


def direction(value):
    if value is None or value == 0:
        return "flat"
    return "buy" if value > 0 else "sell"


def streak(rows, key):
    latest_direction = None
    count = 0
    for row in reversed(rows):
        current = direction(row["netBuy"].get(key))
        if current == "flat":
            if count == 0:
                latest_direction = "flat"
            break
        if latest_direction is None:
            latest_direction = current
        if current != latest_direction:
            break
        count += 1
    return {"direction": latest_direction or "flat", "count": count}


def build_market_result(market, rows, source, source_url):
    latest = rows[-1]
    return {
        "market": market,
        "latestDate": latest["date"],
        "unit": "KRW",
        "netBuy": latest["netBuy"],
        "recent": rows[-5:],
        "streaks": {
            "foreign": streak(rows, "foreign"),
            "institution": streak(rows, "institution"),
            "retail": streak(rows, "retail"),
        },
        "source": source,
        "sourceUrl": source_url,
    }


def fetch_naver_market(market, end_day, open_url=urlopen):
    query = urlencode(
        {
            "bizdate": ymd(end_day),
            "sosok": NAVER_MARKET_CODES[market],
            "page": 1,
        }
    )
    source_url = f"{NAVER_INVESTOR_TREND_URL}?{query}"
    request = Request(source_url, headers={"User-Agent": "Mozilla/5.0"})
    with open_url(request, timeout=20) as response:
        html = response.read().decode("euc-kr", errors="replace")
    oldest = (end_day - timedelta(days=LOOKBACK_DAYS)).isoformat()
    latest = end_day.isoformat()
    rows = [row for row in parse_naver_investor_rows(html) if oldest <= row["date"] <= latest]
    if not rows:
        raise RuntimeError(f"no_naver_investor_flow_data_within_{LOOKBACK_DAYS}_days")
    return build_market_result(market, rows, "NAVER Finance/KRX", source_url)


def fetch_market_window(stock, market, start_date, end_date):
    df = stock.get_market_trading_value_by_date(
        start_date,
        end_date,
        market,
        on="순매수",
        detail=True,
    )
    if df is None or df.empty:
        df = stock.get_market_trading_value_by_date(
            start_date,
            end_date,
            market,
            on="순매수",
            detail=False,
        )
    if df is None or df.empty:
        raise RuntimeError("empty_pykrx_dataframe")

    rows = []
    for index, row in df.sort_index().iterrows():
        raw = row.to_dict()
        net_buy = row_to_flow(raw)
        if not net_buy:
            continue
        rows.append(
            {
                "date": iso_date(index),
                "netBuy": net_buy,
            }
        )
    if not rows:
        raise RuntimeError("empty_investor_flow_rows")

    return build_market_result(
        market,
        rows,
        "pykrx/KRX",
        "https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd",
    )


def fetch_market(stock, market, end_day):
    current_end = end_day
    oldest_day = end_day - timedelta(days=LOOKBACK_DAYS)
    last_error = None

    while current_end >= oldest_day:
        current_start = max(oldest_day, current_end - timedelta(days=20))
        try:
            return fetch_market_window(stock, market, ymd(current_start), ymd(current_end))
        except Exception as error:
            last_error = error
            current_end = current_start - timedelta(days=1)

    raise RuntimeError(f"no_investor_flow_data_within_{LOOKBACK_DAYS}_days:{last_error}")


def load_pykrx_stock():
    if not (os.getenv("KRX_ID") and os.getenv("KRX_PW")):
        raise RuntimeError("missing_krx_credentials")
    with redirect_stdout(io.StringIO()):
        from pykrx import stock
    return stock


def main():
    today = now_kst().date()
    markets = []
    errors = {}
    stock = None
    pykrx_load_error = None

    try:
        stock = load_pykrx_stock()
    except Exception as error:
        pykrx_load_error = error

    for market in MARKETS:
        pykrx_error = None
        try:
            if stock is None:
                raise pykrx_load_error or RuntimeError("pykrx_unavailable")
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                markets.append(fetch_market(stock, market, today))
            continue
        except Exception as error:
            pykrx_error = error

        try:
            markets.append(fetch_naver_market(market, today))
        except Exception as naver_error:
            errors[market] = f"pykrx:{pykrx_error}; naver:{naver_error}"

    status = "ok" if len(markets) == len(MARKETS) else "partial" if markets else "unavailable"
    reason = None if status == "ok" else "; ".join(f"{market}:{error}" for market, error in errors.items()) or "no_market_data"
    sources = sorted({market["source"] for market in markets})
    source_urls = sorted({market["sourceUrl"] for market in markets})
    print(
        json.dumps(
            {
                "status": status,
                "generatedAt": now_kst().isoformat(),
                "source": " + ".join(sources) if sources else "pykrx/KRX + NAVER Finance/KRX",
                "sourceUrls": source_urls,
                "collectionWindow": {
                    "lookbackDays": LOOKBACK_DAYS,
                    "end": iso_date(ymd(today)),
                },
                "markets": markets,
                "errors": errors,
                "reason": reason,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "unavailable",
                    "generatedAt": now_kst().isoformat(),
                    "source": "pykrx/KRX",
                    "reason": f"unexpected_error:{error}",
                    "markets": [],
                },
                ensure_ascii=False,
            )
        )
        raise SystemExit(0)
