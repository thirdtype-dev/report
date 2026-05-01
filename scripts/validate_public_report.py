#!/usr/bin/env python3
"""Validate the canonical public report page before publishing.

The public GitHub Pages URL https://thirdtype-dev.github.io/report/ is served
from this repository's root index.html. This guard intentionally rejects the
nested report/index.html path so operators do not validate or edit the wrong
local target.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPORT_RE = re.compile(r'<article class="report">.*?</article>', re.DOTALL)
EYEBROW_RE = re.compile(r'<div class="eyebrow[^"]*">\s*([^<]+?)\s*</div>')
NEWS_ITEM_RE = re.compile(r'<li class="news-item">')
TITLE_RE = re.compile(r'<title>(.*?)</title>', re.DOTALL)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "path",
        nargs="?",
        default="index.html",
        help="Canonical public page path; defaults to repo-root index.html",
    )
    parser.add_argument("--expect-title", default="4/30 장마감 브리핑 · 리딩방")
    parser.add_argument("--expect-first-eyebrow", default="장 종료 · 2026-04-30")
    parser.add_argument("--require-text", action="append", default=[])
    return parser.parse_args()


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    path = Path(args.path)
    if not path.is_absolute():
        path = (repo_root / path).resolve()
    else:
        path = path.resolve()

    canonical = (repo_root / "index.html").resolve()
    if path != canonical:
        return fail(
            f"non-canonical report target: {path}; public /report/ is served from {canonical}"
        )

    html = path.read_text(encoding="utf-8")
    title_match = TITLE_RE.search(html)
    title = title_match.group(1).strip() if title_match else ""
    if title != args.expect_title:
        return fail(f"title {title!r} != expected {args.expect_title!r}")

    for required in args.require_text:
        if required not in html:
            return fail(f"required text missing: {required!r}")

    reports = REPORT_RE.findall(html)
    dated_reports = []
    for report in reports:
        eyebrow_match = EYEBROW_RE.search(report)
        eyebrow = eyebrow_match.group(1).strip() if eyebrow_match else ""
        if re.search(r"\d{4}-\d{2}-\d{2}", eyebrow):
            dated_reports.append((eyebrow, report))

    if len(dated_reports) != 2:
        return fail(f"expected exactly 2 dated report cards, found {len(dated_reports)}")

    first_eyebrow, first_report = dated_reports[0]
    if first_eyebrow != args.expect_first_eyebrow:
        return fail(f"first dated card {first_eyebrow!r} != expected {args.expect_first_eyebrow!r}")

    for index, (eyebrow, report) in enumerate(dated_reports, start=1):
        news_count = len(NEWS_ITEM_RE.findall(report))
        if news_count != 5:
            return fail(f"dated card {index} ({eyebrow}) has {news_count} related-news items; expected 5")

    print(
        "ok: canonical public report page is post-market first with 2 dated report cards and 5 news items each"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
