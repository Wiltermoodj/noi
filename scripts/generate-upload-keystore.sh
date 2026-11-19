#!/usr/bin/env bash
set -euo pipefail

# Generate an Android Upload Keystore for Google Play App Signing.
# Run this once on your local machine (requires JDK 17+ keytool).
# NEVER commit the generated .jks file or android/keystore.properties to Git.

if ! command -v keytool >/dev/null 2>&1; then
  echo "Error: 'keytool' not found. Install JDK 21 (Temurin / Android Studio JBR) first." >&2
  exit 1
fi

KEYSTORE_PATH="${1:-$HOME/noi-upload-key.jks}"
KEY_ALIAS="${2:-noi-upload}"

if [ -f "$KEYSTORE_PATH" ]; then
  echo "Error: Keystore already exists at $KEYSTORE_PATH. Refusing to overwrite." >&2
  exit 1
fi

read -rsp "Enter new keystore password (min 6 chars): " STORE_PASSWORD
echo ""
read -rsp "Confirm keystore password: " STORE_PASSWORD_CONFIRM
echo ""
if [ "$STORE_PASSWORD" != "$STORE_PASSWORD_CONFIRM" ] || [ ${#STORE_PASSWORD} -lt 6 ]; then
  echo "Error: Passwords do not match or are shorter than 6 characters." >&2
  exit 1
fi

read -rp "Your name / organization (CN) [Nói Spoken Vietnamese]: " DNAME_CN
DNAME_CN="${DNAME_CN:-Nói Spoken Vietnamese}"
read -rp "Country code (2-letter, e.g. US) [US]: " DNAME_C
DNAME_C="${DNAME_C:-US}"

keytool -genkeypair -v \
  -keystore "$KEYSTORE_PATH" \
  -storetype PKCS12 \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias "$KEY_ALIAS" \
  -storepass "$STORE_PASSWORD" \
  -keypass "$STORE_PASSWORD" \
  -dname "CN=${DNAME_CN}, O=Noi, C=${DNAME_C}"

cat > android/keystore.properties <<EOF
storeFile=${KEYSTORE_PATH}
storePassword=${STORE_PASSWORD}
keyAlias=${KEY_ALIAS}
keyPassword=${STORE_PASSWORD}
EOF

echo ""
echo "✅ Upload keystore created: $KEYSTORE_PATH"
echo "✅ Local signing config written: android/keystore.properties (git-ignored)"
echo ""
echo "Upload certificate SHA-256 fingerprint:"
keytool -list -v -keystore "$KEYSTORE_PATH" -alias "$KEY_ALIAS" -storepass "$STORE_PASSWORD" | grep -E "SHA256:" || true
echo ""
echo "For GitHub Actions (.github/workflows/android-release.yml), add these Repository Secrets:"
echo "  ANDROID_KEY_ALIAS         = $KEY_ALIAS"
echo "  ANDROID_KEYSTORE_PASSWORD = <your keystore password>"
echo "  ANDROID_KEY_PASSWORD      = <your key password>"
echo "  ANDROID_KEYSTORE_BASE64   = (output of: base64 -w 0 \"$KEYSTORE_PATH\"  # macOS: base64 -i \"$KEYSTORE_PATH\" | tr -d '\\n')"
echo ""
echo "⚠️  Back up $KEYSTORE_PATH and its password securely in a password manager!"
