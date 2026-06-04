#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building frontend + sidecars..."
npm run build:all

TARGET="${1:-aarch64-apple-darwin}"
echo "==> Running tauri build (target: $TARGET)..."
npx tauri build --target "$TARGET"

echo "==> Done. Artifacts:"
ls -la src-tauri/target/"$TARGET"/release/bundle/dmg/*.dmg 2>/dev/null || true
ls -la src-tauri/target/"$TARGET"/release/bundle/macos/*.app 2>/dev/null || true
