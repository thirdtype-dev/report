#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ROOT_INDEX="$ROOT_DIR/index.html"
REPORT_HTML="$ROOT_DIR/report/index.html"
TRIMMER="$ROOT_DIR/scripts/trim_latest_reports.py"

if [[ ! -f "$ROOT_INDEX" ]]; then
  echo "Missing root index: $ROOT_INDEX" >&2
  exit 1
fi

if [[ ! -f "$TRIMMER" ]]; then
  echo "Missing trimmer: $TRIMMER" >&2
  exit 1
fi

extract_publish_deadline() {
  perl -0ne '
    if (/<section id="briefing-pane">.*?<div class="eyebrow[^"]*">\s*([^<]+?)\s*<\/div>/s) {
      print $1;
    }
  ' "$ROOT_INDEX"
}

enforce_publish_deadline() {
  if [[ "${ALLOW_LATE_PUBLISH:-0}" == "1" ]]; then
    return 0
  fi

  local eyebrow today_kst now_hm issue_date deadline_hm
  eyebrow=$(extract_publish_deadline)
  today_kst=$(TZ=Asia/Seoul date +%F)
  now_hm=$(TZ=Asia/Seoul date +%H%M)

  if [[ "$eyebrow" =~ 장[[:space:]]시작[[:space:]]·[[:space:]]([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    issue_date="${BASH_REMATCH[1]}"
    deadline_hm="0830"
  elif [[ "$eyebrow" =~ 장[[:space:]]종료[[:space:]]·[[:space:]]([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    issue_date="${BASH_REMATCH[1]}"
    deadline_hm="1600"
  else
    return 0
  fi

  if [[ "$issue_date" == "$today_kst" ]] && ((10#$now_hm > 10#$deadline_hm)); then
    echo "Refusing late publish for $eyebrow at $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST'). Set ALLOW_LATE_PUBLISH=1 to override." >&2
    exit 2
  fi
}

enforce_publish_deadline

mkdir -p "$ROOT_DIR/report"
python3 "$TRIMMER" "$ROOT_INDEX"
cp "$ROOT_INDEX" "$REPORT_HTML"

git -C "$ROOT_DIR" add index.html report

git -C "$ROOT_DIR" commit -m "Publish latest two reports" || {
  echo "No changes to commit."
  exit 0
}

git -C "$ROOT_DIR" push origin main
