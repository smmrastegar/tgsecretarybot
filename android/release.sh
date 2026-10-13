#!/usr/bin/env bash
# Build the signed APK, publish it, and write the version file the app checks to offer "Update".
# Needs JDK 17+, Gradle 8.7+, Android SDK (see README.md). Run from anywhere: android/release.sh
set -euo pipefail
cd "$(dirname "$0")"
gradle assembleRelease --offline -q 2>/dev/null || gradle assembleRelease -q
cp app/build/outputs/apk/release/app-release.apk ../public/downloads/MyMusic.apk
code=$(sed -n "s/.*versionCode \([0-9]*\).*/\1/p" app/build.gradle | head -1)
name=$(sed -n "s/.*versionName '\([^']*\)'.*/\1/p" app/build.gradle | head -1)
size=$(stat -c %s ../public/downloads/MyMusic.apk)
printf '{"versionCode":%s,"versionName":"%s","apk":"/downloads/MyMusic.apk","size":%s}\n' "$code" "$name" "$size" > ../public/downloads/app-version.json
echo "published $name ($code), $size bytes"
