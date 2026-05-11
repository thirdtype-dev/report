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
    r'\s*<article class="report notice-card" data-deadline-notice="[^"]+">.*?</article>\s*',
    re.DOTALL,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=("pre_market", "post_market"))
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def phase_label(phase: str) -> str:
    return "장 시작" if phase == "pre_market" else "장 종료"


def deadline_label(phase: str) -> str:
    return "08:30 KST" if phase == "pre_market" else "16:00 KST"


def title_text(day: date, phase: str) -> str:
    return f"{day.month}/{day.day} {'장시작' if phase == 'pre_market' else '장종료'} 브리핑 · 리딩방"


def build_notice_article(day: date, phase: str) -> str:
    marker = f"{phase}:{day.isoformat()}"
    label = phase_label(phase)
    deadline = deadline_label(phase)
    return f"""        <article class="report notice-card" data-deadline-notice="{marker}">
          <div class="eyebrow draft">{label} · {day.isoformat()}</div>
          <h1>금일 {label} 브리핑은 {deadline}까지 발행되지 않았습니다</h1>
          <p class="meta">{day.isoformat()} {deadline} · System Notice</p>
          <p class="lead">정해진 시각까지 live publish proof 가 확인되지 않아 고객면을 stale 상태로 두지 않기 위한 운영 공지로 대체합니다. 정상 브리핑은 정시 발행본만 유효하며, 지연 반영은 별도 수동 공지 없이는 정상 발행으로 취급하지 않습니다.</p>

          <h2>현재 상태</h2>
          <ul class="bullet-grid">
            <li><strong>발행 결과:</strong> 해당 시각까지 고객용 브리핑 본문이 공개 URL에 반영되지 않았습니다.</li>
            <li><strong>운영 처리:</strong> 동일 날짜/단계 브리핑 이슈는 deadline miss 기준으로 종료됩니다.</li>
            <li><strong>고객면 정책:</strong> 이전 브리핑을 계속 보여주지 않도록 현재 단계의 미발행 사실을 상단에 고지합니다.</li>
          </ul>

          <h2>안내</h2>
          <ul class="bullet-grid">
            <li>이 카드는 stale 브리핑 방치 방지를 위한 deadline notice 입니다.</li>
            <li>정상 브리핑이 이후 별도로 필요하면 수동 예외 발행과 별도 기록이 필요합니다.</li>
            <li>다음 정규 브리핑부터는 deadline-aware publish 경로만 허용됩니다.</li>
          </ul>
        </article>"""


def update_index(html: str, day: date, phase: str) -> str:
    notice = build_notice_article(day, phase)

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
