#!/usr/bin/env bash
# Archive lint for iOS release hygiene (IOS-SEC.1 / IOS-DIST.1).
# Fails if Release would resolve a non-HTTPS API base from Info.plist,
# or if Xcode is below the App Store SDK floor (26).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$ROOT/ios/NoMarkup/Info.plist"
PBX="$ROOT/ios/NoMarkup.xcodeproj/project.pbxproj"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

# --- Xcode 26+ floor (ASC upload requirement as of 2026-04-28) ---
if [[ -n "${DEVELOPER_DIR:-}" ]]; then
  XCODE_VER="$("$DEVELOPER_DIR/usr/bin/xcodebuild" -version 2>/dev/null | head -1 || true)"
else
  XCODE_VER="$(xcodebuild -version 2>/dev/null | head -1 || true)"
fi
if [[ -z "$XCODE_VER" ]]; then
  fail "xcodebuild not found; set DEVELOPER_DIR to Xcode 26+"
fi
# Expect "Xcode 26.x" or higher
MAJOR="$(echo "$XCODE_VER" | sed -n 's/Xcode \([0-9]*\).*/\1/p')"
if [[ -z "$MAJOR" || "$MAJOR" -lt 26 ]]; then
  fail "Xcode 26+ required for ASC upload (got: $XCODE_VER). export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer"
fi
ok "Xcode floor: $XCODE_VER"

# --- Info.plist APIBaseURL must be empty or https ---
if [[ ! -f "$PLIST" ]]; then
  fail "missing $PLIST"
fi
BASE="$(/usr/libexec/PlistBuddy -c 'Print :APIBaseURL' "$PLIST" 2>/dev/null || echo "")"
if [[ -n "$BASE" && "$BASE" != https://* ]]; then
  fail "Info.plist APIBaseURL must be empty or https://… (got: $BASE)"
fi
ok "APIBaseURL is release-safe (${BASE:-empty → AppConfig production HTTPS})"

# --- No NSAllowsLocalNetworking in shipping plist ---
if /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$PLIST" &>/dev/null; then
  fail "NSAllowsLocalNetworking must not ship in Release Info.plist (ATS fail-closed)"
fi
ok "ATS has no local-networking exception in Info.plist"

# --- Marketing version policy ---
if ! grep -q 'MARKETING_VERSION = 1.0.0' "$PBX"; then
  fail "expected MARKETING_VERSION = 1.0.0 for first public release"
fi
ok "MARKETING_VERSION is 1.0.0"

# --- Privacy manifest present ---
if [[ ! -f "$ROOT/ios/NoMarkup/PrivacyInfo.xcprivacy" ]]; then
  fail "PrivacyInfo.xcprivacy missing"
fi
ok "PrivacyInfo.xcprivacy present"

# --- Export compliance key ---
ENC="$(/usr/libexec/PlistBuddy -c 'Print :ITSAppUsesNonExemptEncryption' "$PLIST" 2>/dev/null || echo missing)"
if [[ "$ENC" != "false" ]]; then
  fail "ITSAppUsesNonExemptEncryption must be false (got: $ENC)"
fi
ok "ITSAppUsesNonExemptEncryption=false"

echo
echo "Archive lint passed. Still required before upload:"
echo "  - Human device smoke (SE / iPad / AX5) — docs/compliance/device-smoke-checklist.md"
echo "  - ASC privacy labels + age rating entry"
echo "  - APNS_*.env for production push delivery"
echo "  - Serve AASA at https://no-markup.com/.well-known/apple-app-site-association"
