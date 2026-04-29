#!/usr/bin/env python3
"""Keep only the latest two <article class="report"> sections in report/index.html.

Default behavior:
- trim older report sections so only the newest two remain

Validation mode:
- pass --check to fail if more than two report sections are present

This is a small safety script for the public market report page. It assumes the
page structure is stable:
- one <main> wrapper
- a sequence of top-level <article class="report"> blocks
- each article already contains the full rendered report content
"""

from __future__ import annotations

import argparse
from datetime import date
import re
import sys
from pathlib import Path

REPORT_RE = re.compile(r'<article class="report">.*?</article>', re.DOTALL)
EYEBROW_RE = re.compile(r'<div class="eyebrow[^"]*">\s*([^<]+?)\s*</div>')
DATE_RE = re.compile(r'(\d{4}-\d{2}-\d{2})')
NEWS_ITEM_RE = re.compile(r'<li class="news-item">', re.DOTALL)


def extract_report_dates(html: str) -> list[date]:
    dates: list[date] = []
    for article in REPORT_RE.finditer(html):
        eyebrow_match = EYEBROW_RE.search(article.group(0))
        if not eyebrow_match:
            continue
        date_match = DATE_RE.search(eyebrow_match.group(1))
        if not date_match:
            continue
        dates.append(date.fromisoformat(date_match.group(1)))
    return dates


def extract_briefing_articles(html: str) -> list[re.Match[str]]:
    dated_articles: list[re.Match[str]] = []
    for article in REPORT_RE.finditer(html):
        eyebrow_match = EYEBROW_RE.search(article.group(0))
        if not eyebrow_match:
            continue
        if DATE_RE.search(eyebrow_match.group(1)):
            dated_articles.append(article)
    return dated_articles


def trim_latest_two(path: Path) -> int:
    html = path.read_text(encoding="utf-8")
    articles = extract_briefing_articles(html)

    if len(articles) <= 2:
        print(f"ok: found {len(articles)} report sections; nothing to trim")
        return 0

    keep = articles[:2]
    start = keep[0].start()
    end = keep[-1].end()

    prefix = html[:start]
    body = html[start:end]
    suffix = html[articles[-1].end():]

    rebuilt = prefix + body + suffix
    path.write_text(rebuilt, encoding="utf-8")

    print(f"trimmed {len(articles)} report sections down to 2 in {path}")
    return 0


def check_latest_two(path: Path) -> int:
    html = path.read_text(encoding="utf-8")
    articles = extract_briefing_articles(html)
    if len(articles) <= 2:
        dates = extract_report_dates(html)
        if len(dates) >= 2 and dates[0] < dates[1]:
            print(
                "error: latest report is not rendered first; keep newest briefing above older one",
                file=sys.stderr,
            )
            return 1
        for idx, article in enumerate(articles, start=1):
            news_count = len(NEWS_ITEM_RE.findall(article.group(0)))
            if news_count != 5:
                print(
                    f"error: report section {idx} contains {news_count} related news items; expected exactly 5",
                    file=sys.stderr,
                )
                return 1
        print(f"ok: found {len(articles)} report sections")
        return 0

    print(f"error: found {len(articles)} report sections; keep only the latest two", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="Path to report/index.html")
    parser.add_argument("--check", action="store_true", help="Validate only; do not modify the file")
    args = parser.parse_args()

    path = Path(args.path)
    if args.check:
        return check_latest_two(path)
    return trim_latest_two(path)


if __name__ == "__main__":
    raise SystemExit(main())
