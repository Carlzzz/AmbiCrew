#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DESKTOP_DIR}/.." && pwd)"

TARGET_TRIPLE="aarch64-apple-darwin"
ELECTRON_RELEASE_DIR="${DESKTOP_DIR}/release"
CANONICAL_OUTPUT_DIR="${DESKTOP_DIR}/build-artifacts/macos-arm64"
APP_BUNDLE_NAME="AmbiCrew.app"
APP_BUNDLE_ID="com.ambicrew.ambicrew"

usage() {
  cat <<'EOF'
Build AmbiCrew desktop for macOS Apple Silicon (arm64) and output a DMG.

Usage:
  ./desktop/scripts/build-macos-arm64.sh [extra electron-builder args...]

Environment:
  SKIP_INSTALL=1   Skip `bun install` in the repo root and desktop app.
  OPEN_OUTPUT=1    Open the canonical artifact output directory in Finder after a successful build.

Examples:
  ./desktop/scripts/build-macos-arm64.sh
  SKIP_INSTALL=1 ./desktop/scripts/build-macos-arm64.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[build-macos-arm64] This script must run on macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "[build-macos-arm64] This script is intended for Apple Silicon hosts (arm64)." >&2
  exit 1
fi

for command in bun codesign hdiutil; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "[build-macos-arm64] Missing required command: ${command}" >&2
    exit 1
  fi
done

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "[build-macos-arm64] Installing root dependencies..."
  (cd "${REPO_ROOT}" && bun install)

  echo "[build-macos-arm64] Installing desktop dependencies..."
  (cd "${DESKTOP_DIR}" && bun install)
fi

for cmd in "${DESKTOP_DIR}/node_modules/.bin/tsc" "${DESKTOP_DIR}/node_modules/.bin/vite" "${DESKTOP_DIR}/node_modules/.bin/electron-builder"; do
  if [[ ! -x "${cmd}" ]]; then
    echo "[build-macos-arm64] Missing required tool: ${cmd}" >&2
    echo "[build-macos-arm64] Run 'cd desktop && bun install' and try again." >&2
    exit 1
  fi
done

# ── 清理 ──
echo "[build-macos-arm64] Cleaning stale build and release outputs..."
rm -rf "${DESKTOP_DIR}/resources/claude-sidecar"*
rm -rf "${DESKTOP_DIR}/resources/adapter-sidecar"*
rm -rf "${DESKTOP_DIR}/release"
rm -rf "${DESKTOP_DIR}/dist"
rm -rf "${DESKTOP_DIR}/dist-electron"
rm -f "${DESKTOP_DIR}/tsconfig.tsbuildinfo"

echo "[build-macos-arm64] Rebuilding frontend, main process, and sidecars..."
(cd "${DESKTOP_DIR}" && bun run build:all:pack)

BUILDER_ARGS=(
  bunx
  electron-builder
  --mac
  --arm64
)

if [[ "$#" -gt 0 ]]; then
  BUILDER_ARGS+=("$@")
fi

echo "[build-macos-arm64] Packaging Electron app for macOS arm64..."
(
  cd "${DESKTOP_DIR}"
  "${BUILDER_ARGS[@]}"
)

mkdir -p "${CANONICAL_OUTPUT_DIR}"
find "${CANONICAL_OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

find_latest_file() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type f -name "${pattern}" | sort | tail -n 1
  fi
}

find_latest_dir() {
  local search_dir="$1"
  local pattern="$2"
  if [[ -d "${search_dir}" ]]; then
    find "${search_dir}" -maxdepth 1 -type d -name "${pattern}" | sort | tail -n 1
  fi
}

LATEST_DMG="$(find_latest_file "${ELECTRON_RELEASE_DIR}" 'AmbiCrew-*-arm64.dmg')"
if [[ -z "${LATEST_DMG}" ]]; then
  LATEST_DMG="$(find_latest_file "${ELECTRON_RELEASE_DIR}" '*.dmg')"
fi

LATEST_APP="${ELECTRON_RELEASE_DIR}/mac-arm64/${APP_BUNDLE_NAME}"
if [[ ! -d "${LATEST_APP}" ]]; then
  LATEST_APP="${ELECTRON_RELEASE_DIR}/mac/${APP_BUNDLE_NAME}"
fi
if [[ ! -d "${LATEST_APP}" ]]; then
  LATEST_APP="$(find_latest_dir "${ELECTRON_RELEASE_DIR}" "${APP_BUNDLE_NAME}")"
fi

build_canonical_dmg() {
  local app_bundle="$1"
  local dmg_output="$2"
  local staging_dir
  local rw_dmg

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/ambicrew-dmg.XXXXXX")"
  rw_dmg="$(mktemp "${TMPDIR:-/tmp}/ambicrew-rw.XXXXXX").dmg"

  cp -R "${app_bundle}" "${staging_dir}/"
  ln -s /Applications "${staging_dir}/Applications"

  # Create a read-write DMG first so we can customize the Finder layout
  hdiutil create \
    -volname "AmbiCrew" \
    -srcfolder "${staging_dir}" \
    -ov \
    -format UDRW \
    "${rw_dmg}" >/dev/null

  rm -rf "${staging_dir}"

  # Mount the read-write DMG and apply Finder layout via AppleScript
  local dev_name mount_dir
  dev_name=$(hdiutil attach -readwrite -noverify -noautoopen -nobrowse "${rw_dmg}" \
    | grep -E '^/dev/' | head -1 | awk '{print $1}')
  mount_dir=$(hdiutil info | grep -E "${dev_name}" | tail -1 | awk '{$1=$2=""; print}' | xargs)

  # Finder AppleScript 在新版 macOS (Sequoia+) 上某些属性不支持, 会返回 -10006 错误。
  # 通过 try...end try 块包裹不支持的属性，确保 bounds 和位置设定仍能正确应用。
  if ! osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "AmbiCrew"
    open
    set current view of container window to icon view
    try
      set toolbar visible of container window to false
    end try
    try
      set statusbar visible of container window to false
    end try
    set the bounds of container window to {100, 100, 760, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set position of item "${APP_BUNDLE_NAME}" of container window to {180, 170}
    set position of item "Applications" of container window to {480, 170}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
  then
    echo "[build-macos-arm64] WARN: Finder layout AppleScript encountered an issue; DMG bounds or positions might use defaults" >&2
  fi

  sync
  hdiutil detach "${dev_name}" -quiet 2>/dev/null \
    || hdiutil detach "${dev_name}" -force -quiet

  # Convert to compressed read-only DMG
  hdiutil convert "${rw_dmg}" -format UDZO -o "${dmg_output}" -ov >/dev/null
  rm -f "${rw_dmg}"
}

codesign_cdhash() {
  local executable="$1"
  codesign -d --verbose=4 "${executable}" 2>&1 \
    | awk -F= '/^CDHash=/{print $2; exit}'
}

sign_canonical_app_bundle() {
  local app_bundle="$1"
  local sidecar="${app_bundle}/Contents/Resources/claude-sidecar"
  local sidecar_cdhash_before=""
  local sidecar_cdhash_after=""

  if [[ -x "${sidecar}" ]]; then
    sidecar_cdhash_before="$(codesign_cdhash "${sidecar}")"
  fi

  # Sign only the outer bundle: do not pass --deep, because re-signing claude-sidecar
  # changes its code-signature hash and breaks existing macOS Keychain ACLs.
  codesign --force --sign - --timestamp=none "${app_bundle}"

  if [[ -x "${sidecar}" ]]; then
    sidecar_cdhash_after="$(codesign_cdhash "${sidecar}")"
    if [[ "${sidecar_cdhash_before}" != "${sidecar_cdhash_after}" ]]; then
      echo "[build-macos-arm64] ERROR: sidecar signature hash changed while signing app bundle" >&2
      echo "[build-macos-arm64] before=${sidecar_cdhash_before}" >&2
      echo "[build-macos-arm64] after=${sidecar_cdhash_after}" >&2
      exit 1
    fi
  fi

  codesign --verify --deep --strict --verbose=2 "${app_bundle}"
}

if [[ -n "${LATEST_APP}" && -d "${LATEST_APP}" ]]; then
  echo "[build-macos-arm64] Copying app bundle to canonical destination..."
  cp -R "${LATEST_APP}" "${CANONICAL_OUTPUT_DIR}/"
  sign_canonical_app_bundle "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}"

  LATEST_DMG_NAME="$(basename "${LATEST_DMG:-AmbiCrew_1.0.0_aarch64.dmg}")"
  echo "[build-macos-arm64] Rebuilding canonical DMG..."
  build_canonical_dmg \
    "${CANONICAL_OUTPUT_DIR}/${APP_BUNDLE_NAME}" \
    "${CANONICAL_OUTPUT_DIR}/${LATEST_DMG_NAME}"
else
  echo "[build-macos-arm64] ERROR: No built app bundle found!" >&2
  exit 1
fi

cat > "${CANONICAL_OUTPUT_DIR}/BUILD_INFO.txt" <<EOF
Target triple: ${TARGET_TRIPLE}
Canonical output: ${CANONICAL_OUTPUT_DIR}
Source DMG: ${LATEST_DMG:-not found}
Source app: ${LATEST_APP:-not found}
Built at: $(date '+%Y-%m-%d %H:%M:%S %z')
EOF

echo
echo "[build-macos-arm64] Build finished."
echo "[build-macos-arm64] App source: ${LATEST_APP}"
echo "[build-macos-arm64] Canonical output: ${CANONICAL_OUTPUT_DIR}"

if [[ "${OPEN_OUTPUT:-0}" == "1" ]]; then
  open "${CANONICAL_OUTPUT_DIR}"
fi
