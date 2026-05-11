#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
from datetime import date
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
FORBIDDEN_PUBLIC_TERMS = (
    "08:30",
    "16:00",
    "KST",
    "deadline",
    "publish proof",
    "publish_url",
    "EXPIRED",
    "expired",
    "운영 실패",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=("pre_market", "post_market"))
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def phase_label(phase: str) -> str:
    return "장 시작" if phase == "pre_market" else "장 종료"


def title_text(day: date, phase: str) -> str:
    return f"{day.month}/{day.day} {'장시작' if phase == 'pre_market' else '장종료'} 브리핑 · 리딩방"


def build_notice_article(day: date, phase: str) -> str:
    marker = f"{phase}:{day.isoformat()}"
    label = phase_label(phase)
    customer_label = "장시작" if phase == "pre_market" else "장마감"
    return f"""        <article class="report notice-card" data-briefing-notice="{marker}">
          <div class="eyebrow draft">{label} · {day.isoformat()}</div>
          <h1>오늘 {customer_label} 브리핑은 제공되지 않습니다</h1>
          <p class="meta">{day.isoformat()} · Service Notice</p>
          <p class="lead">오늘 {customer_label} 브리핑은 제공되지 않습니다. 마지막 정상 발행 브리핑은 아래에서 확인할 수 있으며, 다음 정규 브리핑에서 필요한 변화만 이어서 정리합니다.</p>

          <h2>안내</h2>
          <ul class="bullet-grid">
            <li><strong>오늘 브리핑:</strong> 금일 {customer_label} 브리핑은 제공되지 않습니다.</li>
            <li><strong>마지막 정상 발행본:</strong> 바로 아래 최신 브리핑 카드에서 이어서 확인할 수 있습니다.</li>
            <li><strong>다음 업데이트:</strong> 다음 정규 브리핑에서 필요한 핵심 변화만 이어서 정리합니다.</li>
          </ul>
        </article>"""


def assert_customer_safe_notice(notice_html: str) -> None:
    visible_text = re.sub(r"<[^>]+>", " ", notice_html)
    lowered = re.sub(r"\s+", " ", visible_text).lower()
    for term in FORBIDDEN_PUBLIC_TERMS:
        if term.lower() in lowered:
            raise ValueError(f"forbidden public term leaked into notice copy: {term}")


def update_index(html: str, day: date, phase: str) -> str:
    notice = build_notice_article(day, phase)
    assert_customer_safe_notice(notice)

    def replace_section(match: re.Match[str]) -> str:
        prefix, body, suffix = match.groups()
        cleaned = NOTICE_RE.sub("", body).strip()
        if cleaned:
            cleaned = "\n" + cleaned + "\n      "
        else:
            cleaned = "\n"
        return f"{prefix}{notice}{cleaned}{suffix}"

    updated = BRIEFING_SECTION_RE.sub(replace_section, html, count=1)
    return TITLE_RE.sub(lambda match: f"{match.group(1)}{title_text(day, phase)}{match.group(3)}", updated, count=1)


def main() -> int:
    args = parse_args()
    day = date.fromisoformat(args.date)
    original = INDEX_HTML.read_text(encoding="utf-8")
    updated = update_index(original, day, args.phase)

    if args.dry_run:
        print("dry_run=ok")
        print(f"title={title_text(day, args.phase)}")
        print(f"marker={phase_label(args.phase)} · {day.isoformat()}")
        return 0

    if updated == original:
        print("notice_publish=noop")
        return 0

    INDEX_HTML.write_text(updated, encoding="utf-8")
    REPORT_HTML.parent.mkdir(parents=True, exist_ok=True)
    REPORT_HTML.write_text(updated, encoding="utf-8")

    subprocess.run(["git", "-C", str(ROOT), "add", "index.html", "report/index.html"], check=True)
    commit = subprocess.run(
        ["git", "-C", str(ROOT), "commit", "-m", f"Publish {args.phase} deadline notice {args.date}"],
        capture_output=True,
        text=True,
    )
    if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr).lower():
        raise SystemExit(commit.stderr.strip() or commit.stdout.strip() or commit.returncode)
    subprocess.run(["git", "-C", str(ROOT), "push", "origin", "main"], check=True)
    print("notice_publish=published")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
