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

verify_canonical_root() {
  local marker_count
  if [[ ! -s "$ROOT_INDEX" ]]; then
    echo "Canonical root index is missing or empty: $ROOT_INDEX" >&2
    exit 1
  fi

  marker_count=$(perl -0ne 'my $c = () = /장\s*(?:시작|종료)\s*·\s*\d{4}-\d{2}-\d{2}/g; print $c;' "$ROOT_INDEX")
  if [[ "${marker_count:-0}" -lt 1 ]]; then
    echo "Canonical root verification failed: no dated phase marker found in $ROOT_INDEX" >&2
    exit 1
  fi

  if perl -0ne 'exit((/service\s+notice|점검|공지/i) ? 0 : 1)' "$ROOT_INDEX"; then
    echo "Canonical root verification failed: notice-like surface detected in $ROOT_INDEX" >&2
    exit 1
  fi
}

verify_canonical_root

mkdir -p "$ROOT_DIR/report"
python3 "$TRIMMER" "$ROOT_INDEX"
cp "$ROOT_INDEX" "$REPORT_HTML"

git -C "$ROOT_DIR" add index.html report

git -C "$ROOT_DIR" commit -m "Publish latest two reports" || {
  echo "No changes to commit."
  exit 0
}

git -C "$ROOT_DIR" push origin main
