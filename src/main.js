import { connectGanCube } from "gan-web-bluetooth";
import { installNativeBluetoothShimIfNeeded } from "./nativeBluetooth";

const STORAGE_KEY = "gan-smartcube-lite-solves-v1";
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const RELEASES_API_URL = "https://api.github.com/repos/Dawnforger/hscube/releases?per_page=20";
const FACELET_POLL_THROTTLE_MS = 180;

const elements = {
  connectBtn: document.querySelector("#connect-btn"),
  disconnectBtn: document.querySelector("#disconnect-btn"),
  connectionStatus: document.querySelector("#connection-status"),
  timerDisplay: document.querySelector("#timer-display"),
  manualToggleBtn: document.querySelector("#manual-toggle-btn"),
  resetBtn: document.querySelector("#reset-btn"),
  autoTimerCheckbox: document.querySelector("#auto-timer-checkbox"),
  totalSolves: document.querySelector("#total-solves"),
  ao5Value: document.querySelector("#ao5-value"),
  solveList: document.querySelector("#solve-list"),
  clearSolvesBtn: document.querySelector("#clear-solves-btn"),
  appVersion: document.querySelector("#app-version"),
  updateStatus: document.querySelector("#update-status"),
  checkUpdateBtn: document.querySelector("#check-update-btn"),
  downloadUpdateBtn: document.querySelector("#download-update-btn"),
};

let cubeConnection = null;
let cubeEventsSubscription = null;
let faceletPollHandle = null;
let timerRunning = false;
let timerStartPerfMs = 0;
let elapsedMs = 0;
let frameId = null;
let wasCubeSolved = true;
let sawUnsolvedDuringRun = false;
let nativeBluetoothActive = false;
let latestApkDownloadUrl = null;

const solves = loadSolves();

elements.connectBtn.addEventListener("click", onConnectClick);
elements.disconnectBtn.addEventListener("click", disconnectCube);
elements.manualToggleBtn.addEventListener("click", () => toggleManualTimer());
elements.resetBtn.addEventListener("click", resetTimer);
elements.clearSolvesBtn.addEventListener("click", clearSolves);
elements.checkUpdateBtn.addEventListener("click", () => {
  void checkForUpdate({ userInitiated: true });
});
elements.downloadUpdateBtn.addEventListener("click", openLatestApk);
elements.autoTimerCheckbox.addEventListener("change", () => {
  if (!elements.autoTimerCheckbox.checked) {
    wasCubeSolved = true;
    sawUnsolvedDuringRun = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) {
    return;
  }

  if (
    document.activeElement &&
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
      document.activeElement.tagName,
    )
  ) {
    return;
  }

  event.preventDefault();
  toggleManualTimer();
});

void bootstrap();

async function bootstrap() {
  renderTimer();
  renderSolves();
  elements.appVersion.textContent = APP_VERSION;
  setUpdateStatus("Not checked yet.");
  setBluetoothStatus("Not connected.");
  elements.connectBtn.disabled = true;

  try {
    nativeBluetoothActive = await installNativeBluetoothShimIfNeeded();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBluetoothStatus(`Bluetooth initialization failed: ${message}`);
    return;
  }

  if (!("bluetooth" in navigator)) {
    setBluetoothStatus("Bluetooth is not available in this environment.");
    return;
  }

  if (nativeBluetoothActive) {
    setBluetoothStatus("Native BLE ready (GAN-compatible filter). Tap Connect Cube.");
    void checkForUpdate({ userInitiated: false });
  }

  elements.connectBtn.disabled = false;
}

async function onConnectClick() {
  if (!("bluetooth" in navigator)) {
    return;
  }

  elements.connectBtn.disabled = true;
  elements.disconnectBtn.disabled = true;
  setBluetoothStatus(
    nativeBluetoothActive
      ? "Opening native Bluetooth picker..."
      : "Opening Bluetooth device picker...",
  );

  try {
    const connection = await connectGanCube(makeMacAddressProvider());
    cubeConnection = connection;
    cubeEventsSubscription = connection.events$.subscribe((event) => {
      void onGanCubeEvent(event);
    });

    setBluetoothStatus(`Connected: ${connection.deviceName}`);
    elements.disconnectBtn.disabled = false;

    // Seed initial state and keep state fresh while solving.
    await connection.sendCubeCommand({ type: "REQUEST_FACELETS" });
    sawUnsolvedDuringRun = false;
    wasCubeSolved = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes("can't find target ble services") ||
      normalized.includes("characteristic not found")
    ) {
      setBluetoothStatus(
        "Connection failed: this cube protocol is not yet supported in current build.",
      );
    } else if (normalized.includes("unable to determine cube mac")) {
      setBluetoothStatus(
        "Connection failed: unable to determine cube MAC, please retry pairing.",
      );
    } else {
      setBluetoothStatus(`Connection failed: ${message}`);
    }

    await disconnectCube({ preserveStatus: true });
  } finally {
    elements.connectBtn.disabled = false;
  }
}

async function disconnectCube(options = {}) {
  const { preserveStatus = false } = options;

  if (faceletPollHandle) {
    window.clearTimeout(faceletPollHandle);
    faceletPollHandle = null;
  }

  if (cubeEventsSubscription) {
    cubeEventsSubscription.unsubscribe();
    cubeEventsSubscription = null;
  }

  if (cubeConnection) {
    await cubeConnection.disconnect().catch(() => undefined);
    cubeConnection = null;
  }

  elements.disconnectBtn.disabled = true;
  if (!preserveStatus) {
    setBluetoothStatus("Disconnected.");
  }
}

async function onGanCubeEvent(event) {
  if (!cubeConnection) {
    return;
  }

  if (event.type === "DISCONNECT") {
    await disconnectCube();
    return;
  }

  if (!elements.autoTimerCheckbox.checked) {
    return;
  }

  if (event.type === "MOVE") {
    if (!timerRunning && wasCubeSolved) {
      startTimer();
    }
    sawUnsolvedDuringRun = true;
    wasCubeSolved = false;
    scheduleFaceletPoll();
    return;
  }

  if (event.type !== "FACELETS") {
    return;
  }

  const cubeIsSolved = isFaceletsSolved(event.facelets);
  if (!timerRunning && wasCubeSolved && !cubeIsSolved) {
    startTimer();
  }
  if (timerRunning && !cubeIsSolved) {
    sawUnsolvedDuringRun = true;
  }
  if (timerRunning && sawUnsolvedDuringRun && cubeIsSolved) {
    stopTimer({ saveSolve: true, source: "cube" });
  }
  wasCubeSolved = cubeIsSolved;
}

function scheduleFaceletPoll() {
  if (faceletPollHandle || !cubeConnection) {
    return;
  }

  faceletPollHandle = window.setTimeout(async () => {
    faceletPollHandle = null;
    if (!cubeConnection) {
      return;
    }
    await cubeConnection.sendCubeCommand({ type: "REQUEST_FACELETS" }).catch(() => undefined);
  }, FACELET_POLL_THROTTLE_MS);
}

function startTimer() {
  if (timerRunning) {
    return;
  }
  timerRunning = true;
  timerStartPerfMs = performance.now() - elapsedMs;
  tickTimer();
}

function stopTimer({ saveSolve, source }) {
  if (!timerRunning) {
    return;
  }
  timerRunning = false;
  elapsedMs = performance.now() - timerStartPerfMs;
  cancelAnimationFrame(frameId);
  frameId = null;
  renderTimer();
  elements.manualToggleBtn.textContent = "Start / Stop (Space)";

  if (saveSolve && elapsedMs >= 10) {
    addSolve(elapsedMs, source);
  }
}

function toggleManualTimer() {
  if (timerRunning) {
    stopTimer({ saveSolve: true, source: "manual" });
    return;
  }
  sawUnsolvedDuringRun = true;
  startTimer();
}

function resetTimer() {
  if (timerRunning) {
    stopTimer({ saveSolve: false, source: "manual" });
  }
  elapsedMs = 0;
  renderTimer();
}

function tickTimer() {
  if (!timerRunning) {
    return;
  }
  elapsedMs = performance.now() - timerStartPerfMs;
  renderTimer();
  elements.manualToggleBtn.textContent = "Stop (Space)";
  frameId = requestAnimationFrame(tickTimer);
}

function addSolve(timeMs, source) {
  solves.push({
    id: crypto.randomUUID(),
    timeMs: Math.round(timeMs),
    source,
    recordedAt: new Date().toISOString(),
  });
  saveSolves(solves);
  renderSolves();
}

function clearSolves() {
  if (!solves.length) {
    return;
  }
  const approved = window.confirm("Delete all recorded solves?");
  if (!approved) {
    return;
  }
  solves.length = 0;
  saveSolves(solves);
  renderSolves();
}

async function checkForUpdate({ userInitiated }) {
  elements.checkUpdateBtn.disabled = true;
  latestApkDownloadUrl = null;
  elements.downloadUpdateBtn.disabled = true;
  elements.downloadUpdateBtn.textContent = "Open latest APK";
  setUpdateStatus("Checking for updates...");

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      throw new Error(`Release lookup failed (${response.status})`);
    }

    const releases = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error("Unexpected release payload.");
    }

    const latestRelease = pickLatestApkRelease(releases);
    if (!latestRelease) {
      setUpdateStatus("No APK release found yet.");
      return;
    }

    const apkAsset = latestRelease.assets.find((asset) =>
      String(asset?.name ?? "").toLowerCase().endsWith(".apk"),
    );
    if (!apkAsset?.browser_download_url) {
      setUpdateStatus("Latest release has no APK asset.");
      return;
    }

    latestApkDownloadUrl = apkAsset.browser_download_url;
    const remoteVersion = parseVersion(latestRelease.tag_name) ?? parseVersion(apkAsset.name);
    if (!remoteVersion) {
      setUpdateStatus(`Latest APK found: ${latestRelease.tag_name}`);
      elements.downloadUpdateBtn.disabled = false;
      return;
    }

    const comparison = compareSemver(remoteVersion, APP_VERSION);
    if (comparison > 0) {
      setUpdateStatus(`Update available: v${remoteVersion} (current v${APP_VERSION}).`);
      elements.downloadUpdateBtn.textContent = `Download v${remoteVersion}`;
      elements.downloadUpdateBtn.disabled = false;
      return;
    }

    if (comparison === 0) {
      setUpdateStatus(`You are on the latest version (v${APP_VERSION}).`);
      if (userInitiated) {
        elements.downloadUpdateBtn.textContent = "Reinstall current APK";
        elements.downloadUpdateBtn.disabled = false;
      }
      return;
    }

    setUpdateStatus(`Installed version (v${APP_VERSION}) is newer than release v${remoteVersion}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateStatus(`Update check failed: ${message}`);
  } finally {
    elements.checkUpdateBtn.disabled = false;
  }
}

function openLatestApk() {
  if (!latestApkDownloadUrl) {
    return;
  }

  window.open(latestApkDownloadUrl, "_blank", "noopener,noreferrer");
}

function renderTimer() {
  elements.timerDisplay.textContent = formatTime(elapsedMs);
}

function renderSolves() {
  elements.totalSolves.textContent = String(solves.length);

  const ao5 = calculateAo5(solves);
  elements.ao5Value.textContent = ao5 === null ? "N/A" : formatTime(ao5);

  elements.solveList.replaceChildren();

  if (!solves.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No solves recorded yet.";
    elements.solveList.append(emptyItem);
    return;
  }

  const reversed = [...solves].reverse();
  for (const solve of reversed) {
    const index = solves.findIndex((entry) => entry.id === solve.id) + 1;
    const item = document.createElement("li");
    item.textContent = `#${index} - ${formatTime(solve.timeMs)} (${solve.source})`;
    elements.solveList.append(item);
  }
}

function formatTime(timeMs) {
  const safeMs = Math.max(0, Math.round(timeMs));
  const totalCentiseconds = Math.floor(safeMs / 10);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }

  return `${seconds}.${String(centiseconds).padStart(2, "0")}`;
}

function calculateAo5(allSolves) {
  if (allSolves.length < 5) {
    return null;
  }

  const latestFive = allSolves.slice(-5).map((solve) => solve.timeMs);
  const sorted = [...latestFive].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, 4);
  const sum = trimmed.reduce((accumulator, value) => accumulator + value, 0);
  return sum / trimmed.length;
}

function loadSolves() {
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => typeof entry?.timeMs === "number")
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
        timeMs: Math.max(0, Math.round(entry.timeMs)),
        source: entry.source === "cube" ? "cube" : "manual",
        recordedAt:
          typeof entry.recordedAt === "string"
            ? entry.recordedAt
            : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function saveSolves(value) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function pickLatestApkRelease(releases) {
  return releases.find(
    (release) =>
      !release?.draft &&
      Array.isArray(release?.assets) &&
      release.assets.some((asset) =>
        String(asset?.name ?? "").toLowerCase().endsWith(".apk"),
      ),
  );
}

function parseVersion(value) {
  const match = String(value ?? "").match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function compareSemver(a, b) {
  const left = a.split(".").map((segment) => Number.parseInt(segment, 10));
  const right = b.split(".").map((segment) => Number.parseInt(segment, 10));

  for (let index = 0; index < 3; index += 1) {
    const l = Number.isFinite(left[index]) ? left[index] : 0;
    const r = Number.isFinite(right[index]) ? right[index] : 0;
    if (l > r) {
      return 1;
    }
    if (l < r) {
      return -1;
    }
  }

  return 0;
}

function isFaceletsSolved(facelets) {
  if (typeof facelets !== "string" || facelets.length < 54) {
    return false;
  }

  for (let faceIndex = 0; faceIndex < 6; faceIndex += 1) {
    const start = faceIndex * 9;
    const anchor = facelets[start];
    for (let offset = 1; offset < 9; offset += 1) {
      if (facelets[start + offset] !== anchor) {
        return false;
      }
    }
  }

  return true;
}

function makeMacAddressProvider() {
  return async (device, isFallbackCall = false) => {
    if (!nativeBluetoothActive) {
      return null;
    }

    const mac = extractMacFromString(device?.id ?? "");
    if (mac) {
      return mac;
    }

    if (isFallbackCall) {
      throw new Error("Unable to determine cube MAC from native BLE device ID.");
    }

    return null;
  };
}

function extractMacFromString(value) {
  const match = String(value).match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
  if (!match) {
    return null;
  }
  return match[0].replace(/-/g, ":").toUpperCase();
}

function setUpdateStatus(message) {
  elements.updateStatus.textContent = message;
}

function setBluetoothStatus(message) {
  elements.connectionStatus.textContent = message;
}
