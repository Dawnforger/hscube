#!/usr/bin/env bash
# One-time (or repeat-safe) host setup for Capacitor debug APK builds + GitHub releases.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need_sudo() {
  if [[ "${EUID:-}" -eq 0 ]]; then
    return 1
  fi
  return 0
}

install_jdk_fedora() {
  echo "Installing OpenJDK 21 JDK (includes javac)…"
  if need_sudo; then
    sudo dnf install -y java-21-openjdk-devel
  else
    dnf install -y java-21-openjdk-devel
  fi
}

install_jdk_debian() {
  echo "Installing OpenJDK 21 JDK…"
  if need_sudo; then
    sudo apt-get update
    sudo apt-get install -y openjdk-21-jdk
  else
    apt-get update
    apt-get install -y openjdk-21-jdk
  fi
}

install_gh_fedora() {
  echo "Installing GitHub CLI (gh) for releases…"
  if need_sudo; then
    sudo dnf install -y gh
  else
    dnf install -y gh
  fi
}

install_gh_debian() {
  echo "Installing GitHub CLI (gh) for releases…"
  if need_sudo; then
    sudo apt-get install -y gh
  else
    apt-get install -y gh
  fi
}

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
fi

ID_LIKE="${ID_LIKE:-}"
case "${ID:-}" in
  fedora | nobara)
    install_jdk_fedora
    if ! command -v gh >/dev/null 2>&1; then
      install_gh_fedora || true
    fi
    ;;
  *)
    if [[ "$ID_LIKE" == *fedora* ]] || [[ "$ID_LIKE" == *rhel* ]]; then
      install_jdk_fedora
      if ! command -v gh >/dev/null 2>&1; then
        install_gh_fedora || true
      fi
    elif [[ "${ID:-}" == "debian" ]] || [[ "${ID:-}" == "ubuntu" ]] || [[ "$ID_LIKE" == *debian* ]]; then
      install_jdk_debian
      if ! command -v gh >/dev/null 2>&1; then
        install_gh_debian || true
      fi
    else
      echo "Unknown distro (ID=${ID:-unknown}). Install a full JDK 21 (with javac) and optionally gh yourself."
      exit 1
    fi
    ;;
esac

DEFAULT_SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [[ ! -d "$DEFAULT_SDK" ]] && [[ ! -f "$ROOT/android/local.properties" ]]; then
  echo ""
  echo "No Android SDK found at $DEFAULT_SDK and no android/local.properties."
  echo "Do one of:"
  echo "  • Install Android Studio and let it install the SDK (default: ~/Android/Sdk), then either:"
  echo "      export ANDROID_HOME=\"\$HOME/Android/Sdk\""
  echo "    or copy android/local.properties.example → android/local.properties and set sdk.dir"
  echo "  • Or install SDK command-line tools: https://developer.android.com/studio#command-tools"
else
  echo "Android SDK path looks OK (or android/local.properties exists)."
fi

echo ""
echo "Next:"
echo "  1. gh auth login     # once, for gh release create"
echo "  2. npm install && npm run apk:debug"
echo "  3. scripts/publish-apk-release.sh   # after a successful build (see script header)"
