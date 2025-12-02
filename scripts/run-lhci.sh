#!/usr/bin/env bash
set -euo pipefail

PORT="${LHCI_PORT:-4173}"
DIR="${LHCI_DIR:-./}"
DEFAULT_LHCI_SERVER_COMMAND="node scripts/serve-with-headers.js ${PORT} ${DIR}"
SERVER_COMMAND="${LHCI_SERVER_COMMAND:-$DEFAULT_LHCI_SERVER_COMMAND}"
URL="${LHCI_URL:-http://127.0.0.1:${PORT}}"
CHROME_CANDIDATE="${CHROME_PATH:-${CHROME_BIN:-/root/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome}}"
if [ ! -x "$CHROME_CANDIDATE" ]; then
  CHROME_CANDIDATE="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium-browser || command -v chromium || true)"
fi
export CHROME_PATH="$CHROME_CANDIDATE" CHROME_BIN="$CHROME_CANDIDATE" LHCI_PORT="$PORT" LHCI_SERVER_COMMAND="$SERVER_COMMAND" LHCI_URL="$URL"

echo "run-lhci: delegating server startup to LHCI with command: $SERVER_COMMAND"

HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  npx --yes @lhci/cli@0.14.0 autorun --config=.lighthouserc.json --collect.url="$URL"
