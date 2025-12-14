#!/bin/bash
set -euo pipefail

RELEASE_MODE="${RELEASE:-0}"
VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
OUT_DIR="release-artifacts/v${VERSION}"
LOG_FILE="${OUT_DIR}/qa-log.json"

mkdir -p "$OUT_DIR"

echo "=== Cssmate RELEASE GATE ==="
echo "Version: $VERSION"
echo "Commit:  $COMMIT"
echo "Date:    $DATE"
echo

echo "=== [CI] Running verify:deploy ==="
npm ci
npm run verify:deploy
echo "=== [CI] OK ==="
echo

cat <<'QA_STEPS'
=== MANUAL QA – MUST PASS ===
A. Optælling + Vis valgte materialer
B. Historik (persist + slet)
C. Løn-flow (akkordsum vs projektsum)
D. PDF + JSON eksport matcher UI
E. Import + round-trip
F. ZIP-indhold korrekt
G. PWA / offline
H. Ingen console errors / 404
QA_STEPS

if [ "$RELEASE_MODE" = "1" ]; then
  echo
  read -r -p "Skriv: ACCEPT v${VERSION} <dit navn> : " ACCEPT_LINE
  if [[ ! "$ACCEPT_LINE" =~ ^ACCEPT\ v${VERSION}\  ]]; then
    echo "RELEASE AFVIST"
    exit 1
  fi
else
  echo "INFO: RELEASE=1 kræves for endelig accept"
  exit 0
fi

cat <<EOF2 > "$LOG_FILE"
{
  "version": "$VERSION",
  "commit": "$COMMIT",
  "date": "$DATE",
  "acceptedBy": "$ACCEPT_LINE",
  "checks": {
    "ci": "passed",
    "manualQA": "confirmed"
  }
}
EOF2

echo "=== RELEASE ACCEPTERET ==="
echo "QA-log: $LOG_FILE"
