#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pick_java_home() {
  if [[ -n "${JAVA_HOME:-}" ]] && [[ -x "${JAVA_HOME}/bin/javac" ]]; then
    echo "$JAVA_HOME"
    return
  fi
  for candidate in \
    /usr/lib/jvm/java-21-openjdk \
    /usr/lib/jvm/java-21 \
    /usr/lib/jvm/java-17-openjdk \
    /usr/lib/jvm/java-17; do
    if [[ -x "${candidate}/bin/javac" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

export JAVA_HOME="$(pick_java_home)"
if [[ -z "$JAVA_HOME" ]]; then
  echo "No JDK with javac found. Run: npm run setup:android"
  echo "(Fedora/Nobara: sudo dnf install -y java-21-openjdk-devel)"
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

if [[ -z "${ANDROID_HOME:-}" ]] && [[ -z "${ANDROID_SDK_ROOT:-}" ]]; then
  if [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  fi
fi

if [[ -z "${ANDROID_HOME:-}" ]] && [[ -z "${ANDROID_SDK_ROOT:-}" ]] && [[ ! -f "$ROOT/android/local.properties" ]]; then
  echo "Android SDK not configured. Set ANDROID_HOME, or create android/local.properties from android/local.properties.example"
  exit 1
fi

npm run build
npx cap sync android
(cd android && ./gradlew assembleDebug)

echo ""
echo "APK: $ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
