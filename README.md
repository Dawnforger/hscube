# GAN Smartcube Lite

Current app version: **1.1.2**

Minimal open source replacement app for CubeStation focused on:

- Bluetooth connection to GAN smart cubes (including GAN i3) via Web Bluetooth
- Streamlined timer (manual and auto start/stop from cube state)
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

```bash
npm install
npm run apk:debug
```

Generated APK path:

`android/app/build/outputs/apk/debug/app-debug.apk`

Notes:

- This is a rough prototype package for testing UI/timer flows.
- Building the APK requires Android SDK + Java to be installed locally.
- If your SDK is not auto-detected, set `ANDROID_HOME` / `ANDROID_SDK_ROOT`.
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
