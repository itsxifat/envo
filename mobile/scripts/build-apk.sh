#!/usr/bin/env bash
# Builds the signed release APK that the website offers: mobile/dist/envo-phone.apk plus
# envo-phone.json (its version). deploy/deploy.sh uploads both when the APK changed.
#   mobile/scripts/build-apk.sh
# Signing: ~/.envo-release/signing.properties (see plugins/withReleaseSigning.js); without it the APK
# is signed with the debug key and can't update an installed release. Before each new release, raise
# "version" and android.versionCode in app.json. Stop the emulator first: a full-speed Gradle build
# next to it can hang this Mac.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -f "$HOME/.envo-release/signing.properties" ] || [ -n "${ENVO_SIGNING_PROPERTIES:-}" ] || echo "[apk] no release key found: signing with the debug key" >&2

npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --max-workers=4)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/envo-phone.apk
node -e '
const a = require("./app.json").expo;
require("fs").writeFileSync("dist/envo-phone.json", JSON.stringify({ version: a.version, versionCode: a.android.versionCode, built_at: new Date().toISOString() }, null, 2) + "\n");
'
echo "[apk] dist/envo-phone.apk ($(du -h dist/envo-phone.apk | cut -f1 | tr -d ' ')), version $(node -p 'require("./app.json").expo.version')"
