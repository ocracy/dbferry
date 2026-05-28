#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="dbferry"
DEST="/Applications/${APP_NAME}.app"

# Detect Mac architecture (Apple Silicon vs Intel)
ARCH="$(uname -m)"
if [ "${ARCH}" = "arm64" ]; then
  BUILD_SCRIPT="build:mac:arm64"
  BUILT_APP="release/mac-arm64/${APP_NAME}.app"
else
  BUILD_SCRIPT="build:mac:x64"
  BUILT_APP="release/mac/${APP_NAME}.app"
fi

# Find pnpm — heart.json launches scripts with a minimal PATH, so explicitly resolve it.
PNPM_BIN="$(command -v pnpm || true)"
if [ -z "${PNPM_BIN}" ]; then
  for candidate in \
    "$HOME/Library/pnpm/pnpm" \
    "$HOME/.local/share/pnpm/pnpm" \
    "/opt/homebrew/bin/pnpm" \
    "/usr/local/bin/pnpm"; do
    if [ -x "${candidate}" ]; then
      PNPM_BIN="${candidate}"
      break
    fi
  done
fi
if [ -z "${PNPM_BIN}" ]; then
  echo "✗ pnpm not found in PATH. Install pnpm first: https://pnpm.io/installation"
  exit 1
fi

echo "→ Architecture: ${ARCH}"

if [ ! -d "node_modules" ]; then
  echo "→ Installing dependencies…"
  "${PNPM_BIN}" install
fi

echo "→ Building ${APP_NAME} (${BUILD_SCRIPT})…"
"${PNPM_BIN}" run "${BUILD_SCRIPT}"

if [ ! -d "${BUILT_APP}" ]; then
  echo "✗ Build output not found at ${BUILT_APP}"
  exit 1
fi

# Quit a running instance so the replace doesn't fail with "in use".
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 1

echo "→ Installing to ${DEST}…"
rm -rf "${DEST}"
cp -R "${BUILT_APP}" "${DEST}"
xattr -cr "${DEST}" || true

echo ""
echo "✓ Installed: ${DEST}"
echo "  Launchpad: search \"${APP_NAME}\""
echo "  Spotlight: ⌘+Space → \"${APP_NAME}\""
echo "  Or run:    open -a ${APP_NAME}"
