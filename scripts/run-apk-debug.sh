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

# Normalize SDK env (Gradle / tools use either name).
if [[ -z "${ANDROID_HOME:-}" ]] && [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [[ -z "${ANDROID_SDK_ROOT:-}" ]] && [[ -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

sdk_looks_valid() {
  local d="$1"
  [[ -d "$d" ]] || return 1
  [[ -d "$d/platforms" ]] || [[ -d "$d/build-tools" ]] || [[ -d "$d/cmdline-tools" ]]
}

read_sdk_dir_from_local_properties() {
  local f="$ROOT/android/local.properties"
  [[ -f "$f" ]] || return 1
  local line
  line="$(grep -E '^[[:space:]]*sdk\.dir[[:space:]]*=' "$f" | tail -1)" || return 1
  line="${line#*=}"
  line="${line//$'\r'/}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  line="${line//\\:/:}"
  # Gradle escapes : as \: on Windows; unescape for bash
  line="${line//\\/}"
  [[ -n "$line" ]] || return 1
  echo "$line"
}

ensure_local_properties() {
  local sdk="$1"
  local prop="$ROOT/android/local.properties"
  if [[ -f "$prop" ]]; then
    return 0
  fi
  # sdk.dir must use escaped backslashes on Windows; on Linux absolute path is fine.
  printf 'sdk.dir=%s\n' "$sdk" >"$prop"
  echo "Wrote $prop (sdk.dir=$sdk)"
}

pick_android_sdk() {
  local dir
  if dir="$(read_sdk_dir_from_local_properties 2>/dev/null)"; then
    if sdk_looks_valid "$dir"; then
      echo "$dir"
      return 0
    fi
    echo "android/local.properties points to invalid or incomplete SDK: $dir" >&2
    echo "Fix sdk.dir or install platforms/build-tools via Android Studio SDK Manager." >&2
    exit 1
  fi

  if [[ -n "${ANDROID_HOME:-}" ]] && sdk_looks_valid "$ANDROID_HOME"; then
    echo "$ANDROID_HOME"
    return 0
  fi

  local candidates=(
    "$HOME/Android/Sdk"
    "$HOME/.Android/Sdk"
    "$HOME/.local/share/Android/Sdk"
    "$HOME/.config/Android/Sdk"
    "/usr/lib/android-sdk"
    "/usr/lib/android/sdk"
    "$HOME/.var/app/com.google.AndroidStudio/data/Android/Sdk"
    "$HOME/.var/app/com.google.AndroidStudio/canary/data/Android/Sdk"
  )
  local snap_base
  for snap_base in "$HOME/snap/android-studio" "$HOME/snap/android-studio-canary"; do
    if [[ -d "$snap_base" ]]; then
      local sd
      for sd in "$snap_base/common/Android/Sdk" "$snap_base/current/Android/Sdk"; do
        candidates+=("$sd")
      done
      local rev
      for rev in "$snap_base"/*; do
        [[ -d "$rev/Android/Sdk" ]] && candidates+=("$rev/Android/Sdk")
      done
    fi
  done

  local c
  for c in "${candidates[@]}"; do
    if sdk_looks_valid "$c"; then
      echo "$c"
      return 0
    fi
  done
  echo ""
  return 1
}

SDK_DIR="$(pick_android_sdk || true)"
if [[ -z "$SDK_DIR" ]]; then
  echo "Android SDK not found."
  echo ""
  echo "Install the SDK with Android Studio (SDK Manager), then either:"
  echo "  export ANDROID_HOME=\"\$HOME/Android/Sdk\""
  echo "or copy android/local.properties.example → android/local.properties and set sdk.dir to your SDK path."
  echo ""
  echo "Typical locations after installing Android Studio:"
  echo "  $HOME/Android/Sdk"
  echo "  $HOME/.var/app/com.google.AndroidStudio/data/Android/Sdk   (Flatpak)"
  echo "  $HOME/snap/android-studio/common/Android/Sdk                 (Snap)"
  exit 1
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
ensure_local_properties "$SDK_DIR"

npm run build
npx cap sync android
(cd android && ./gradlew assembleDebug)

echo ""
echo "APK: $ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
