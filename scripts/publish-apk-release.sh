#!/usr/bin/env bash
# Publish a GitHub Release with the debug APK (same flow as in-app "Check for update").
#
# Prerequisites: npm run apk:debug succeeded, gh auth login, tag exists or will be created.
#
# Usage:
#   ./scripts/publish-apk-release.sh v1.3.3 "Short release notes (optional)"
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="${1:?Usage: $0 v1.2.3 \"release notes\"}"
NOTES="${2:-Release $TAG}"
VERSION="${TAG#v}"
APK_SRC="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
APK_NAME="gan-smartcube-lite-${VERSION}-debug.apk"

if [[ ! -f "$APK_SRC" ]]; then
  echo "Missing $APK_SRC — run npm run apk:debug first."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found. Run: npm run setup:android   (or install gh and: gh auth login)"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$APK_SRC" "$TMP/$APK_NAME"

# Create release from existing tag, or create tag at current branch tip.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" "$TMP/$APK_NAME" \
    --repo Dawnforger/hscube \
    --title "GAN Smartcube Lite $TAG" \
    --notes "$NOTES"
else
  TARGET="$(git symbolic-ref -q --short HEAD 2>/dev/null || true)"
  if [[ -z "$TARGET" ]]; then
    TARGET="main"
  fi
  gh release create "$TAG" "$TMP/$APK_NAME" \
    --repo Dawnforger/hscube \
    --title "GAN Smartcube Lite $TAG" \
    --notes "$NOTES" \
    --target "$TARGET"
fi

echo "Published $TAG with $APK_NAME"
