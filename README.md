# HS Cube

Current app version: **1.4.56**

Minimal open source replacement app for CubeStation focused on:

- Bluetooth connection to GAN smart cubes (including GAN i3) via Web Bluetooth
- Solve workflow with configurable scramble mode (free or algorithm) and inspection timer
- Split-screen navigation with drawer menu (Solve, Records, and Updates)
- 3D rendered cube view on Solve screen with sync status + reset option
- Remembered cube list with optional auto-connect to last cube on Android native runtime
- Solve history persistence in local storage
- Ao5 for the latest five solves (WCA-style trimmed mean)

## Requirements

- Chromium-based browser with Web Bluetooth support
- HTTPS origin or `localhost` (required by Web Bluetooth)

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in a supported browser.

## Build

```bash
npm run build
```

The production bundle is generated in `dist/`.

## Rough Android APK prototype

This project includes a Capacitor Android wrapper so you can generate a test APK.

### One-time environment (Fedora / Nobara / Debian / Ubuntu)

Installs **OpenJDK 21** (full JDK with `javac`, avoids Java 25 Gradle breakage) and **GitHub CLI** when missing:

```bash
npm install
npm run setup:android
```

Point Gradle at your SDK. The `apk:debug` script searches common install locations (including **Flatpak** and **Snap** Android Studio) and can **create** `android/local.properties` for you when it finds one.

If it still fails, set the path explicitly:

- `export ANDROID_HOME="$HOME/Android/Sdk"`, **or**
- Copy `android/local.properties.example` → `android/local.properties` and set `sdk.dir` to a folder that contains `platforms/` or `build-tools/` (install those via Android Studio **SDK Manager** if missing).

Then:

```bash
npm run apk:debug
```

### GitHub Release (APK asset for in-app updates)

After `gh auth login` and a successful `npm run apk:debug`:

```bash
./scripts/publish-apk-release.sh v1.3.3 "Your release notes"
```

Generated APK path:

`android/app/build/outputs/apk/debug/app-debug.apk`

Notes:

- This is a rough prototype package for testing UI/timer flows.
- Building the APK requires Android SDK + Java to be installed locally.
- `npm run apk:debug` prefers JDK 21/17 with `javac` and warns if the SDK is missing.
- Android builds use a native BLE transport (Capacitor BLE plugin), not Web Bluetooth.
- Android native BLE picker is intentionally filtered to GAN-compatible devices.
- Desktop browser builds continue to use Web Bluetooth.

## Versioning and in-app update checks

- The app now exposes its version in the UI header.
- Version source:
  - `package.json` (`version`)
  - `android/app/build.gradle` (`versionCode`, `versionName`)
- In-app update flow:
  - Tap **Check for update** in the **Updates** card.
  - The app queries GitHub Releases for the latest APK asset.
  - If a newer semantic version is found, the app offers an **Open latest APK** action.

Important: Android still requires OS-level APK installation confirmation for sideloaded updates.

## Solve workflow UX

- Configure on screen:
  - Scramble mode: **Free scramble** or **Algorithm scramble**
  - Inspection duration (0-30 seconds)
- Algorithm scramble mode:
  - App generates and displays the scramble algorithm
  - Live progress and next-move guidance
  - Misstep recovery hint (what move to undo)
- Free scramble mode:
  - User scrambles independently and starts inspection when ready
- After scrambling:
  - User taps **Start Inspection**
  - Inspection countdown runs
  - Solve timer auto-starts when inspection reaches zero
