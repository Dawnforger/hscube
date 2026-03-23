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
