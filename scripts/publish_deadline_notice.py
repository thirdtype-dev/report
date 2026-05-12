#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "index.html"
REPORT_HTML = ROOT / "report" / "index.html"

BRIEFING_SECTION_RE = re.compile(
    r'(<section id="briefing-pane">\s*)(.*?)(\s*</section>)',
    re.DOTALL,
)
TITLE_RE = re.compile(r"(<title>)(.*?)(</title>)", re.DOTALL)
NOTICE_RE = re.compile(
    r'\s*<article class="report notice-card" data-(?:briefing|deadline)-notice="[^"]+">.*?</article>\s*',
    re.DOTALL,
)
FIRST_REPORT_RE = re.compile(
    r'<article class="report"[^>]*>.*?<div class="eyebrow[^"]*">\s*([^<]+?)\s*</div>.*?<h1>(.*?)</h1>',
    re.DOTALL,
)
EYEBROW_RE = re.compile(r"장\s*(시작|종료)\s*·\s*(\d{4})-(\d{2})-(\d{2})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=False, choices=("pre_market", "post_market"))
    parser.add_argument("--date", required=False, help="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def title_from_eyebrow(eyebrow: str) -> str | None:
    match = EYEBROW_RE.search(eyebrow)
    if not match:
        return None
    phase, _year, month, day = match.groups()
    label = "장시작" if phase == "시작" else "장종료"
    return f"{int(month)}/{int(day)} {label} 브리핑 · 리딩방"


def remove_notice_articles(html: str) -> str:
    def replace_section(match: re.Match[str]) -> str:
        prefix, body, suffix = match.groups()
        cleaned = NOTICE_RE.sub("", body)
        cleaned = cleaned.strip()
        if cleaned:
            cleaned = "\n" + cleaned + "\n"
        else:
            cleaned = "\n"
        return f"{prefix}{cleaned}{suffix}"

    updated = BRIEFING_SECTION_RE.sub(replace_section, html, count=1)
    first_report = FIRST_REPORT_RE.search(updated)
    if first_report:
        eyebrow = re.sub(r"\s+", " ", first_report.group(1)).strip()
        next_title = title_from_eyebrow(eyebrow)
        if next_title:
            updated = TITLE_RE.sub(
                lambda title_match: f"{title_match.group(1)}{next_title}{title_match.group(3)}",
                updated,
                count=1,
            )
    return updated


def main() -> int:
    args = parse_args()
    original = INDEX_HTML.read_text(encoding="utf-8")
    updated = remove_notice_articles(original)

    if args.dry_run:
        print("deadline_notice_cleanup=dry_run")
        print("changed=yes" if updated != original else "changed=no")
        return 0

    if updated == original:
        print("deadline_notice_cleanup=noop")
        return 0

    INDEX_HTML.write_text(updated, encoding="utf-8")
    REPORT_HTML.parent.mkdir(parents=True, exist_ok=True)
    REPORT_HTML.write_text(updated, encoding="utf-8")

    subprocess.run(["git", "-C", str(ROOT), "add", "index.html", "report/index.html"], check=True)
    commit = subprocess.run(
        ["git", "-C", str(ROOT), "commit", "-m", "Remove deadline notice shell"],
        capture_output=True,
        text=True,
    )
    if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr).lower():
        raise SystemExit(commit.stderr.strip() or commit.stdout.strip() or commit.returncode)
    subprocess.run(["git", "-C", str(ROOT), "push", "origin", "main"], check=True)
    print("deadline_notice_cleanup=published")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
