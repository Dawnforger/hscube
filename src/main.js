import { connectSmartPuzzle } from "cubing/bluetooth";
import { installNativeBluetoothShimIfNeeded } from "./nativeBluetooth";

const STORAGE_KEY = "gan-smartcube-lite-solves-v1";
const SOLVED_CHECK_OPTIONS = {
  ignorePuzzleOrientation: true,
  ignoreCenterOrientation: true,
};

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
};

let puzzle = null;
let listeningPuzzle = null;
let timerRunning = false;
let timerStartPerfMs = 0;
let elapsedMs = 0;
let frameId = null;
let wasCubeSolved = true;
let sawUnsolvedDuringRun = false;
let nativeBluetoothActive = false;

const solves = loadSolves();

elements.connectBtn.addEventListener("click", onConnectClick);
elements.disconnectBtn.addEventListener("click", disconnectCube);
elements.manualToggleBtn.addEventListener("click", () => toggleManualTimer());
elements.resetBtn.addEventListener("click", resetTimer);
elements.clearSolvesBtn.addEventListener("click", clearSolves);
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
    setBluetoothStatus("Native BLE ready. Tap Connect Cube.");
  }

  elements.connectBtn.disabled = false;
}

async function onConnectClick() {
  if (!("bluetooth" in navigator)) {
    return;
  }

  elements.connectBtn.disabled = true;
  setBluetoothStatus(
    nativeBluetoothActive
      ? "Opening native Bluetooth picker..."
      : "Opening Bluetooth device picker...",
  );

  try {
    const connectedPuzzle = await connectSmartPuzzle(
      nativeBluetoothActive ? { acceptAllDevices: true } : undefined,
    );
    puzzle = connectedPuzzle;
    listeningPuzzle = connectedPuzzle;

    const name = connectedPuzzle.name() ?? "Unknown cube";
    setBluetoothStatus(`Connected: ${name}`);

    elements.disconnectBtn.disabled = false;
    const activePuzzle = connectedPuzzle;
    connectedPuzzle.addAlgLeafListener((event) => {
      void onCubeMove(activePuzzle, event);
    });

    const pattern = await connectedPuzzle.getPattern();
    wasCubeSolved = isPatternSolved(pattern);
    sawUnsolvedDuringRun = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setBluetoothStatus(`Connection failed: ${message}`);
  } finally {
    elements.connectBtn.disabled = false;
  }
}

function disconnectCube() {
  if (puzzle) {
    puzzle.disconnect();
  }
  puzzle = null;
  listeningPuzzle = null;
  elements.disconnectBtn.disabled = true;
  setBluetoothStatus("Disconnected.");
}

async function onCubeMove(sourcePuzzle, event) {
  if (!elements.autoTimerCheckbox.checked || !sourcePuzzle || sourcePuzzle !== puzzle) {
    return;
  }

  const pattern = event.pattern ?? (await sourcePuzzle.getPattern().catch(() => null));
  if (!pattern) {
    return;
  }

  const cubeIsSolved = isPatternSolved(pattern);

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

function isPatternSolved(pattern) {
  return pattern.experimentalIsSolved(SOLVED_CHECK_OPTIONS);
}

function setBluetoothStatus(message) {
  elements.connectionStatus.textContent = message;
}
