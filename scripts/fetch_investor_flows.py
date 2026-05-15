#!/usr/bin/env python3
import json
import math
import sys
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


MARKETS = ("KOSPI", "KOSDAQ")
LOOKBACK_DAYS = 540
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
    }


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


def main():
    try:
        with redirect_stdout(sys.stderr):
            from pykrx import stock
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "unavailable",
                    "generatedAt": now_kst().isoformat(),
                    "source": "pykrx/KRX",
                    "reason": f"import_pykrx_failed:{error}",
                    "markets": [],
                },
                ensure_ascii=False,
            )
        )
        return 0

    today = now_kst().date()
    markets = []
    errors = {}

    for market in MARKETS:
        try:
            with redirect_stdout(sys.stderr):
                markets.append(fetch_market(stock, market, today))
        except Exception as error:
            errors[market] = str(error)

    status = "ok" if len(markets) == len(MARKETS) else "partial" if markets else "unavailable"
    reason = None if markets else "; ".join(f"{market}:{error}" for market, error in errors.items()) or "no_market_data"
    print(
        json.dumps(
            {
                "status": status,
                "generatedAt": now_kst().isoformat(),
                "source": "pykrx/KRX",
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
