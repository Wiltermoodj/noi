#!/usr/bin/env bash
set -euo pipefail

# Build a release-signed Google Play Android App Bundle (.aab) locally.
# Usage: ./scripts/build-play-release.sh [version_name] [version_code]
# Example: ./scripts/build-play-release.sh 1.0.0 1

VERSION_NAME="${1:-1.0.0}"
VERSION_CODE="${2:-1}"

if ! command -v java >/dev/null 2>&1; then
  echo "Error: JDK 21 is required to build the Android App Bundle (.aab)." >&2
  echo "Install Temurin JDK 21 or use GitHub Actions workflow 'Android Google Play Release'." >&2
  exit 1
fi

if [ ! -f "android/keystore.properties" ] && [ -z "${ANDROID_KEYSTORE_PATH:-}" ]; then
  echo "Error: Signing credentials not found." >&2
  echo "Run ./scripts/generate-upload-keystore.sh or set ANDROID_KEYSTORE_* env vars." >&2
  exit 1
fi

echo "==> Running pre-flight Play Store verification..."
npm run typecheck
npm test
npm run play:verify

echo "==> Building production web bundle and syncing Capacitor Android..."
npm run android:sync

echo "==> Compiling signed release AAB (v${VERSION_NAME}, versionCode ${VERSION_CODE})..."
(
  cd android
  chmod +x gradlew
  ANDROID_REQUIRE_SIGNING=true \
  ANDROID_VERSION_NAME="$VERSION_NAME" \
  ANDROID_VERSION_CODE="$VERSION_CODE" \
  ./gradlew clean bundleRelease
)

AAB_PATH="android/app/build/outputs/bundle/release/app-release.aab"
MAPPING_PATH="android/app/build/outputs/mapping/release/mapping.txt"

if [ ! -f "$AAB_PATH" ]; then
  echo "Error: Expected AAB not found at $AAB_PATH" >&2
  exit 1
fi

if command -v jarsigner >/dev/null 2>&1; then
  echo "==> Verifying AAB cryptographic signature..."
  jarsigner -verify -strict "$AAB_PATH" >/dev/null
  echo "✅ Signature verified!"
fi

echo ""
echo "✅ Google Play release bundle ready!"
echo "   AAB:     $AAB_PATH ($(du -h "$AAB_PATH" | cut -f1))"
if [ -f "$MAPPING_PATH" ]; then
  echo "   Mapping: $MAPPING_PATH"
fi
echo ""
echo "Next: Upload $AAB_PATH to Google Play Console (see play-store/PLAY_CONSOLE_GUIDE.md)."
