# GAN Smartcube Lite

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
- Bluetooth behavior inside Android WebView can differ from desktop Chrome Web Bluetooth support.
- For robust native BLE behavior on Android devices, a follow-up native BLE bridge/plugin path is recommended.
