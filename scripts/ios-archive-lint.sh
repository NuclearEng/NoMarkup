#!/usr/bin/env bash
# Archive lint for iOS release hygiene (IOS-SEC.1 / IOS-DIST.1).
# Fails if Release would resolve a non-HTTPS API base from Info.plist,
# or if Xcode is below the App Store SDK floor (26).
#
# DIST.17 Support URL DNS/HTTP is a **warning only** (never exit 1). Public
# no-markup.com DNS is founder/ops; the binary ships a native Support fallback.
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

# --- ATS fail-closed: no exceptions in the Release/shipping Info.plist ---
# Lint THIS file only. Do not grep ios/**/*.plist — Debug Info-Debug.plist is
# allowed NSAllowsLocalNetworking for device LAN http://192.168.x.x:8081.
# Release INFOPLIST_FILE must stay NoMarkup/Info.plist (default HTTPS-only).
if /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "$PLIST" &>/dev/null; then
  fail "NSAppTransportSecurity must be absent from shipping Info.plist (default ATS only; no ArbitraryLoads / LocalNetworking)"
fi
ok "ATS has no exceptions in Info.plist (default HTTPS-only)"

# App-target Debug vs Release INFOPLIST_FILE (F1000…0009 / F1000…000A).
if ! grep -q 'F10000000000000000000009 /\* Debug \*/' "$PBX"; then
  fail "expected app Debug XCBuildConfiguration F1000…0009"
fi
DEBUG_INFOPLIST="$(sed -n '/F10000000000000000000009 \/\* Debug \*\//,/name = Debug;/p' "$PBX" | sed -n 's/.*INFOPLIST_FILE = \(.*\);/\1/p' | tail -1 | tr -d ' "')"
RELEASE_INFOPLIST="$(sed -n '/F1000000000000000000000A \/\* Release \*\//,/name = Release;/p' "$PBX" | sed -n 's/.*INFOPLIST_FILE = \(.*\);/\1/p' | tail -1 | tr -d ' "')"
if [[ "$DEBUG_INFOPLIST" != "NoMarkup/Info-Debug.plist" ]]; then
  fail "Debug INFOPLIST_FILE must be NoMarkup/Info-Debug.plist (got: ${DEBUG_INFOPLIST:-missing})"
fi
if [[ "$RELEASE_INFOPLIST" != "NoMarkup/Info.plist" ]]; then
  fail "Release INFOPLIST_FILE must be NoMarkup/Info.plist (got: ${RELEASE_INFOPLIST:-missing})"
fi
ok "Debug uses Info-Debug.plist; Release uses shipping Info.plist"

DEBUG_PLIST="$ROOT/ios/NoMarkup/Info-Debug.plist"
if [[ ! -f "$DEBUG_PLIST" ]]; then
  fail "missing $DEBUG_PLIST"
fi
DEBUG_BASE="$(/usr/libexec/PlistBuddy -c 'Print :APIBaseURL' "$DEBUG_PLIST" 2>/dev/null || echo "")"
if [[ -n "$DEBUG_BASE" ]]; then
  fail "Info-Debug.plist APIBaseURL must stay empty (got: $DEBUG_BASE)"
fi
LOCAL_NET="$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$DEBUG_PLIST" 2>/dev/null || echo missing)"
if [[ "$LOCAL_NET" != "true" ]]; then
  fail "Info-Debug.plist must set NSAllowsLocalNetworking=true (got: $LOCAL_NET)"
fi
if /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$DEBUG_PLIST" &>/dev/null; then
  fail "Info-Debug.plist must not set NSAllowsArbitraryLoads"
fi
ok "Info-Debug.plist allows local networking only (empty APIBaseURL)"

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

# --- DIST.17 Support URL DNS/HTTP (warn only; founder DNS is not an eng defect) ---
# AppConfig.supportURL stays https://no-markup.com/support for ASC. In-app Support
# uses LegalWebView fallback .nativeSupport + mailto:support@no-markup.com.
# This check never fails the lint. GitHub Actions: ::warning:: annotation.
SUPPORT_CHECK_URL="https://no-markup.com/support"
if curl -sS -o /dev/null --connect-timeout 5 --max-time 10 -I "$SUPPORT_CHECK_URL" 2>/dev/null; then
  ok "DIST.17 Support URL reachable ($SUPPORT_CHECK_URL)"
else
  echo "::warning::DIST.17 Support URL DNS failed" >&2
  echo "WARN: DIST.17 Support URL DNS failed ($SUPPORT_CHECK_URL). Public DNS is founder/ops; archive lint does not fail. In-app Support uses native mailto:support@no-markup.com fallback." >&2
fi

echo
echo "Archive lint passed. Still required before upload:"
echo "  - Human device smoke (SE / iPad / AX5) — docs/compliance/device-smoke-checklist.md"
echo "  - ASC privacy labels + age rating entry"
echo "  - APNS_*.env for production push delivery"
echo "  - Serve AASA at https://no-markup.com/.well-known/apple-app-site-association"
echo "  - DIST.17: public DNS for https://no-markup.com/support (in-app Support is native mailto if NXDOMAIN)"
