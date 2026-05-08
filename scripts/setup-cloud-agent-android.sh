#!/usr/bin/env bash
set -euo pipefail

ANDROID_HOME_TARGET="/home/ubuntu/Android/Sdk"
ANDROID_SDK_ROOT_TARGET="$ANDROID_HOME_TARGET"
JAVA_HOME_TARGET="/usr/lib/jvm/java-21-openjdk-amd64"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
PROFILE_EXPORT_LINE='[ -f /home/ubuntu/.android-env.sh ] && . /home/ubuntu/.android-env.sh'

run_as_root() {
  if [[ "${EUID:-}" -eq 0 ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  echo "This setup requires root privileges for package installation." >&2
  exit 1
}

ensure_apt_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "This setup currently supports Debian/Ubuntu images only." >&2
    exit 1
  fi

  local required=(
    openjdk-21-jdk
    curl
    unzip
    ca-certificates
  )
  local missing=()
  local pkg
  for pkg in "${required[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      missing+=("$pkg")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    run_as_root apt-get update
    run_as_root apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

ensure_java_home() {
  if [[ ! -x "${JAVA_HOME_TARGET}/bin/javac" ]]; then
    echo "Expected javac at ${JAVA_HOME_TARGET}/bin/javac but it is unavailable." >&2
    exit 1
  fi
}

ensure_android_cmdline_tools() {
  mkdir -p "${ANDROID_HOME_TARGET}/cmdline-tools"

  local sdkmanager="${ANDROID_HOME_TARGET}/cmdline-tools/latest/bin/sdkmanager"
  if [[ -x "$sdkmanager" ]]; then
    return
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  curl -fsSL "$CMDLINE_TOOLS_URL" -o "${tmp_dir}/commandlinetools.zip"
  unzip -q "${tmp_dir}/commandlinetools.zip" -d "$tmp_dir"

  rm -rf "${ANDROID_HOME_TARGET}/cmdline-tools/latest"
  mv "${tmp_dir}/cmdline-tools" "${ANDROID_HOME_TARGET}/cmdline-tools/latest"
}

accept_android_licenses() {
  local sdkmanager="${ANDROID_HOME_TARGET}/cmdline-tools/latest/bin/sdkmanager"
  local status=0
  set +e
  yes | "$sdkmanager" --sdk_root="${ANDROID_HOME_TARGET}" --licenses >/dev/null
  status=$?
  set -e
  # yes can trigger a SIGPIPE exit (141) once sdkmanager is satisfied.
  if [[ "$status" -ne 0 && "$status" -ne 141 ]]; then
    echo "Failed accepting Android SDK licenses (exit: $status)." >&2
    exit "$status"
  fi
}

ensure_android_packages() {
  local sdkmanager="${ANDROID_HOME_TARGET}/cmdline-tools/latest/bin/sdkmanager"
  "$sdkmanager" --sdk_root="${ANDROID_HOME_TARGET}" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
}

persist_env_vars() {
  local env_file="/home/ubuntu/.android-env.sh"
  cat >"$env_file" <<EOF
export JAVA_HOME="${JAVA_HOME_TARGET}"
export ANDROID_HOME="${ANDROID_HOME_TARGET}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT_TARGET}"
export PATH="\$JAVA_HOME/bin:\$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:\$ANDROID_SDK_ROOT/platform-tools:\$PATH"
EOF

  local profile_file
  for profile_file in /home/ubuntu/.bashrc /home/ubuntu/.profile; do
    if [[ ! -f "$profile_file" ]]; then
      touch "$profile_file"
    fi
    if ! grep -Fq "$PROFILE_EXPORT_LINE" "$profile_file"; then
      printf '\n%s\n' "$PROFILE_EXPORT_LINE" >>"$profile_file"
    fi
  done
}

main() {
  ensure_apt_packages
  ensure_java_home
  ensure_android_cmdline_tools
  accept_android_licenses
  ensure_android_packages
  persist_env_vars
  echo "Android cloud environment configured."
}

main "$@"
