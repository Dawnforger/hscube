import { connectGanCube } from "gan-web-bluetooth";
import { createCubeRenderer } from "./cubeRenderer";
import {
  clearNativePreferredDevice,
  installNativeBluetoothShimIfNeeded,
  setNativePreferredDevice,
} from "./nativeBluetooth";

const STORAGE_KEY = "hs-cube-solves-v1";
const KNOWN_CUBES_KEY = "gan-smartcube-known-cubes-v1";
const LAST_CUBE_KEY = "gan-smartcube-last-cube-v1";
const AUTO_CONNECT_LAST_CUBE_KEY = "gan-smartcube-auto-connect-last-cube-v1";
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const RELEASES_API_URL = "https://api.github.com/repos/Dawnforger/hscube/releases?per_page=20";
const FACELET_POLL_THROTTLE_MS = 180;
const SCRAMBLE_LENGTH = 20;
const MAX_INSPECTION_SECONDS = 30;
const WORKFLOW_PHASE = {
  IDLE: "idle",
  SCRAMBLING: "scrambling",
  READY_INSPECTION: "ready_inspection",
  INSPECTION: "inspection",
  SOLVING: "solving",
};
const SCRAMBLE_MODE = {
  FREE: "free",
  ALG: "alg",
};

const elements = {
  menuToggleBtn: document.querySelector("#menu-toggle-btn"),
  sideDrawer: document.querySelector("#side-drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  navSolveBtn: document.querySelector("#nav-solve-btn"),
  navRecordsBtn: document.querySelector("#nav-records-btn"),
  navUpdatesBtn: document.querySelector("#nav-updates-btn"),
  solveScreen: document.querySelector("#solve-screen"),
  recordsScreen: document.querySelector("#records-screen"),
  updatesScreen: document.querySelector("#updates-screen"),
  connectBtn: document.querySelector("#connect-btn"),
  disconnectBtn: document.querySelector("#disconnect-btn"),
  connectionStatus: document.querySelector("#connection-status"),
  cubeViewport: document.querySelector("#cube-viewport"),
  cubeSyncStatus: document.querySelector("#cube-sync-status"),
  resetCubeSyncBtn: document.querySelector("#reset-cube-sync-btn"),
  timerDisplay: document.querySelector("#timer-display"),
  inspectionDisplay: document.querySelector("#inspection-display"),
  manualToggleBtn: document.querySelector("#manual-toggle-btn"),
  resetBtn: document.querySelector("#reset-btn"),
  scrambleModeSelect: document.querySelector("#scramble-mode-select"),
  inspectionSecondsInput: document.querySelector("#inspection-seconds-input"),
  prepareSolveBtn: document.querySelector("#prepare-solve-btn"),
  startInspectionBtn: document.querySelector("#start-inspection-btn"),
  workflowStatus: document.querySelector("#workflow-status"),
  scrambleDisplay: document.querySelector("#scramble-display"),
  scrambleProgress: document.querySelector("#scramble-progress"),
  totalSolves: document.querySelector("#total-solves"),
  ao5Value: document.querySelector("#ao5-value"),
  solveList: document.querySelector("#solve-list"),
  clearSolvesBtn: document.querySelector("#clear-solves-btn"),
  appVersion: document.querySelector("#app-version"),
  updateStatus: document.querySelector("#update-status"),
  checkUpdateBtn: document.querySelector("#check-update-btn"),
  downloadUpdateBtn: document.querySelector("#download-update-btn"),
  autoConnectCheckbox: document.querySelector("#auto-connect-checkbox"),
  forgetCubesBtn: document.querySelector("#forget-cubes-btn"),
  rememberedCubesStatus: document.querySelector("#remembered-cubes-status"),
};

let cubeConnection = null;
let cubeEventsSubscription = null;
let faceletPollHandle = null;
let timerRunning = false;
let timerStartPerfMs = 0;
let elapsedMs = 0;
let frameId = null;
let sawUnsolvedDuringRun = false;
let nativeBluetoothActive = false;
let latestApkDownloadUrl = null;
let latestReleasePageUrl = null;
let currentCubeSolved = true;
let currentFacelets = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
let cubeRenderer = null;
let activeScreen = "solve";
let autoConnectAttempted = false;
let autoConnectInProgress = false;
let suppressDisconnectRemembering = false;

let workflowPhase = WORKFLOW_PHASE.IDLE;
let scrambleMode = SCRAMBLE_MODE.ALG;
let inspectionSeconds = 15;
let scrambleMoves = [];
let scrambleStep = 0;
let pendingDoubleMoveToken = null;
let pendingDoubleMoveDirection = null;
let scrambleOffTrackMove = null;
let inspectionEndPerfMs = 0;
let inspectionFrameId = null;

const solves = loadSolves();
const knownCubes = loadKnownCubes();

elements.connectBtn.addEventListener("click", onConnectClick);
elements.disconnectBtn.addEventListener("click", () => {
  void disconnectCube();
});
elements.menuToggleBtn.addEventListener("click", toggleDrawer);
elements.drawerBackdrop.addEventListener("click", closeDrawer);
elements.navSolveBtn.addEventListener("click", () => switchScreen("solve"));
elements.navRecordsBtn.addEventListener("click", () => switchScreen("records"));
elements.navUpdatesBtn.addEventListener("click", () => switchScreen("updates"));
elements.resetCubeSyncBtn.addEventListener("click", () => {
  void resetCubeData();
});
elements.manualToggleBtn.addEventListener("click", () => toggleManualTimer());
elements.resetBtn.addEventListener("click", resetTimer);
elements.prepareSolveBtn.addEventListener("click", () => {
  void prepareSolveCycle();
});
elements.startInspectionBtn.addEventListener("click", () => startInspection());
elements.scrambleModeSelect.addEventListener("change", onWorkflowConfigChange);
elements.inspectionSecondsInput.addEventListener("change", onWorkflowConfigChange);
elements.clearSolvesBtn.addEventListener("click", clearSolves);
elements.checkUpdateBtn.addEventListener("click", () => {
  void checkForUpdate({ userInitiated: true });
});
elements.downloadUpdateBtn.addEventListener("click", openLatestApk);
elements.autoConnectCheckbox.addEventListener("change", onAutoConnectToggle);
elements.forgetCubesBtn.addEventListener("click", forgetRememberedCubes);

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
  switchScreen("solve");
  cubeRenderer = createCubeRenderer(elements.cubeViewport);
  cubeRenderer.updateFromFacelets(currentFacelets);
  setCubeSyncStatus("Waiting for cube state...");
  renderTimer();
  renderInspection();
  renderSolves();
  renderRememberedCubesStatus();
  renderWorkflow();
  elements.appVersion.textContent = APP_VERSION;
  elements.autoConnectCheckbox.checked = loadAutoConnectPreference();
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
    setBluetoothStatus("Native BLE ready. Connect cube then prepare solve.");
    void checkForUpdate({ userInitiated: false });
    if (elements.autoConnectCheckbox.checked) {
      void maybeAutoConnectLastCube();
    }
  }

  elements.connectBtn.disabled = false;
}

window.addEventListener("beforeunload", () => {
  cubeRenderer?.destroy();
});

async function onConnectClick() {
  autoConnectAttempted = true;
  suppressDisconnectRemembering = false;
  clearNativePreferredDevice();
  setBluetoothStatus(
    nativeBluetoothActive
      ? "Opening native Bluetooth picker..."
      : "Opening Bluetooth device picker...",
  );
  await connectToCube({
    usePreferredDevice: false,
    suppressPickerOnFailure: false,
    userInitiated: true,
  });
}

async function connectToCube(options = {}) {
  const {
    usePreferredDevice = false,
    suppressPickerOnFailure = false,
    userInitiated = false,
  } = options;
  if (!("bluetooth" in navigator)) {
    return;
  }

  elements.connectBtn.disabled = true;
  elements.disconnectBtn.disabled = true;
  if (usePreferredDevice && !userInitiated) {
    setBluetoothStatus("Attempting auto-connect to last cube...");
  }

  try {
    if (nativeBluetoothActive && usePreferredDevice) {
      const lastCube = getLastCube();
      if (lastCube?.id) {
        setNativePreferredDevice(lastCube.id, { suppressPickerOnFailure });
      }
    }
    const connection = await connectGanCube(makeMacAddressProvider());
    cubeConnection = connection;
    cubeEventsSubscription = connection.events$.subscribe((event) => {
      void onGanCubeEvent(event);
    });

    setBluetoothStatus(`Connected: ${connection.deviceName}`);
    elements.disconnectBtn.disabled = false;
    currentCubeSolved = true;
    sawUnsolvedDuringRun = false;
    rememberConnectedCube(connection);
    await connection.sendCubeCommand({ type: "REQUEST_FACELETS" });
  } catch (error) {
    if (usePreferredDevice) {
      clearNativePreferredDevice();
    }
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

    await disconnectCube({ preserveStatus: true, forgetPreferred: false });
  } finally {
    if (nativeBluetoothActive) {
      clearNativePreferredDevice();
    }
    elements.connectBtn.disabled = false;
  }
}

async function disconnectCube(options = {}) {
  const { preserveStatus = false, forgetPreferred = false } = options;

  stopInspection({ resetDisplay: true });
  if (timerRunning) {
    stopTimer({ saveSolve: false, source: "manual" });
  }
  workflowPhase = WORKFLOW_PHASE.IDLE;

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
  if (forgetPreferred) {
    forgetLastCube();
    clearNativePreferredDevice();
  }

  elements.disconnectBtn.disabled = true;
  if (!preserveStatus) {
    setBluetoothStatus("Disconnected.");
  }
  setCubeSyncStatus("Cube disconnected.");
  renderWorkflow();
}

async function onGanCubeEvent(event) {
  if (!cubeConnection) {
    return;
  }

  if (event.type === "DISCONNECT") {
    await disconnectCube();
    return;
  }

  if (event.type === "MOVE") {
    handleAlgScrambleMove(event.move);
    scheduleFaceletPoll();
    return;
  }

  if (event.type !== "FACELETS") {
    return;
  }

  currentCubeSolved = isFaceletsSolved(event.facelets);
  currentFacelets = event.facelets;
  cubeRenderer?.updateFromFacelets(currentFacelets);
  setCubeSyncStatus(currentCubeSolved ? "Cube is solved." : "Cube state in sync.");

  if (workflowPhase === WORKFLOW_PHASE.SOLVING && timerRunning) {
    if (!currentCubeSolved) {
      sawUnsolvedDuringRun = true;
    }
    if (sawUnsolvedDuringRun && currentCubeSolved) {
      stopTimer({ saveSolve: true, source: "cube" });
      workflowPhase = WORKFLOW_PHASE.IDLE;
      setWorkflowStatus("Solve complete. Prepare next solve.");
      renderWorkflow();
    }
  }
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

async function prepareSolveCycle() {
  stopInspection({ resetDisplay: true });
  if (timerRunning) {
    stopTimer({ saveSolve: false, source: "manual" });
  }
  elapsedMs = 0;
  renderTimer();

  scrambleMode = readScrambleMode();
  inspectionSeconds = readInspectionSeconds();
  scrambleStep = 0;
  pendingDoubleMoveToken = null;
  pendingDoubleMoveDirection = null;
  scrambleOffTrackMove = null;
  sawUnsolvedDuringRun = false;
  const connected = Boolean(cubeConnection);

  if (scrambleMode === SCRAMBLE_MODE.FREE) {
    workflowPhase = WORKFLOW_PHASE.SCRAMBLING;
    scrambleMoves = [];
    updateScrambleProgressText();
    setWorkflowStatus("Scramble freely, then tap Start Inspection.");
    elements.startInspectionBtn.disabled = false;
  } else {
    workflowPhase = connected ? WORKFLOW_PHASE.SCRAMBLING : WORKFLOW_PHASE.READY_INSPECTION;
    scrambleMoves = generateScramble(SCRAMBLE_LENGTH);
    elements.startInspectionBtn.disabled = connected;
    updateScrambleProgressText();
    setWorkflowStatus(
      connected
        ? `Apply scramble. Next move: ${describeExpectedMove(scrambleMoves[0])}`
        : "Algorithm generated. Apply scramble manually, then tap Start Inspection.",
    );
  }

  if (connected) {
    await cubeConnection.sendCubeCommand({ type: "REQUEST_FACELETS" }).catch(() => undefined);
  }
  renderWorkflow();
}

function handleAlgScrambleMove(moveToken) {
  if (
    workflowPhase !== WORKFLOW_PHASE.SCRAMBLING ||
    scrambleMode !== SCRAMBLE_MODE.ALG ||
    !scrambleMoves.length
  ) {
    return;
  }

  const move = normalizeMoveToken(moveToken);
  if (!move) {
    return;
  }

  if (scrambleOffTrackMove) {
    const undoMove = inverseMoveToken(scrambleOffTrackMove);
    if (move === undoMove) {
      scrambleOffTrackMove = null;
      pendingDoubleMoveToken = null;
      pendingDoubleMoveDirection = null;
      const nextMove = describeExpectedMove(scrambleMoves[scrambleStep]);
      setWorkflowStatus(
        nextMove
          ? `Recovered. Continue with ${nextMove}.`
          : "Recovered. Scramble complete.",
      );
      updateScrambleProgressText();
    } else {
      setWorkflowStatus(`Off track. Undo with ${undoMove}.`);
    }
    return;
  }

  const expectedMove = scrambleMoves[scrambleStep];
  const expectedConsume = consumeExpectedMove(expectedMove, move);
  if (expectedConsume.handled && !expectedConsume.advanced) {
    pendingDoubleMoveToken = expectedConsume.pending;
    pendingDoubleMoveDirection = expectedConsume.pendingDirection;
    if (expectedConsume.hint) {
      setWorkflowStatus(expectedConsume.hint);
    }
    updateScrambleProgressText();
    return;
  }

  if (expectedConsume.advanced) {
    pendingDoubleMoveToken = null;
    pendingDoubleMoveDirection = null;
    scrambleStep += 1;
    if (scrambleStep >= scrambleMoves.length) {
      workflowPhase = WORKFLOW_PHASE.READY_INSPECTION;
      setWorkflowStatus("Scramble complete. Tap Start Inspection.");
      elements.startInspectionBtn.disabled = false;
    } else {
      setWorkflowStatus(`Good. Next move: ${describeExpectedMove(scrambleMoves[scrambleStep])}`);
    }
    updateScrambleProgressText();
    renderWorkflow();
    return;
  }

  pendingDoubleMoveToken = null;
  pendingDoubleMoveDirection = null;
  if (
    scrambleStep > 0 &&
    move === inverseMoveToken(scrambleMoves[scrambleStep - 1])
  ) {
    scrambleStep -= 1;
    pendingDoubleMoveToken = null;
    pendingDoubleMoveDirection = null;
    setWorkflowStatus(`Stepped back. Next move: ${describeExpectedMove(scrambleMoves[scrambleStep])}`);
    updateScrambleProgressText();
    return;
  }

  scrambleOffTrackMove = move;
  setWorkflowStatus(
    `Misstep. Expected ${describeExpectedMove(expectedMove)}. Undo with ${inverseMoveToken(move)}.`,
  );
}

function startInspection() {
  const canStart =
    workflowPhase === WORKFLOW_PHASE.READY_INSPECTION ||
    (workflowPhase === WORKFLOW_PHASE.SCRAMBLING &&
      scrambleMode === SCRAMBLE_MODE.FREE);
  if (!canStart) {
    return;
  }

  stopInspection({ resetDisplay: false });
  workflowPhase = WORKFLOW_PHASE.INSPECTION;
  inspectionEndPerfMs = performance.now() + inspectionSeconds * 1000;
  setWorkflowStatus(`Inspection started (${inspectionSeconds}s).`);
  elements.startInspectionBtn.disabled = true;
  renderWorkflow();
  tickInspection();
}

function tickInspection() {
  if (workflowPhase !== WORKFLOW_PHASE.INSPECTION) {
    return;
  }

  const remainingMs = inspectionEndPerfMs - performance.now();
  if (remainingMs <= 0) {
    stopInspection({ resetDisplay: false });
    elements.inspectionDisplay.textContent = "Inspection: GO!";
    beginSolveTimer();
    return;
  }

  elements.inspectionDisplay.textContent = `Inspection: ${formatInspectionTime(remainingMs)}`;
  inspectionFrameId = requestAnimationFrame(tickInspection);
}

function stopInspection({ resetDisplay }) {
  if (inspectionFrameId) {
    cancelAnimationFrame(inspectionFrameId);
    inspectionFrameId = null;
  }

  if (resetDisplay) {
    renderInspection();
  }
}

function beginSolveTimer() {
  if (timerRunning) {
    stopTimer({ saveSolve: false, source: "manual" });
  }

  workflowPhase = WORKFLOW_PHASE.SOLVING;
  elapsedMs = 0;
  renderTimer();
  sawUnsolvedDuringRun = !currentCubeSolved;
  startTimer();
  setWorkflowStatus("Solve timer running...");
  renderWorkflow();
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
  if (workflowPhase === WORKFLOW_PHASE.INSPECTION) {
    return;
  }

  if (timerRunning) {
    stopTimer({ saveSolve: true, source: "manual" });
    workflowPhase = WORKFLOW_PHASE.IDLE;
    setWorkflowStatus("Manual solve recorded.");
    renderWorkflow();
    return;
  }

  workflowPhase = WORKFLOW_PHASE.SOLVING;
  sawUnsolvedDuringRun = true;
  startTimer();
  setWorkflowStatus("Manual timer running.");
  renderWorkflow();
}

function resetTimer() {
  stopInspection({ resetDisplay: true });
  if (timerRunning) {
    stopTimer({ saveSolve: false, source: "manual" });
  }
  elapsedMs = 0;
  renderTimer();
  if (workflowPhase === WORKFLOW_PHASE.INSPECTION || workflowPhase === WORKFLOW_PHASE.SOLVING) {
    workflowPhase = WORKFLOW_PHASE.IDLE;
    setWorkflowStatus("Solve cycle reset.");
    renderWorkflow();
  }
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

function onWorkflowConfigChange() {
  scrambleMode = readScrambleMode();
  inspectionSeconds = readInspectionSeconds();
  if (workflowPhase === WORKFLOW_PHASE.IDLE) {
    renderWorkflow();
  }
}

function renderWorkflow() {
  switch (workflowPhase) {
    case WORKFLOW_PHASE.IDLE:
      elements.startInspectionBtn.disabled = true;
      if (scrambleMode === SCRAMBLE_MODE.ALG) {
        elements.scrambleDisplay.textContent = "Scramble: (generated on Prepare Solve)";
      } else {
        elements.scrambleDisplay.textContent = "Scramble: Free mode";
      }
      elements.scrambleProgress.textContent = `Inspection: ${inspectionSeconds}s`;
      if (!elements.workflowStatus.textContent.trim()) {
        setWorkflowStatus("No active solve cycle.");
      }
      break;
    case WORKFLOW_PHASE.SCRAMBLING:
      elements.startInspectionBtn.disabled = scrambleMode !== SCRAMBLE_MODE.FREE;
      break;
    case WORKFLOW_PHASE.READY_INSPECTION:
      elements.startInspectionBtn.disabled = false;
      break;
    case WORKFLOW_PHASE.INSPECTION:
    case WORKFLOW_PHASE.SOLVING:
      elements.startInspectionBtn.disabled = true;
      break;
    default:
      break;
  }
}

function switchScreen(screen) {
  activeScreen = screen === "records" || screen === "updates" ? screen : "solve";

  const solveActive = activeScreen === "solve";
  const recordsActive = activeScreen === "records";
  const updatesActive = activeScreen === "updates";
  elements.solveScreen.classList.toggle("active", solveActive);
  elements.recordsScreen.classList.toggle("active", recordsActive);
  elements.updatesScreen.classList.toggle("active", updatesActive);
  elements.navSolveBtn.classList.toggle("active", solveActive);
  elements.navRecordsBtn.classList.toggle("active", recordsActive);
  elements.navUpdatesBtn.classList.toggle("active", updatesActive);
  closeDrawer();
}

function onAutoConnectToggle() {
  updateAutoConnectPreference(elements.autoConnectCheckbox.checked);
  if (elements.autoConnectCheckbox.checked) {
    const lastCube = getLastCube();
    if (lastCube?.id) {
      setBluetoothStatus(`Auto-connect enabled for ${lastCube.name}.`);
      if (nativeBluetoothActive && !cubeConnection && !autoConnectInProgress) {
        void maybeAutoConnectLastCube();
      }
      return;
    }
    setBluetoothStatus("Auto-connect enabled. Connect a cube once to remember it.");
    return;
  }

  setBluetoothStatus("Auto-connect disabled.");
}

function forgetRememberedCubes() {
  knownCubes.length = 0;
  saveKnownCubes(knownCubes);
  forgetLastCube();
  clearNativePreferredDevice();
  renderRememberedCubesStatus();
  setBluetoothStatus("Forgot remembered cubes.");
}

function toggleDrawer() {
  const isOpen = elements.sideDrawer.classList.contains("open");
  if (isOpen) {
    closeDrawer();
    return;
  }

  elements.sideDrawer.classList.add("open");
  elements.drawerBackdrop.classList.remove("hidden");
}

function closeDrawer() {
  elements.sideDrawer.classList.remove("open");
  elements.drawerBackdrop.classList.add("hidden");
}

window.addEventListener("beforeunload", () => {
  cubeRenderer?.destroy();
});

function renderTimer() {
  elements.timerDisplay.textContent = formatTime(elapsedMs);
}

function renderInspection() {
  elements.inspectionDisplay.textContent = "Inspection: --";
}

function updateScrambleProgressText() {
  renderScrambleDisplay();

  if (!scrambleMoves.length) {
    elements.scrambleProgress.textContent = "Progress: free scramble";
    return;
  }

  if (scrambleStep >= scrambleMoves.length) {
    elements.scrambleProgress.textContent = `Progress: ${scrambleMoves.length} / ${scrambleMoves.length} (done)`;
    return;
  }

  elements.scrambleProgress.textContent = `Progress: ${scrambleStep} / ${scrambleMoves.length} (next ${describeExpectedMove(scrambleMoves[scrambleStep])})`;
}

function renderScrambleDisplay() {
  if (!scrambleMoves.length) {
    elements.scrambleDisplay.textContent = "Scramble: Free mode";
    return;
  }

  const label = document.createElement("span");
  label.textContent = "Scramble:";
  const sequence = document.createElement("span");
  sequence.className = "scramble-sequence";

  for (let index = 0; index < scrambleMoves.length; index += 1) {
    const chip = document.createElement("span");
    chip.className = "scramble-chip";

    if (index < scrambleStep) {
      chip.classList.add("done");
    } else if (index === scrambleStep) {
      chip.classList.add("active");
      if (pendingDoubleMoveToken === scrambleMoves[index]) {
        chip.classList.add("half");
      }
    }

    chip.textContent = scrambleMoves[index];
    sequence.append(chip);
  }

  elements.scrambleDisplay.replaceChildren(label, sequence);
}

function readScrambleMode() {
  return elements.scrambleModeSelect.value === SCRAMBLE_MODE.FREE
    ? SCRAMBLE_MODE.FREE
    : SCRAMBLE_MODE.ALG;
}

function readInspectionSeconds() {
  const parsed = Number.parseInt(elements.inspectionSecondsInput.value, 10);
  const safe = Number.isFinite(parsed) ? parsed : 15;
  const clamped = Math.min(MAX_INSPECTION_SECONDS, Math.max(0, safe));
  elements.inspectionSecondsInput.value = String(clamped);
  return clamped;
}

function formatInspectionTime(remainingMs) {
  const seconds = Math.max(0, remainingMs) / 1000;
  return `${seconds.toFixed(1)}s`;
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
  latestReleasePageUrl = null;
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
    latestReleasePageUrl =
      typeof latestRelease.html_url === "string" ? latestRelease.html_url : null;
    const remoteVersion = parseVersion(latestRelease.tag_name) ?? parseVersion(apkAsset.name);
    if (!remoteVersion) {
      if (isNativeRuntime() && latestReleasePageUrl) {
        setUpdateStatus(`Latest APK found: ${latestRelease.tag_name}. Open release page to download.`);
        elements.downloadUpdateBtn.textContent = "Open latest release page";
      } else {
        setUpdateStatus(`Latest APK found: ${latestRelease.tag_name}`);
      }
      elements.downloadUpdateBtn.disabled = false;
      return;
    }

    const comparison = compareSemver(remoteVersion, APP_VERSION);
    if (comparison > 0) {
      if (isNativeRuntime() && latestReleasePageUrl) {
        setUpdateStatus(
          `Update available: v${remoteVersion} (current v${APP_VERSION}). Open release page for reliable download. Android still requires install confirmation.`,
        );
        elements.downloadUpdateBtn.textContent = `Open v${remoteVersion} release`;
      } else {
        setUpdateStatus(`Update available: v${remoteVersion} (current v${APP_VERSION}).`);
        elements.downloadUpdateBtn.textContent = `Download v${remoteVersion}`;
      }
      elements.downloadUpdateBtn.disabled = false;
      return;
    }

    if (comparison === 0) {
      setUpdateStatus(`You are on the latest version (v${APP_VERSION}).`);
      if (userInitiated) {
        elements.downloadUpdateBtn.textContent =
          isNativeRuntime() && latestReleasePageUrl
            ? "Open current release page"
            : "Reinstall current APK";
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

  const useReleasePage = isNativeRuntime() && Boolean(latestReleasePageUrl);
  const targetUrl = useReleasePage ? latestReleasePageUrl : latestApkDownloadUrl;
  if (!targetUrl) {
    return;
  }

  const openedWindow = window.open(targetUrl, "_blank", "noopener");
  if (!openedWindow) {
    window.location.assign(targetUrl);
  }

  if (useReleasePage) {
    setUpdateStatus(
      "Opened release page. Tap APK to download; Android then requires install confirmation to update app code.",
    );
  }
}

async function resetCubeData() {
  if (!cubeConnection) {
    setCubeSyncStatus("Connect cube to reset its internal data.");
    return;
  }

  try {
    await cubeConnection.sendCubeCommand({ type: "REQUEST_RESET" });
    await cubeConnection.sendCubeCommand({ type: "REQUEST_FACELETS" });
    scrambleStep = 0;
    pendingDoubleMoveToken = null;
    pendingDoubleMoveDirection = null;
    scrambleOffTrackMove = null;
    if (scrambleMode === SCRAMBLE_MODE.ALG && scrambleMoves.length > 0) {
      updateScrambleProgressText();
      setWorkflowStatus("Cube reset done. Re-apply scramble from start.");
    } else {
      setWorkflowStatus("Cube reset done.");
    }
    setCubeSyncStatus("Cube state reset requested.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCubeSyncStatus(`Cube reset failed: ${message}`);
  }
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
  if (!Array.isArray(releases)) {
    return null;
  }
  const candidates = [];
  for (const release of releases) {
    if (release?.draft || !Array.isArray(release?.assets)) {
      continue;
    }
    const apkAsset = release.assets.find((asset) =>
      String(asset?.name ?? "").toLowerCase().endsWith(".apk"),
    );
    if (!apkAsset) {
      continue;
    }
    const version =
      parseVersion(release.tag_name) ??
      parseVersion(release.name) ??
      parseVersion(apkAsset.name);
    candidates.push({
      release,
      version,
      published: new Date(release.published_at ?? 0).getTime(),
    });
  }
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => {
    if (a.version && b.version) {
      const cmp = compareSemver(a.version, b.version);
      if (cmp !== 0) {
        return -cmp;
      }
    } else if (a.version) {
      return -1;
    } else if (b.version) {
      return 1;
    }
    return b.published - a.published;
  });
  return candidates[0].release;
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

function generateScramble(length) {
  const faces = ["U", "R", "F", "D", "L", "B"];
  const suffixes = ["", "'", "2"];
  const axisMap = {
    U: "UD",
    D: "UD",
    R: "RL",
    L: "RL",
    F: "FB",
    B: "FB",
  };
  const scramble = [];

  while (scramble.length < length) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    const previous = scramble[scramble.length - 1];
    const prevFace = previous ? previous[0] : null;
    const prevAxis = prevFace ? axisMap[prevFace] : null;

    if (face === prevFace) {
      continue;
    }
    if (
      scramble.length > 1 &&
      prevAxis &&
      axisMap[face] === prevAxis &&
      axisMap[scramble[scramble.length - 2][0]] === prevAxis
    ) {
      continue;
    }

    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    scramble.push(`${face}${suffix}`);
  }

  return scramble;
}

function normalizeMoveToken(moveToken) {
  const match = String(moveToken ?? "").trim().match(/^([URFDLB])(2|'|)?$/i);
  if (!match) {
    return null;
  }

  const face = match[1].toUpperCase();
  const suffix = match[2] ?? "";
  return `${face}${suffix}`;
}

function inverseMoveToken(move) {
  if (move.endsWith("2")) {
    return move;
  }
  if (move.endsWith("'")) {
    return move.slice(0, -1);
  }
  return `${move}'`;
}

function consumeExpectedMove(expectedMove, observedMove) {
  if (typeof expectedMove !== "string") {
    return { handled: false, advanced: false, pending: null, pendingDirection: null, hint: null };
  }

  if (observedMove === expectedMove) {
    return { handled: true, advanced: true, pending: null, pendingDirection: null, hint: null };
  }

  if (!expectedMove.endsWith("2")) {
    return { handled: false, advanced: false, pending: null, pendingDirection: null, hint: null };
  }

  const face = expectedMove[0];
  const quarterClockwise = face;
  const quarterCounterClockwise = `${face}'`;
  const isQuarterTurn =
    observedMove === quarterClockwise || observedMove === quarterCounterClockwise;

  if (!isQuarterTurn) {
    return { handled: false, advanced: false, pending: null, pendingDirection: null, hint: null };
  }

  if (pendingDoubleMoveToken === expectedMove) {
    if (observedMove === pendingDoubleMoveDirection) {
      return { handled: true, advanced: true, pending: null, pendingDirection: null, hint: null };
    }
    if (observedMove === inverseMoveToken(pendingDoubleMoveDirection ?? "")) {
      return {
        handled: true,
        advanced: false,
        pending: null,
        pendingDirection: null,
        hint: `Half turn canceled for ${expectedMove}. Do ${expectedMove} (${quarterClockwise} ${quarterClockwise} or ${quarterCounterClockwise} ${quarterCounterClockwise}).`,
      };
    }
    return { handled: false, advanced: false, pending: null, pendingDirection: null, hint: null };
  }

  return {
    handled: true,
    advanced: false,
    pending: expectedMove,
    pendingDirection: observedMove,
    hint: `Half turn detected for ${expectedMove}. Do one more ${observedMove}.`,
  };
}

function describeExpectedMove(move) {
  if (typeof move !== "string" || !move) {
    return "";
  }

  if (move.endsWith("2") && pendingDoubleMoveToken === move) {
    return `${move} (one more ${pendingDoubleMoveDirection ?? "quarter turn"})`;
  }

  if (move.endsWith("2")) {
    return `${move} (double turn)`;
  }

  return move;
}

function setUpdateStatus(message) {
  elements.updateStatus.textContent = message;
}

function setBluetoothStatus(message) {
  elements.connectionStatus.textContent = message;
}

function setWorkflowStatus(message) {
  elements.workflowStatus.textContent = message;
}

function setCubeSyncStatus(message) {
  elements.cubeSyncStatus.textContent = message;
}

function renderRememberedCubesStatus() {
  const lastCube = getLastCube();
  if (!knownCubes.length || !lastCube) {
    elements.rememberedCubesStatus.textContent = "Remembered cubes: none";
    return;
  }

  elements.rememberedCubesStatus.textContent = `Remembered cubes: ${knownCubes.length} • Last: ${lastCube.name}`;
}

function updateAutoConnectPreference(enabled) {
  window.localStorage.setItem(AUTO_CONNECT_LAST_CUBE_KEY, enabled ? "1" : "0");
}

function loadAutoConnectPreference() {
  return window.localStorage.getItem(AUTO_CONNECT_LAST_CUBE_KEY) !== "0";
}

function rememberConnectedCube(connection) {
  const name = String(connection?.deviceName ?? "").trim();
  const id = String(connection?.deviceMAC ?? "").trim().toUpperCase();
  if (!name || !id) {
    return;
  }

  const now = new Date().toISOString();
  const existing = knownCubes.findIndex((cube) => cube.id === id);
  if (existing >= 0) {
    knownCubes[existing] = {
      ...knownCubes[existing],
      name,
      lastSeenAt: now,
    };
  } else {
    knownCubes.push({
      id,
      name,
      lastSeenAt: now,
    });
  }
  saveKnownCubes(knownCubes);
  saveLastCube({
    id,
    name,
    lastSeenAt: now,
  });
  renderRememberedCubesStatus();
}

function getLastCube() {
  const raw = window.localStorage.getItem(LAST_CUBE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id !== "string" || !parsed.id.trim()) {
      return null;
    }
    return {
      id: parsed.id.trim().toUpperCase(),
      name: typeof parsed.name === "string" ? parsed.name : "Last cube",
      lastSeenAt:
        typeof parsed.lastSeenAt === "string"
          ? parsed.lastSeenAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function saveLastCube(cube) {
  window.localStorage.setItem(LAST_CUBE_KEY, JSON.stringify(cube));
}

function forgetLastCube() {
  window.localStorage.removeItem(LAST_CUBE_KEY);
}

function forgetKnownCubes() {
  window.localStorage.removeItem(KNOWN_CUBES_KEY);
}

async function maybeAutoConnectLastCube() {
  if (autoConnectAttempted || autoConnectInProgress) {
    return;
  }
  if (!nativeBluetoothActive) {
    return;
  }
  const lastCube = getLastCube();
  if (!lastCube?.id) {
    return;
  }

  autoConnectAttempted = true;
  autoConnectInProgress = true;
  try {
    await connectToCube({
      usePreferredDevice: true,
      suppressPickerOnFailure: true,
      userInitiated: false,
    });
  } finally {
    autoConnectInProgress = false;
  }
}

function isNativeRuntime() {
  const cap = window.Capacitor;
  if (!cap) {
    return false;
  }
  if (typeof cap.isNativePlatform === "function") {
    return cap.isNativePlatform();
  }
  const platform =
    typeof cap.getPlatform === "function" ? cap.getPlatform() : String(cap.platform ?? "");
  return platform === "android" || platform === "ios";
}

function loadKnownCubes() {
  const raw = window.localStorage.getItem(KNOWN_CUBES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => ({
        id: typeof entry?.id === "string" ? entry.id.trim().toUpperCase() : "",
        name:
          typeof entry?.name === "string" && entry.name.trim().length > 0
            ? entry.name.trim()
            : "GAN Cube",
        lastSeenAt:
          typeof entry?.lastSeenAt === "string"
            ? entry.lastSeenAt
            : new Date().toISOString(),
      }))
      .filter((entry) => Boolean(entry.id));
  } catch {
    return [];
  }
}

function saveKnownCubes(value) {
  window.localStorage.setItem(KNOWN_CUBES_KEY, JSON.stringify(value));
}
