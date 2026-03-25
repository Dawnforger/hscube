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
const ORIENTATION_SYNC_KEY = "hs-cube-orientation-sync-v1";
const ORIENTATION_CALIBRATION_KEY = "hs-cube-orientation-calibration-v1";
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const RELEASES_API_URL = "https://api.github.com/repos/Dawnforger/hscube/releases?per_page=20";
const FACELET_POLL_THROTTLE_MS = 180;
const SCRAMBLE_LENGTH = 20;
const MAX_INSPECTION_SECONDS = 30;
const CALIBRATION_FACE_SEQUENCE = ["U", "R", "F", "D", "L", "B"];
const CALIBRATION_SAMPLE_COUNT = 20;
const FACE_START_INDEX = {
  U: 0,
  R: 9,
  F: 18,
  D: 27,
  L: 36,
  B: 45,
};
const ORIENTATION_AXIS_REFERENCE = {
  U: { x: 0, y: 0, z: 1 },
  R: { x: 1, y: 0, z: 0 },
  F: { x: 0, y: 1, z: 0 },
  D: { x: 0, y: 0, z: -1 },
  L: { x: -1, y: 0, z: 0 },
  B: { x: 0, y: -1, z: 0 },
};
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
const CFOP_PHASES = ["Cross/F2L", "OLL", "PLL"];
const ROUX_PHASES = ["FB/SB", "CMLL", "LSE"];
const LBL_PHASES = ["First Layer", "Second Layer", "Last Layer"];
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

const elements = {
  menuToggleBtn: document.querySelector("#menu-toggle-btn"),
  sideDrawer: document.querySelector("#side-drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  navPairingBtn: document.querySelector("#nav-pairing-btn"),
  navSolveBtn: document.querySelector("#nav-solve-btn"),
  navRecordsBtn: document.querySelector("#nav-records-btn"),
  navCalibrationBtn: document.querySelector("#nav-calibration-btn"),
  navUpdatesBtn: document.querySelector("#nav-updates-btn"),
  pairingScreen: document.querySelector("#pairing-screen"),
  solveScreen: document.querySelector("#solve-screen"),
  recordsScreen: document.querySelector("#records-screen"),
  calibrationScreen: document.querySelector("#calibration-screen"),
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
  recordsMethodFilter: document.querySelector("#records-method-filter"),
  recordsSortSelect: document.querySelector("#records-sort-select"),
  exportSolvesJsonBtn: document.querySelector("#export-solves-json-btn"),
  exportSolvesCsvBtn: document.querySelector("#export-solves-csv-btn"),
  importSolvesBtn: document.querySelector("#import-solves-btn"),
  importSolvesInput: document.querySelector("#import-solves-input"),
  movesTimeChart: document.querySelector("#moves-time-chart"),
  tpsTrendChart: document.querySelector("#tps-trend-chart"),
  solveList: document.querySelector("#solve-list"),
  solveAnalysisModal: document.querySelector("#solve-analysis-modal"),
  analysisTitle: document.querySelector("#analysis-title"),
  analysisSummary: document.querySelector("#analysis-summary"),
  analysisDetails: document.querySelector("#analysis-details"),
  closeAnalysisBtn: document.querySelector("#close-analysis-btn"),
  clearSolvesBtn: document.querySelector("#clear-solves-btn"),
  appVersion: document.querySelector("#app-version"),
  updateStatus: document.querySelector("#update-status"),
  releaseNotesList: document.querySelector("#release-notes-list"),
  checkUpdateBtn: document.querySelector("#check-update-btn"),
  downloadUpdateBtn: document.querySelector("#download-update-btn"),
  autoConnectCheckbox: document.querySelector("#auto-connect-checkbox"),
  forgetCubesBtn: document.querySelector("#forget-cubes-btn"),
  rememberedCubesStatus: document.querySelector("#remembered-cubes-status"),
  orientationSyncCheckbox: document.querySelector("#orientation-sync-checkbox"),
  orientationSyncStatus: document.querySelector("#orientation-sync-status"),
  startOrientationCalibrationBtn: document.querySelector("#start-orientation-calibration-btn"),
  captureOrientationCalibrationBtn: document.querySelector("#capture-orientation-calibration-btn"),
  resetOrientationCalibrationBtn: document.querySelector("#reset-orientation-calibration-btn"),
  orientationCalibrationStatus: document.querySelector("#orientation-calibration-status"),
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
let orientationSyncEnabled = false;
let orientationSupportedByCube = null;
let receivedOrientationSample = false;
let latestGyroQuaternion = null;
let recentGyroSamples = [];
let orientationCalibrationCorrection = identityQuaternion();
let orientationCalibrationSession = null;

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
let activeSolveTrack = null;
let selectedSolveId = null;

const solves = loadSolves();
const knownCubes = loadKnownCubes();

elements.connectBtn.addEventListener("click", onConnectClick);
elements.disconnectBtn.addEventListener("click", () => {
  void disconnectCube();
});
elements.menuToggleBtn.addEventListener("click", toggleDrawer);
elements.drawerBackdrop.addEventListener("click", closeDrawer);
elements.navPairingBtn.addEventListener("click", () => switchScreen("pairing"));
elements.navSolveBtn.addEventListener("click", () => switchScreen("solve"));
elements.navRecordsBtn.addEventListener("click", () => switchScreen("records"));
elements.navCalibrationBtn.addEventListener("click", () => switchScreen("calibration"));
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
elements.recordsMethodFilter.addEventListener("change", renderSolves);
elements.recordsSortSelect.addEventListener("change", renderSolves);
elements.exportSolvesJsonBtn.addEventListener("click", exportSolvesJson);
elements.exportSolvesCsvBtn.addEventListener("click", exportSolvesCsv);
elements.importSolvesBtn.addEventListener("click", () => elements.importSolvesInput.click());
elements.importSolvesInput.addEventListener("change", onImportSolvesSelected);
elements.checkUpdateBtn.addEventListener("click", () => {
  void checkForUpdate({ userInitiated: true });
});
elements.downloadUpdateBtn.addEventListener("click", openLatestApk);
elements.autoConnectCheckbox.addEventListener("change", onAutoConnectToggle);
elements.forgetCubesBtn.addEventListener("click", forgetRememberedCubes);
elements.orientationSyncCheckbox.addEventListener("change", onOrientationSyncToggle);
elements.startOrientationCalibrationBtn.addEventListener("click", startOrientationCalibration);
elements.captureOrientationCalibrationBtn.addEventListener("click", captureOrientationCalibrationFace);
elements.resetOrientationCalibrationBtn.addEventListener("click", resetOrientationCalibration);
elements.closeAnalysisBtn.addEventListener("click", closeSolveAnalysis);

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
  orientationCalibrationCorrection = loadOrientationCalibrationCorrection();
  applyOrientationSyncPreference(loadOrientationSyncPreference(), { persist: false });
  setCubeSyncStatus("Waiting for cube state...");
  renderTimer();
  renderInspection();
  renderSolves();
  renderRememberedCubesStatus();
  renderWorkflow();
  updateOrientationCalibrationStatus();
  renderReleaseNotes([]);
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
    orientationSupportedByCube = null;
    receivedOrientationSample = false;
    latestGyroQuaternion = null;
    recentGyroSamples = [];
    orientationCalibrationSession = null;
    cubeRenderer?.resetOrientationSyncReference();
    rememberConnectedCube(connection);
    await connection.sendCubeCommand({ type: "REQUEST_FACELETS" });
    await connection.sendCubeCommand({ type: "REQUEST_HARDWARE" }).catch(() => undefined);
    updateOrientationSyncStatus();
    updateOrientationCalibrationStatus();
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
  orientationSupportedByCube = null;
  receivedOrientationSample = false;
  latestGyroQuaternion = null;
  recentGyroSamples = [];
  orientationCalibrationSession = null;
  cubeRenderer?.resetOrientationSyncReference();
  updateOrientationSyncStatus();
  updateOrientationCalibrationStatus();

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
    captureSolveMoveEvent(event.move, event.timestamp);
    scheduleFaceletPoll();
    return;
  }

  if (event.type === "HARDWARE") {
    onHardwareEvent(event);
    return;
  }

  if (event.type === "GYRO") {
    onGyroEvent(event);
    return;
  }

  if (event.type !== "FACELETS") {
    return;
  }

  currentCubeSolved = isFaceletsSolved(event.facelets);
  currentFacelets = event.facelets;
  cubeRenderer?.updateFromFacelets(currentFacelets);
  captureSolveFaceletsEvent(currentFacelets, event.timestamp);
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
  createSolveTrack("cube");
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
    const analysis = closeSolveTrack(source, elapsedMs);
    addSolve(elapsedMs, source, analysis);
  } else {
    activeSolveTrack = null;
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
  createSolveTrack("manual");
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
  activeScreen =
    screen === "pairing" ||
    screen === "records" ||
    screen === "updates" ||
    screen === "calibration"
      ? screen
      : "solve";

  const pairingActive = activeScreen === "pairing";
  const solveActive = activeScreen === "solve";
  const recordsActive = activeScreen === "records";
  const calibrationActive = activeScreen === "calibration";
  const updatesActive = activeScreen === "updates";
  elements.pairingScreen.classList.toggle("active", pairingActive);
  elements.solveScreen.classList.toggle("active", solveActive);
  elements.recordsScreen.classList.toggle("active", recordsActive);
  elements.calibrationScreen.classList.toggle("active", calibrationActive);
  elements.updatesScreen.classList.toggle("active", updatesActive);
  elements.navPairingBtn.classList.toggle("active", pairingActive);
  elements.navSolveBtn.classList.toggle("active", solveActive);
  elements.navRecordsBtn.classList.toggle("active", recordsActive);
  elements.navCalibrationBtn.classList.toggle("active", calibrationActive);
  elements.navUpdatesBtn.classList.toggle("active", updatesActive);
  if (!recordsActive) {
    closeSolveAnalysis();
  }
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

function onOrientationSyncToggle() {
  applyOrientationSyncPreference(elements.orientationSyncCheckbox.checked, {
    persist: true,
  });
}

function startOrientationCalibration() {
  if (!cubeConnection) {
    updateOrientationCalibrationStatus("Calibration requires a connected cube.");
    return;
  }
  if (orientationSupportedByCube === false) {
    updateOrientationCalibrationStatus("This cube does not expose orientation data.");
    return;
  }
  orientationCalibrationSession = {
    phase: "capturing",
    index: 0,
    samples: {},
  };
  updateOrientationCalibrationStatus();
}

function captureOrientationCalibrationFace() {
  if (!orientationCalibrationSession || orientationCalibrationSession.phase !== "capturing") {
    updateOrientationCalibrationStatus("Start calibration before capturing.");
    return;
  }
  const targetFace = CALIBRATION_FACE_SEQUENCE[orientationCalibrationSession.index];
  if (!targetFace) {
    updateOrientationCalibrationStatus("Calibration is already complete.");
    return;
  }
  const samples = sampleCurrentQuaternion(CALIBRATION_SAMPLE_COUNT);
  if (!samples.length) {
    updateOrientationCalibrationStatus("Waiting for stable gyro sample. Hold the cube still.");
    return;
  }
  const averaged = averageQuaternions(samples);
  if (!averaged) {
    updateOrientationCalibrationStatus("Calibration capture failed. Try again.");
    return;
  }
  orientationCalibrationSession.samples[targetFace] = averaged;
  orientationCalibrationSession.index += 1;
  if (orientationCalibrationSession.index >= CALIBRATION_FACE_SEQUENCE.length) {
    const correction = solveCalibrationCorrection(orientationCalibrationSession.samples);
    if (!correction) {
      updateOrientationCalibrationStatus("Calibration solve failed. Restart calibration.");
      return;
    }
    orientationCalibrationCorrection = correction;
    persistOrientationCalibrationCorrection(orientationCalibrationCorrection);
    orientationCalibrationSession = {
      phase: "complete",
      index: CALIBRATION_FACE_SEQUENCE.length,
      samples: orientationCalibrationSession.samples,
    };
    cubeRenderer?.resetOrientationSyncReference();
    updateOrientationCalibrationStatus("Calibration complete. Orientation sync now uses calibrated axes.");
    return;
  }
  updateOrientationCalibrationStatus();
}

function resetOrientationCalibration() {
  orientationCalibrationSession = null;
  orientationCalibrationCorrection = identityQuaternion();
  clearOrientationCalibrationCorrection();
  cubeRenderer?.resetOrientationSyncReference();
  updateOrientationCalibrationStatus("Calibration reset. Using default orientation mapping.");
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

function addSolve(timeMs, source, analysis) {
  const normalizedAnalysis = normalizeSolveAnalysis(analysis, timeMs);
  solves.push({
    id: crypto.randomUUID(),
    timeMs: Math.round(timeMs),
    source,
    methodDetected: normalizedAnalysis.method,
    analysis: normalizedAnalysis,
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
  closeSolveAnalysis();
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
    renderReleaseNotes(releases);

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
  renderRecordMethodOptions();

  const visibleSolves = getVisibleSolves();

  elements.solveList.replaceChildren();

  if (!visibleSolves.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = solves.length
      ? "No solves match current filters."
      : "No solves recorded yet.";
    elements.solveList.append(emptyItem);
    renderRecordsCharts([]);
    return;
  }

  for (const solve of visibleSolves) {
    const index = solves.findIndex((entry) => entry.id === solve.id) + 1;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "solve-record-button";
    button.type = "button";
    const method = String(solve.methodDetected ?? "Unknown");
    button.textContent = `#${index} - ${formatTime(solve.timeMs)} (${method})`;
    button.addEventListener("click", () => openSolveAnalysis(solve.id));
    item.append(button);
    elements.solveList.append(item);
  }

  renderRecordsCharts(visibleSolves);
}

function renderRecordMethodOptions() {
  const currentValue = elements.recordsMethodFilter.value || "all";
  const methods = new Set();
  for (const solve of solves) {
    const normalized = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
    methods.add(normalized.method || "Unknown");
  }

  const options = ["all", ...[...methods].sort((left, right) => left.localeCompare(right))];
  elements.recordsMethodFilter.replaceChildren();
  for (const method of options) {
    const option = document.createElement("option");
    option.value = method;
    option.textContent = method === "all" ? "All methods" : method;
    elements.recordsMethodFilter.append(option);
  }

  const safeValue = options.includes(currentValue) ? currentValue : "all";
  elements.recordsMethodFilter.value = safeValue;
}

function getVisibleSolves() {
  const methodFilter = elements.recordsMethodFilter.value || "all";
  const sortMode = elements.recordsSortSelect.value || "newest";
  const filtered = solves.filter((solve) => {
    if (methodFilter === "all") {
      return true;
    }
    const analysis = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
    return analysis.method === methodFilter;
  });

  const sorted = [...filtered];
  sorted.sort((left, right) => {
    const leftAnalysis = normalizeSolveAnalysis(left.analysis, left.timeMs);
    const rightAnalysis = normalizeSolveAnalysis(right.analysis, right.timeMs);
    switch (sortMode) {
      case "oldest":
        return getSolveTimestamp(left) - getSolveTimestamp(right);
      case "fastest":
        return left.timeMs - right.timeMs;
      case "slowest":
        return right.timeMs - left.timeMs;
      case "moves-low":
        return leftAnalysis.totalMoves - rightAnalysis.totalMoves;
      case "moves-high":
        return rightAnalysis.totalMoves - leftAnalysis.totalMoves;
      case "tps-low":
        return leftAnalysis.tps - rightAnalysis.tps;
      case "tps-high":
        return rightAnalysis.tps - leftAnalysis.tps;
      case "newest":
      default:
        return getSolveTimestamp(right) - getSolveTimestamp(left);
    }
  });
  return sorted;
}

function getSolveTimestamp(solve) {
  const timestamp = Date.parse(solve?.recordedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function exportSolvesJson() {
  const payload = {
    schema: "hs-cube-solves-export-v1",
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    solves,
  };
  triggerDownload(
    `hs-cube-solves-${makeTimestampTag()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

function exportSolvesCsv() {
  const rows = getVisibleSolves().map((solve) => {
    const analysis = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
    const phaseSummary = analysis.phases
      .map((phase) => `${phase.name}:${phase.moves}/${phase.timeMs}`)
      .join(" | ");
    return [
      solve.id,
      solve.recordedAt,
      solve.source,
      solve.timeMs,
      formatTime(solve.timeMs),
      analysis.method,
      analysis.totalMoves,
      analysis.tps.toFixed(3),
      phaseSummary,
    ];
  });
  const header = [
    "id",
    "recorded_at",
    "source",
    "time_ms",
    "time_display",
    "method",
    "total_moves",
    "tps",
    "phase_breakdown",
  ];
  const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
  triggerDownload(`hs-cube-solves-${makeTimestampTag()}.csv`, csv, "text/csv;charset=utf-8");
}

async function onImportSolvesSelected(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.solves)
        ? parsed.solves
        : null;
    if (!imported) {
      throw new Error("Import file must be a solves array or object with a solves array.");
    }

    const existingIds = new Set(solves.map((solve) => solve.id));
    let added = 0;
    let skipped = 0;

    for (const entry of imported) {
      if (!Number.isFinite(entry?.timeMs)) {
        skipped += 1;
        continue;
      }
      const timeMs = Math.max(0, Math.round(entry.timeMs));
      const analysis = normalizeSolveAnalysis(entry.analysis, timeMs);
      const preferredId =
        typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : crypto.randomUUID();
      const id = existingIds.has(preferredId) ? crypto.randomUUID() : preferredId;
      existingIds.add(id);

      solves.push({
        id,
        timeMs,
        source: entry?.source === "cube" ? "cube" : "manual",
        methodDetected:
          typeof entry?.methodDetected === "string" && entry.methodDetected.trim()
            ? entry.methodDetected.trim()
            : analysis.method,
        analysis,
        recordedAt:
          typeof entry?.recordedAt === "string" && entry.recordedAt.trim()
            ? entry.recordedAt
            : new Date().toISOString(),
      });
      added += 1;
    }

    solves.sort((left, right) => getSolveTimestamp(left) - getSolveTimestamp(right));
    saveSolves(solves);
    renderSolves();
    window.alert(`Import complete. Added ${added} solves, skipped ${skipped}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Import failed: ${message}`);
  } finally {
    input.value = "";
  }
}

function renderRecordsCharts(visibleSolves) {
  if (!elements.movesTimeChart || !elements.tpsTrendChart) {
    return;
  }
  const movesVsTime = visibleSolves.map((solve) => {
    const analysis = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
    return {
      x: solve.timeMs / 1000,
      y: analysis.totalMoves,
    };
  });
  drawLineChart(elements.movesTimeChart, movesVsTime, {
    title: "Moves vs Time",
    xLabel: "Time (s)",
    yLabel: "Moves",
    color: "#78a6ff",
  });

  const tpsTrend = visibleSolves.map((solve, index) => {
    const analysis = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
    return {
      x: index + 1,
      y: analysis.tps,
    };
  });
  drawLineChart(elements.tpsTrendChart, tpsTrend, {
    title: "TPS Trend",
    xLabel: "Solve #",
    yLabel: "TPS",
    color: "#80dbb2",
  });
}

function drawLineChart(svgElement, points, options) {
  svgElement.replaceChildren();
  const width = Number(svgElement.getAttribute("viewBox")?.split(" ")[2]) || 300;
  const height = Number(svgElement.getAttribute("viewBox")?.split(" ")[3]) || 140;
  const margin = { top: 18, right: 12, bottom: 24, left: 34 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);

  if (!Array.isArray(points) || points.length === 0) {
    const empty = createSvgNode("text", {
      x: width / 2,
      y: height / 2,
      "text-anchor": "middle",
      fill: "#9fb0cd",
      "font-size": "11",
    });
    empty.textContent = "No data for current filters";
    svgElement.append(empty);
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  minY = Math.min(0, minY);
  if (minX === maxX) {
    maxX += 1;
  }
  if (minY === maxY) {
    maxY += 1;
  }

  const projectX = (value) => margin.left + ((value - minX) / (maxX - minX)) * plotWidth;
  const projectY = (value) => margin.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;

  const xAxis = createSvgNode("line", {
    x1: margin.left,
    y1: margin.top + plotHeight,
    x2: margin.left + plotWidth,
    y2: margin.top + plotHeight,
    stroke: "#3a4b6b",
    "stroke-width": "1",
  });
  const yAxis = createSvgNode("line", {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: margin.top + plotHeight,
    stroke: "#3a4b6b",
    "stroke-width": "1",
  });
  svgElement.append(xAxis, yAxis);

  for (let tick = 1; tick <= 3; tick += 1) {
    const y = margin.top + (plotHeight * tick) / 4;
    svgElement.append(
      createSvgNode("line", {
        x1: margin.left,
        y1: y,
        x2: margin.left + plotWidth,
        y2: y,
        stroke: "#25324b",
        "stroke-width": "1",
      }),
    );
  }

  let pathData = "";
  points.forEach((point, index) => {
    const x = projectX(point.x);
    const y = projectY(point.y);
    pathData += `${index === 0 ? "M" : " L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const path = createSvgNode("path", {
    d: pathData,
    fill: "none",
    stroke: options.color ?? "#78a6ff",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svgElement.append(path);

  for (const point of points) {
    svgElement.append(
      createSvgNode("circle", {
        cx: projectX(point.x),
        cy: projectY(point.y),
        r: "2.2",
        fill: options.color ?? "#78a6ff",
      }),
    );
  }

  const title = createSvgNode("text", {
    x: margin.left,
    y: 12,
    fill: "#d6e3fc",
    "font-size": "10",
    "font-weight": "600",
  });
  title.textContent = options.title ?? "";
  svgElement.append(title);
}

function createSvgNode(name, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function renderReleaseNotes(releases) {
  if (!elements.releaseNotesList) {
    return;
  }
  elements.releaseNotesList.replaceChildren();
  const list = Array.isArray(releases)
    ? releases.filter((release) => !release?.draft).slice(0, 5)
    : [];
  if (!list.length) {
    const placeholder = document.createElement("li");
    placeholder.className = "meta-line";
    placeholder.textContent = "No release notes loaded yet.";
    elements.releaseNotesList.append(placeholder);
    return;
  }

  for (const release of list) {
    const item = document.createElement("li");
    const tag = String(release?.tag_name ?? release?.name ?? "Untitled release");
    const dateMs = Date.parse(String(release?.published_at ?? ""));
    const date = Number.isFinite(dateMs) ? new Date(dateMs).toLocaleDateString() : "Unknown date";
    const summary = summarizeReleaseBody(release?.body);
    const url = typeof release?.html_url === "string" ? release.html_url : null;
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${tag} (${date})`;
      item.append(link);
    } else {
      const label = document.createElement("strong");
      label.textContent = `${tag} (${date})`;
      item.append(label);
    }
    const note = document.createElement("div");
    note.className = "meta-line";
    note.textContent = summary;
    item.append(note);
    elements.releaseNotesList.append(item);
  }
}

function summarizeReleaseBody(body) {
  if (typeof body !== "string" || !body.trim()) {
    return "No notes provided.";
  }
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*#\d.)\s]+/, ""))
    .filter(Boolean)
    .slice(0, 2);
  const summary = lines.join(" • ");
  if (!summary) {
    return "No notes provided.";
  }
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function makeTimestampTag() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
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
        methodDetected:
          typeof entry.methodDetected === "string" && entry.methodDetected.trim()
            ? entry.methodDetected.trim()
            : "Unknown",
        analysis: normalizeSolveAnalysis(entry.analysis, entry.timeMs),
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

function openSolveAnalysis(solveId) {
  const solve = solves.find((entry) => entry.id === solveId);
  if (!solve) {
    return;
  }
  selectedSolveId = solve.id;
  renderSolveAnalysis(solve);
  elements.solveAnalysisModal.classList.remove("hidden");
}

function closeSolveAnalysis() {
  selectedSolveId = null;
  elements.solveAnalysisModal.classList.add("hidden");
}

function renderSolveAnalysis(solve) {
  const analysis = normalizeSolveAnalysis(solve.analysis, solve.timeMs);
  elements.analysisTitle.textContent = `Solve ${formatTime(solve.timeMs)}`;
  elements.analysisSummary.textContent = [
    `Method: ${analysis.method}`,
    `Moves: ${analysis.totalMoves}`,
    `TPS: ${analysis.tps.toFixed(2)}`,
    `Time: ${formatTime(solve.timeMs)}`,
  ].join(" • ");

  const details = document.createElement("div");
  details.className = "analysis-grid";

  const phasesHeader = document.createElement("h3");
  phasesHeader.textContent = "Phase Breakdown";
  details.append(phasesHeader);

  const phaseList = document.createElement("ul");
  phaseList.className = "analysis-phase-list";
  for (const phase of analysis.phases) {
    const li = document.createElement("li");
    li.textContent = `${phase.name}: ${formatTime(phase.timeMs)} • ${phase.moves} moves`;
    phaseList.append(li);
  }
  details.append(phaseList);

  const distributionHeader = document.createElement("h3");
  distributionHeader.textContent = "Move Distribution by Phase";
  details.append(distributionHeader);
  const distributionList = document.createElement("ul");
  distributionList.className = "analysis-phase-list";
  for (const phase of analysis.phases) {
    const ratio = analysis.totalMoves > 0 ? (phase.moves / analysis.totalMoves) * 100 : 0;
    const li = document.createElement("li");
    li.textContent = `${phase.name}: ${phase.moves} moves (${ratio.toFixed(1)}%)`;
    distributionList.append(li);
  }
  details.append(distributionList);

  elements.analysisDetails.replaceChildren(details);
}

function createSolveTrack(source) {
  activeSolveTrack = {
    source,
    startedAtPerf: performance.now(),
    startedAtIso: new Date().toISOString(),
    moves: [],
    faceletTimeline: [],
    lastPhase: "cross_f2l",
  };
}

function closeSolveTrack(source, totalTimeMs) {
  const track = activeSolveTrack;
  activeSolveTrack = null;
  if (!track || track.source !== source) {
    return buildFallbackAnalysis(source, totalTimeMs);
  }

  const moveEntries = track.moves;
  const totalMoves = moveEntries.length;

  const method = detectSolveMethod(moveEntries, totalTimeMs);
  const phases = buildPhaseStats(moveEntries, track.faceletTimeline, totalTimeMs, method);
  return normalizeSolveAnalysis(
    {
      method,
      totalMoves,
      tps: totalTimeMs > 0 ? totalMoves / (totalTimeMs / 1000) : 0,
      phases,
    },
    totalTimeMs,
  );
}

function captureSolveMoveEvent(moveToken, timestampMs) {
  if (!timerRunning || !activeSolveTrack) {
    return;
  }
  const move = normalizeMoveToken(moveToken) ?? String(moveToken ?? "").trim();
  if (!move) {
    return;
  }
  const offsetMs = Math.max(
    0,
    Number.isFinite(timestampMs) ? timestampMs - timerStartPerfMs : performance.now() - timerStartPerfMs,
  );
  activeSolveTrack.moves.push({
    move,
    offsetMs,
  });
}

function captureSolveFaceletsEvent(facelets, timestampMs) {
  if (!timerRunning || !activeSolveTrack) {
    return;
  }
  const offsetMs = Math.max(
    0,
    Number.isFinite(timestampMs) ? timestampMs - timerStartPerfMs : performance.now() - timerStartPerfMs,
  );
  const phase = inferPhaseFromFacelets(facelets);
  if (!phase) {
    return;
  }
  const last = activeSolveTrack.faceletTimeline[activeSolveTrack.faceletTimeline.length - 1];
  if (last && last.phase === phase && offsetMs - last.offsetMs < 120) {
    return;
  }
  activeSolveTrack.faceletTimeline.push({ offsetMs, phase });
}

function inferPhaseFromFacelets(facelets) {
  if (isFaceletsSolved(facelets)) {
    return "solved";
  }
  if (typeof facelets !== "string" || facelets.length < 54) {
    return null;
  }

  const solvedRef = SOLVED_FACELETS;
  const dFaceStart = 27;
  let dSolved = 0;
  for (let i = 0; i < 9; i += 1) {
    if (facelets[dFaceStart + i] === solvedRef[dFaceStart + i]) {
      dSolved += 1;
    }
  }

  const sideFaces = [9, 18, 36, 45];
  let f2lSolved = 0;
  let f2lTotal = 24;
  for (const start of sideFaces) {
    for (const idx of [3, 4, 5, 6, 7, 8]) {
      if (facelets[start + idx] === solvedRef[start + idx]) {
        f2lSolved += 1;
      }
    }
  }
  const f2lRatio = f2lTotal > 0 ? f2lSolved / f2lTotal : 0;
  const uSolved = facelets.slice(0, 9).split("").every((char) => char === "U");

  if (dSolved < 7 || f2lRatio < 0.45) {
    return "cross_f2l";
  }
  if (!uSolved) {
    return "oll";
  }
  return "pll";
}

function detectSolveMethod(moveEntries, totalTimeMs) {
  const totalMoves = moveEntries.length;
  if (!totalMoves) {
    return "Unknown";
  }
  if (totalMoves < 8) {
    return "Unknown (insufficient data)";
  }
  const counts = {
    U: 0,
    R: 0,
    F: 0,
    D: 0,
    L: 0,
    B: 0,
    M: 0,
    E: 0,
    S: 0,
    u: 0,
    r: 0,
    f: 0,
    d: 0,
    l: 0,
    b: 0,
    x: 0,
    y: 0,
    z: 0,
  };
  for (const { move } of moveEntries) {
    const token = String(move ?? "").trim();
    const face = token[0];
    if (face in counts) {
      counts[face] += 1;
    }
  }
  const mRatio = counts.M / totalMoves;
  const sliceRatio = (counts.M + counts.E + counts.S) / totalMoves;
  const wideRatio = (counts.u + counts.r + counts.f + counts.d + counts.l + counts.b) / totalMoves;
  const fbRatio = (counts.F + counts.B + counts.f + counts.b) / totalMoves;
  const dRatio = (counts.D + counts.d) / totalMoves;
  const rotationRatio = (counts.x + counts.y + counts.z) / totalMoves;
  const doubleRatio =
    moveEntries.reduce(
      (accumulator, entry) => accumulator + (String(entry.move ?? "").includes("2") ? 1 : 0),
      0,
    ) / totalMoves;
  const tps = totalTimeMs > 0 ? totalMoves / (totalTimeMs / 1000) : 0;

  if (mRatio >= 0.14 || (sliceRatio >= 0.2 && dRatio < 0.12 && fbRatio < 0.22)) {
    return "Roux (heuristic)";
  }
  if (dRatio >= 0.16 && mRatio < 0.08 && tps < 3.5) {
    return "Minh Thai / Layer-by-layer (heuristic)";
  }
  if (wideRatio > 0.18 && rotationRatio > 0.06 && doubleRatio > 0.2) {
    return "CFOP (heuristic)";
  }
  return "CFOP (heuristic)";
}

function buildPhaseStats(moveEntries, faceletTimeline, totalTimeMs, method) {
  const phaseOrder =
    method.startsWith("Roux") ? ROUX_PHASES : method.startsWith("Minh Thai") ? LBL_PHASES : CFOP_PHASES;
  const phaseBuckets = phaseOrder.map((name) => ({ name, moves: 0, timeMs: 0 }));
  const safeTotal = Math.max(0, Math.round(totalTimeMs));
  let splitA = Math.floor(safeTotal * 0.65);
  let splitB = Math.floor(safeTotal * 0.85);
  if (method.startsWith("Roux")) {
    splitA = Math.floor(safeTotal * 0.58);
    splitB = Math.floor(safeTotal * 0.84);
  } else if (method.startsWith("Minh Thai")) {
    splitA = Math.floor(safeTotal * 0.68);
    splitB = Math.floor(safeTotal * 0.9);
  }

  if (Array.isArray(faceletTimeline) && faceletTimeline.length > 1) {
    const firstOll = faceletTimeline.find((entry) => entry.phase === "oll");
    const firstPll = faceletTimeline.find(
      (entry) => entry.phase === "pll" || entry.phase === "solved",
    );
    if (
      Number.isFinite(firstOll?.offsetMs) &&
      Number.isFinite(firstPll?.offsetMs) &&
      firstPll.offsetMs > firstOll.offsetMs
    ) {
      splitA = Math.max(0, Math.min(safeTotal, Math.round(firstOll.offsetMs)));
      splitB = Math.max(splitA, Math.min(safeTotal, Math.round(firstPll.offsetMs)));
    }
  }

  const boundaries = [0, splitA, splitB, safeTotal];
  const toBucketByTime = (offsetMs) => {
    if (offsetMs < boundaries[1]) {
      return 0;
    }
    if (offsetMs < boundaries[2]) {
      return 1;
    }
    return 2;
  };
  const toBucketByFaceletPhase = (phase) => {
    if (phase === "oll") {
      return 1;
    }
    if (phase === "pll" || phase === "solved") {
      return 2;
    }
    return 0;
  };

  const timeline = Array.isArray(faceletTimeline)
    ? [...faceletTimeline].sort((left, right) => left.offsetMs - right.offsetMs)
    : [];
  let timelineIndex = 0;
  for (const move of moveEntries) {
    let bucket = toBucketByTime(move.offsetMs);
    while (
      timelineIndex + 1 < timeline.length &&
      Number(timeline[timelineIndex + 1]?.offsetMs) <= Number(move.offsetMs)
    ) {
      timelineIndex += 1;
    }
    const phase = timeline[timelineIndex]?.phase;
    if (phase) {
      bucket = toBucketByFaceletPhase(phase);
    }
    phaseBuckets[Math.max(0, Math.min(phaseBuckets.length - 1, bucket))].moves += 1;
  }

  phaseBuckets[0].timeMs = Math.max(0, boundaries[1] - boundaries[0]);
  phaseBuckets[1].timeMs = Math.max(0, boundaries[2] - boundaries[1]);
  phaseBuckets[2].timeMs = Math.max(0, boundaries[3] - boundaries[2]);
  return phaseBuckets;
}

function buildFallbackAnalysis(source, totalTimeMs) {
  return normalizeSolveAnalysis(
    {
      method: source === "manual" ? "Manual / Unknown" : "Unknown",
      totalMoves: 0,
      tps: 0,
      phases: CFOP_PHASES.map((name, index) => ({
        name,
        moves: 0,
        timeMs: index === 0 ? totalTimeMs : 0,
      })),
    },
    totalTimeMs,
  );
}

function normalizeSolveAnalysis(analysis, totalTimeMs) {
  const safeTotal = Math.max(0, Math.round(totalTimeMs ?? 0));
  const method = typeof analysis?.method === "string" && analysis.method.trim()
    ? analysis.method.trim()
    : "Unknown";
  const totalMoves = Number.isFinite(analysis?.totalMoves) ? Math.max(0, Math.round(analysis.totalMoves)) : 0;
  const tps =
    Number.isFinite(analysis?.tps) && analysis.tps >= 0
      ? Number(analysis.tps)
      : safeTotal > 0
        ? totalMoves / (safeTotal / 1000)
        : 0;

  const defaultPhases = CFOP_PHASES.map((name, index) => ({
    name,
    moves: 0,
    timeMs: index === 0 ? safeTotal : 0,
  }));
  const phases = Array.isArray(analysis?.phases) && analysis.phases.length
    ? analysis.phases.map((phase) => ({
        name: typeof phase?.name === "string" && phase.name.trim() ? phase.name.trim() : "Phase",
        moves: Number.isFinite(phase?.moves) ? Math.max(0, Math.round(phase.moves)) : 0,
        timeMs: Number.isFinite(phase?.timeMs) ? Math.max(0, Math.round(phase.timeMs)) : 0,
      }))
    : defaultPhases;

  return {
    method,
    totalMoves,
    tps,
    phases,
  };
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

function onHardwareEvent(event) {
  if (typeof event?.gyroSupported === "boolean") {
    // Keep explicit "true" from hardware info, but do not hard-lock to false:
    // some models report false while still sending gyro events.
    if (event.gyroSupported || orientationSupportedByCube === null) {
      orientationSupportedByCube = event.gyroSupported;
    }
  } else if (orientationSupportedByCube === null) {
    orientationSupportedByCube = true;
  }
  updateOrientationSyncStatus();
  updateOrientationCalibrationStatus();
}

function onGyroEvent(event) {
  latestGyroQuaternion = normalizeQuaternion(event?.quaternion);
  if (!latestGyroQuaternion) {
    return;
  }
  if (orientationSupportedByCube !== true) {
    orientationSupportedByCube = true;
    updateOrientationSyncStatus();
    updateOrientationCalibrationStatus();
  }
  recentGyroSamples.push(latestGyroQuaternion);
  if (recentGyroSamples.length > 240) {
    recentGyroSamples.splice(0, recentGyroSamples.length - 240);
  }
  if (!orientationSyncEnabled) {
    return;
  }
  const corrected = applyCalibrationToQuaternion(latestGyroQuaternion);
  const applied = cubeRenderer?.syncOrientationToQuaternion(corrected);
  if (applied) {
    receivedOrientationSample = true;
    updateOrientationSyncStatus();
  }
}

function applyOrientationSyncPreference(enabled, options = {}) {
  const { persist = true } = options;
  orientationSyncEnabled = Boolean(enabled);
  receivedOrientationSample = false;
  cubeRenderer?.setOrientationSyncEnabled(orientationSyncEnabled);
  elements.orientationSyncCheckbox.checked = orientationSyncEnabled;
  if (persist) {
    persistOrientationSyncPreference(orientationSyncEnabled);
  }
  updateOrientationSyncStatus();
}

function updateOrientationSyncStatus() {
  if (!orientationSyncEnabled) {
    elements.orientationSyncStatus.textContent = "Orientation sync: off";
    return;
  }
  if (!cubeConnection) {
    elements.orientationSyncStatus.textContent =
      "Orientation sync: waiting for cube connection";
    return;
  }
  if (orientationSupportedByCube === false) {
    elements.orientationSyncStatus.textContent =
      "Orientation sync: this cube does not report orientation";
    return;
  }
  if (!receivedOrientationSample) {
    elements.orientationSyncStatus.textContent =
      "Orientation sync: waiting for accelerometer data";
    return;
  }
  elements.orientationSyncStatus.textContent = "Orientation sync: active";
}

function updateOrientationCalibrationStatus(messageOverride = null) {
  if (messageOverride) {
    elements.orientationCalibrationStatus.textContent = messageOverride;
    renderCalibrationButtons();
    return;
  }
  if (!cubeConnection) {
    elements.orientationCalibrationStatus.textContent =
      "Calibration: connect cube, then place each face up in sequence U, R, F, D, L, B.";
    renderCalibrationButtons();
    return;
  }
  if (orientationSupportedByCube === false) {
    elements.orientationCalibrationStatus.textContent =
      "Calibration unavailable: cube does not report orientation data.";
    renderCalibrationButtons();
    return;
  }
  if (orientationCalibrationSession?.phase === "capturing") {
    const face = CALIBRATION_FACE_SEQUENCE[orientationCalibrationSession.index] ?? "";
    elements.orientationCalibrationStatus.textContent =
      `Calibration step ${orientationCalibrationSession.index + 1}/${CALIBRATION_FACE_SEQUENCE.length}: place ${face} face up, keep still, then tap Capture.`;
    renderCalibrationButtons();
    return;
  }
  if (hasNonIdentityCalibration()) {
    elements.orientationCalibrationStatus.textContent =
      "Calibration saved. Orientation sync uses calibrated correction.";
    renderCalibrationButtons();
    return;
  }
  elements.orientationCalibrationStatus.textContent =
    "No calibration saved. Default orientation mapping is active.";
  renderCalibrationButtons();
}

function renderCalibrationButtons() {
  const capturing = orientationCalibrationSession?.phase === "capturing";
  const canCalibrate = Boolean(cubeConnection) && orientationSupportedByCube !== false;
  elements.startOrientationCalibrationBtn.disabled = !canCalibrate || capturing;
  elements.captureOrientationCalibrationBtn.disabled = !canCalibrate || !capturing;
  elements.resetOrientationCalibrationBtn.disabled = !hasNonIdentityCalibration() && !capturing;
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

function persistOrientationSyncPreference(enabled) {
  window.localStorage.setItem(ORIENTATION_SYNC_KEY, enabled ? "1" : "0");
}

function loadOrientationSyncPreference() {
  return window.localStorage.getItem(ORIENTATION_SYNC_KEY) === "1";
}

function persistOrientationCalibrationCorrection(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) {
    return;
  }
  window.localStorage.setItem(ORIENTATION_CALIBRATION_KEY, JSON.stringify(normalized));
}

function clearOrientationCalibrationCorrection() {
  window.localStorage.removeItem(ORIENTATION_CALIBRATION_KEY);
}

function loadOrientationCalibrationCorrection() {
  const raw = window.localStorage.getItem(ORIENTATION_CALIBRATION_KEY);
  if (!raw) {
    return identityQuaternion();
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeQuaternion(parsed) ?? identityQuaternion();
  } catch {
    return identityQuaternion();
  }
}

function hasNonIdentityCalibration() {
  return !quaternionApproxEquals(orientationCalibrationCorrection, identityQuaternion(), 0.0015);
}

function sampleCurrentQuaternion(count) {
  if (recentGyroSamples.length < count) {
    return [];
  }
  return recentGyroSamples.slice(-count);
}

function invertQuaternion(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) {
    return identityQuaternion();
  }
  return {
    x: -normalized.x,
    y: -normalized.y,
    z: -normalized.z,
    w: normalized.w,
  };
}

function averageQuaternions(samples) {
  if (!Array.isArray(samples) || !samples.length) {
    return null;
  }
  const first = normalizeQuaternion(samples[0]);
  if (!first) {
    return null;
  }
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sw = 0;
  for (const sample of samples) {
    const q = normalizeQuaternion(sample);
    if (!q) {
      continue;
    }
    const dot = first.x * q.x + first.y * q.y + first.z * q.z + first.w * q.w;
    const sign = dot < 0 ? -1 : 1;
    sx += q.x * sign;
    sy += q.y * sign;
    sz += q.z * sign;
    sw += q.w * sign;
  }
  return normalizeQuaternion({
    x: sx,
    y: sy,
    z: sz,
    w: sw,
  });
}

function solveCalibrationCorrection(samplesByFace) {
  const worldUp = { x: 0, y: 0, z: 1 };
  const correctionCandidates = [];
  const orientationChecks = [];
  for (const face of CALIBRATION_FACE_SEQUENCE) {
    const sample = normalizeQuaternion(samplesByFace[face]);
    if (!sample) {
      return null;
    }
    const faceAxis = ORIENTATION_AXIS_REFERENCE[face];
    const observedFaceUp = rotateVectorByQuaternion(faceAxis, sample);
    const correctionForFace = computeQuaternionFromVectors(observedFaceUp, worldUp);
    if (!correctionForFace) {
      return null;
    }
    correctionCandidates.push(correctionForFace);

    const observedWorldAxis = rotateVectorByQuaternion(worldUp, sample);
    if (!observedWorldAxis) {
      return null;
    }
    orientationChecks.push({ sample, faceAxis, observedWorldAxis });
  }
  const correction = averageQuaternions(correctionCandidates);
  if (!correction) {
    return null;
  }

  // Validate using both calibration constraints:
  // 1) selected face maps to world up after correction
  // 2) world-up expressed in cube coordinates maps to the expected face axis
  for (const check of orientationChecks) {
    const alignedFaceUp = rotateVectorByQuaternion(check.observedFaceUp, correction);
    if (!alignedFaceUp || dotVector3(alignedFaceUp, worldUp) < 0.92) {
      return null;
    }
    const correctedSample = multiplyQuaternions(correction, check.sample);
    const reconstructedAxis = rotateVectorByQuaternion(worldUp, correctedSample);
    if (!reconstructedAxis || dotVector3(reconstructedAxis, check.faceAxis) < 0.92) {
      return null;
    }
  }

  return correction;
}

function applyCalibrationToQuaternion(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) {
    return null;
  }
  return multiplyQuaternions(orientationCalibrationCorrection, normalized);
}

function identityQuaternion() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function quaternionApproxEquals(a, b, epsilon = 0.001) {
  const qa = normalizeQuaternion(a);
  const qb = normalizeQuaternion(b);
  if (!qa || !qb) {
    return false;
  }
  const dot = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
  return Math.abs(1 - dot) <= epsilon;
}

function normalizeQuaternion(quaternion) {
  if (!quaternion || typeof quaternion !== "object") {
    return null;
  }
  const x = Number(quaternion.x);
  const y = Number(quaternion.y);
  const z = Number(quaternion.z);
  const w = Number(quaternion.w);
  if (![x, y, z, w].every((value) => Number.isFinite(value))) {
    return null;
  }
  const magnitude = Math.hypot(x, y, z, w);
  if (magnitude < 1e-8) {
    return null;
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
    w: w / magnitude,
  };
}

function multiplyQuaternions(left, right) {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  if (!a || !b) {
    return identityQuaternion();
  }
  return normalizeQuaternion({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
}

function rotateVectorByQuaternion(vector, quaternion) {
  const q = normalizeQuaternion(quaternion);
  if (!q) {
    return null;
  }
  const p = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
  const qInv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const rotated = multiplyQuaternions(multiplyQuaternions(q, p), qInv);
  return normalizeVector3(rotated);
}

function normalizeVector3(vector) {
  if (!vector) {
    return null;
  }
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  if (![x, y, z].every((value) => Number.isFinite(value))) {
    return null;
  }
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 1e-8) {
    return null;
  }
  return { x: x / magnitude, y: y / magnitude, z: z / magnitude };
}

function crossVector3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotVector3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function computeQuaternionFromVectors(fromVector, toVector) {
  const from = normalizeVector3(fromVector);
  const to = normalizeVector3(toVector);
  if (!from || !to) {
    return null;
  }
  const dot = dotVector3(from, to);
  if (dot > 0.999999) {
    return identityQuaternion();
  }
  if (dot < -0.999999) {
    // Vectors are opposite; pick an orthogonal axis.
    const referenceAxis =
      Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalizeVector3(crossVector3(from, referenceAxis));
    if (!axis) {
      return null;
    }
    return normalizeQuaternion({
      x: axis.x,
      y: axis.y,
      z: axis.z,
      w: 0,
    });
  }
  const axis = crossVector3(from, to);
  return normalizeQuaternion({
    x: axis.x,
    y: axis.y,
    z: axis.z,
    w: 1 + dot,
  });
}

function orthonormalBasis(xAxis, yHint) {
  const x = normalizeVector3(xAxis);
  if (!x) {
    return null;
  }
  const yProjected = {
    x: yHint.x - dotVector3(yHint, x) * x.x,
    y: yHint.y - dotVector3(yHint, x) * x.y,
    z: yHint.z - dotVector3(yHint, x) * x.z,
  };
  const y = normalizeVector3(yProjected);
  if (!y) {
    return null;
  }
  const z = normalizeVector3(crossVector3(x, y));
  if (!z) {
    return null;
  }
  return { x, y, z };
}

function matrixFromBasis(basis) {
  return [
    [basis.x.x, basis.y.x, basis.z.x],
    [basis.x.y, basis.y.y, basis.z.y],
    [basis.x.z, basis.y.z, basis.z.z],
  ];
}

function transposeMatrix3(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function multiplyMatrix3(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row][col] =
        a[row][0] * b[0][col] +
        a[row][1] * b[1][col] +
        a[row][2] * b[2][col];
    }
  }
  return out;
}

function quaternionFromRotationMatrix(matrix) {
  const m00 = matrix[0][0];
  const m01 = matrix[0][1];
  const m02 = matrix[0][2];
  const m10 = matrix[1][0];
  const m11 = matrix[1][1];
  const m12 = matrix[1][2];
  const m20 = matrix[2][0];
  const m21 = matrix[2][1];
  const m22 = matrix[2][2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return {
      w: 0.25 * s,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s,
    };
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return {
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
    };
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return {
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s,
    };
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return {
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: 0.25 * s,
  };
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
