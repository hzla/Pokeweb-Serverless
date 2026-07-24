import "./styles/testBattleEmulator.css";
import { concatBytes, readAscii, readU32 } from "./nds/binary";
import {
  isSupportedGen5BattleGameCode,
  readTestBattleOpponentSnapshot,
  type TestBattleOpponentSnapshot,
} from "./pokeweb/testBattleOpponentStats";

type TestBattleLoadMessage = {
  type: "pokeweb-test-battle-load";
  sessionId: string;
  romName: string;
  saveName: string;
  trainerId: number;
  opponentTrainerId?: number;
  pokemonNames?: string[];
  testLabel?: string;
  romBuffer: ArrayBuffer;
  saveBuffer: ArrayBuffer;
};

type DesmondPlayer = HTMLElement & {
  loadURL?: (url: string, callback?: () => void) => void;
  enableMicrophone?: () => void;
};

type DesmondWindow = Window &
  typeof globalThis & {
    POKEWEB_TEST_BATTLE?: {
      disableSavePersistence: boolean;
      saveBytes?: Uint8Array;
      speedMultiplier?: number;
      audioVolume?: number;
      audioMuted?: boolean;
      paused?: boolean;
      stepFrames?: number;
      onLoadError?: (message: string) => void;
      onLog?: (...values: unknown[]) => void;
      onFrame?: (frameCount: number) => void;
      onStepFrames?: (stepFrames: number) => void;
    };
    Module?: {
      INITIAL_MEMORY?: number;
      HEAPU8?: Uint8Array;
      _getSymbol?: (id: number) => number;
      _prepareRomBuffer?: (size: number) => number;
      _savGetSize?: () => number;
      _savGetPointer?: (desiredSize: number) => number;
      _stateGetSize?: () => number;
      _stateGetPointer?: (desiredSize: number) => number;
      _saveState?: (compressionLevel: number) => number;
      _loadState?: (pointer: number) => number;
      locateFile?: (path: string) => string;
      onAbort?: (reason: unknown) => void;
    };
    HEAPU8?: Uint8Array;
    _prepareRomBuffer?: (size: number) => number;
    pokewebTryInitSound?: () => void;
    localforage?: {
      getItem?: (key: string) => Promise<unknown>;
      setItem?: (key: string, value: unknown) => Promise<unknown>;
      removeItem?: (key: string) => Promise<void>;
    };
  };

type InBrowserStateSnapshot = {
  heapByteLength: number;
  pageSize: number;
  pageCount: number;
  pages: Array<{ index: number; bytes: Uint8Array }>;
  frameCount: number;
  createdAt: string;
};

const DESMOND_INITIAL_MEMORY = 1024 * 1024 * 1024;
const DESMOND_ASSET_VERSION = "test-battle-desmond-2026-06-27-savestate";
const DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER = 4;
const MIN_TEST_BATTLE_SPEED_MULTIPLIER = 0.05;
const MAX_TEST_BATTLE_SPEED_MULTIPLIER = 8;
const DEFAULT_TEST_BATTLE_AUDIO_VOLUME = 0;
const MIN_TEST_BATTLE_AUDIO_VOLUME = 0;
const MAX_TEST_BATTLE_AUDIO_VOLUME = 1;
const DEFAULT_TEST_BATTLE_SCREEN_SCALE = 1;
const MIN_TEST_BATTLE_SCREEN_SCALE = 0.5;
const MAX_TEST_BATTLE_SCREEN_SCALE = 1;
const FIRST_FRAME_TIMEOUT_MS = 5000;
const DESMUME_STATE_MAGIC = new Uint8Array([68, 101, 83, 109, 117, 77, 69, 32, 83, 83, 116, 97, 116, 101, 0, 0]);
const DESMUME_STATE_HEADER_SIZE = 32;
const MAX_DESMUME_STATE_BYTES = 128 * 1024 * 1024;
const MAIN_MEMORY_DUMP_BYTES = 4 * 1024 * 1024;
const IN_BROWSER_STATE_PAGE_BYTES = 64 * 1024;
const OPPONENT_STATS_POLL_INTERVAL_MS = 150;
const statusText = document.querySelector<HTMLSpanElement>("#pokeweb-status-text");
const status = document.querySelector<HTMLDivElement>("#pokeweb-status");
const speedSlider = document.querySelector<HTMLInputElement>("#pokeweb-speed");
const speedValue = document.querySelector<HTMLOutputElement>("#pokeweb-speed-value");
const screenSizeSlider = document.querySelector<HTMLInputElement>("#pokeweb-screen-size");
const screenSizeValue = document.querySelector<HTMLOutputElement>("#pokeweb-screen-size-value");
const audioSlider = document.querySelector<HTMLInputElement>("#pokeweb-audio");
const audioValue = document.querySelector<HTMLOutputElement>("#pokeweb-audio-value");
const pauseButton = document.querySelector<HTMLButtonElement>("#pokeweb-pause");
const stepButton = document.querySelector<HTMLButtonElement>("#pokeweb-step");
const savestateButton = document.querySelector<HTMLButtonElement>("#pokeweb-savestate");
const loadLastStateButton = document.querySelector<HTMLButtonElement>("#pokeweb-load-last-state");
const controls = document.querySelector<HTMLDivElement>("#pokeweb-controls");
const opponentTrainerId = document.querySelector<HTMLSpanElement>("#pokeweb-opponent-trainer-id");
const opponentParty = document.querySelector<HTMLDivElement>("#pokeweb-opponent-party");
const sessionId = readSessionId();
const desmondWindow = window as DesmondWindow;
const debugLog = installDebugLog();

let started = false;
let readyTimer: number | undefined;
let blockUnexpectedNavigation = false;
let runtimeLoaded = false;
let activeSaveBytes: Uint8Array | undefined;
let activeRomName = "pokeweb-test-battle.nds";
let activeSaveName = "pokeweb-test-battle.sav";
let activeTrainerId = 0;
let activeOpponentTrainerId: number | undefined;
let activePokemonNames: string[] = [];
let activeTestLabel = "test battle";
let activeGameCode = "";
let activeRomByteLength = 0;
let latestFrameCount = 0;
let speedMultiplier = DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER;
let screenScale = DEFAULT_TEST_BATTLE_SCREEN_SCALE;
let audioVolume = DEFAULT_TEST_BATTLE_AUDIO_VOLUME;
let paused = false;
let pendingStepFrames = 0;
let lastExportedDesmumeStateBytes: Uint8Array | undefined;
let lastInBrowserStateSnapshot: InBrowserStateSnapshot | undefined;
let lastStateExportAttempted = false;
let lastOpponentStatsPollAt = -Infinity;
let lastOpponentBattleMainAddress: number | undefined;
let lastOpponentPanelKey = "";

setStatus("Waiting for battle data...");
shieldControlsFromEmulatorInput();
installScreenSizeControl();
installSpeedControl();
installAudioControl();
installPlaybackControls();
setPlaybackControlsEnabled(false);
renderOpponentPanelStatus("Waiting for a trainer battle...");
installMessageListener();
startReadyPings();

function installMessageListener(): void {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data as Partial<TestBattleLoadMessage>;
    if (message.type !== "pokeweb-test-battle-load" || message.sessionId !== sessionId) return;
    if (started) return;
    started = true;
    if (readyTimer !== undefined) window.clearInterval(readyTimer);
    void bootTestBattle(message as TestBattleLoadMessage);
  });

  window.setTimeout(() => {
    if (!started) setError("No battle data arrived. Close this tab and try Test Battle again.");
  }, 60000);
}

function startReadyPings(): void {
  if (!window.opener) {
    setError("This page must be opened from the Pokeweb Test Battle button.");
    return;
  }
  notifyReady();
  readyTimer = window.setInterval(notifyReady, 500);
}

function notifyReady(): void {
  if (!window.opener) return;
  window.opener.postMessage({ type: "pokeweb-test-battle-ready", sessionId }, window.location.origin);
}

function installSpeedControl(): void {
  if (!speedSlider) return;
  setSpeedMultiplier(DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER, false);
  speedSlider.addEventListener("input", () => setSpeedMultiplier(Number(speedSlider.value), false));
  speedSlider.addEventListener("change", () => setSpeedMultiplier(Number(speedSlider.value), true));
}

function installScreenSizeControl(): void {
  if (!screenSizeSlider) return;
  setScreenScale(DEFAULT_TEST_BATTLE_SCREEN_SCALE, false);
  screenSizeSlider.addEventListener("input", () => setScreenScale(Number(screenSizeSlider.value) / 100, false));
  screenSizeSlider.addEventListener("change", () => setScreenScale(Number(screenSizeSlider.value) / 100, true));
}

function installAudioControl(): void {
  if (!audioSlider) return;
  setAudioVolume(DEFAULT_TEST_BATTLE_AUDIO_VOLUME, false);
  audioSlider.addEventListener("input", () => setAudioVolume(Number(audioSlider.value) / 100, false));
  audioSlider.addEventListener("change", () => setAudioVolume(Number(audioSlider.value) / 100, true));
}

function installPlaybackControls(): void {
  pauseButton?.addEventListener("click", () => setPaused(!paused, true));
  stepButton?.addEventListener("click", () => {
    setPaused(true, false);
    pendingStepFrames = currentPendingStepFrames() + 1;
    syncPlaybackState();
    debugLog("Stepping one frame.");
  });
  savestateButton?.addEventListener("click", async () => {
    setPaused(true, false);
    try {
      setStatus("Capturing emulator state...");
      await waitForNextPaint();
      const message = exportEmulatorState();
      setStatus(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  });
  loadLastStateButton?.addEventListener("click", () => {
    setPaused(true, false);
    try {
      const message = loadLastExportedState();
      setStatus(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  });
  syncPlaybackState();
  syncLastStateControl();
}

function setPlaybackControlsEnabled(enabled: boolean): void {
  if (pauseButton) pauseButton.disabled = !enabled;
  if (stepButton) stepButton.disabled = !enabled;
  if (savestateButton) savestateButton.disabled = !enabled;
  syncLastStateControl();
}

function syncLastStateControl(): void {
  if (!loadLastStateButton) return;
  const hasState = lastExportedDesmumeStateBytes !== undefined || lastInBrowserStateSnapshot !== undefined;
  loadLastStateButton.hidden = !lastStateExportAttempted;
  loadLastStateButton.disabled = !hasState || (savestateButton?.disabled ?? true);
  loadLastStateButton.title = hasState ? "Load the emulator state captured most recently in this tab." : "The last export did not capture a loadable emulator state.";
}

function shieldControlsFromEmulatorInput(): void {
  if (!controls) return;
  const stop = (event: Event) => {
    if (event.type === "pointerup" || event.type === "mouseup" || event.type === "touchend" || event.type === "touchcancel") {
      window.setTimeout(blurFocusedEmulatorControl, 0);
    }
    event.stopPropagation();
  };
  for (const eventName of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "touchstart", "touchmove", "touchend", "touchcancel", "keydown", "keyup"]) {
    controls.addEventListener(eventName, stop);
  }
  controls.addEventListener("change", () => window.setTimeout(blurFocusedEmulatorControl, 0));
}

function blurFocusedEmulatorControl(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && controls?.contains(active)) active.blur();
}

function clampSpeedMultiplier(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER;
  return Math.max(MIN_TEST_BATTLE_SPEED_MULTIPLIER, Math.min(MAX_TEST_BATTLE_SPEED_MULTIPLIER, Math.round(value * 20) / 20));
}

function setSpeedMultiplier(value: number, logChange: boolean): void {
  speedMultiplier = clampSpeedMultiplier(value);
  const formatted = formatSpeedMultiplier(speedMultiplier);
  if (speedSlider) speedSlider.value = formatted;
  if (speedValue) speedValue.textContent = `${formatted}x`;
  if (desmondWindow.POKEWEB_TEST_BATTLE) desmondWindow.POKEWEB_TEST_BATTLE.speedMultiplier = speedMultiplier;
  if (logChange) debugLog(`Emulation speed set to ${formatted}x.`);
}

function clampScreenScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEST_BATTLE_SCREEN_SCALE;
  return Math.max(MIN_TEST_BATTLE_SCREEN_SCALE, Math.min(MAX_TEST_BATTLE_SCREEN_SCALE, Math.round(value * 20) / 20));
}

function setScreenScale(value: number, logChange: boolean): void {
  screenScale = clampScreenScale(value);
  const percent = Math.round(screenScale * 100);
  if (screenSizeSlider) screenSizeSlider.value = String(percent);
  if (screenSizeValue) screenSizeValue.textContent = percent === 100 ? "Fit" : `${percent}%`;
  syncDesmondPlayerSize();
  if (logChange) debugLog(percent === 100 ? "Emulator screens set to fit." : `Emulator screens set to ${percent}% of fit.`);
}

function clampAudioVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEST_BATTLE_AUDIO_VOLUME;
  return Math.max(MIN_TEST_BATTLE_AUDIO_VOLUME, Math.min(MAX_TEST_BATTLE_AUDIO_VOLUME, Math.round(value * 100) / 100));
}

function setAudioVolume(value: number, logChange: boolean): void {
  audioVolume = clampAudioVolume(value);
  const percent = Math.round(audioVolume * 100);
  if (audioSlider) audioSlider.value = String(percent);
  if (audioValue) audioValue.textContent = percent === 0 ? "Muted" : `${percent}%`;
  if (desmondWindow.POKEWEB_TEST_BATTLE) {
    desmondWindow.POKEWEB_TEST_BATTLE.audioVolume = audioVolume;
    desmondWindow.POKEWEB_TEST_BATTLE.audioMuted = audioVolume <= 0;
  }
  if (audioVolume > 0) desmondWindow.pokewebTryInitSound?.();
  if (logChange) debugLog(percent === 0 ? "Emulator audio muted." : `Emulator audio set to ${percent}%.`);
}

function setPaused(value: boolean, logChange: boolean): void {
  paused = value;
  syncPlaybackState();
  if (logChange) debugLog(paused ? "Emulation paused." : "Emulation resumed.");
}

function currentPendingStepFrames(): number {
  return Math.max(0, Math.trunc(desmondWindow.POKEWEB_TEST_BATTLE?.stepFrames ?? pendingStepFrames));
}

function syncPlaybackState(): void {
  if (pauseButton) {
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(paused));
  }
  if (desmondWindow.POKEWEB_TEST_BATTLE) {
    desmondWindow.POKEWEB_TEST_BATTLE.paused = paused;
    desmondWindow.POKEWEB_TEST_BATTLE.stepFrames = pendingStepFrames;
  }
}

function formatSpeedMultiplier(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/u, "");
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    window.setTimeout(finish, 80);
  });
}

async function bootTestBattle(message: TestBattleLoadMessage): Promise<void> {
  let romUrl: string | undefined;
  const label = message.testLabel ?? `trainer ${message.trainerId} test battle`;
  try {
    setStatus(`Loading ${label}...`);
    activeSaveBytes = new Uint8Array(message.saveBuffer);
    activeRomName = message.romName || "pokeweb-test-battle.nds";
    activeSaveName = message.saveName || "pokeweb-test-battle.sav";
    activeTrainerId = message.trainerId;
    activeOpponentTrainerId = message.opponentTrainerId;
    activePokemonNames = Array.isArray(message.pokemonNames) ? message.pokemonNames.map(String) : [];
    activeTestLabel = label;
    activeRomByteLength = message.romBuffer.byteLength;
    activeGameCode = readRomGameCode(new Uint8Array(message.romBuffer));
    desmondWindow.POKEWEB_TEST_BATTLE = {
      disableSavePersistence: true,
      saveBytes: activeSaveBytes,
      speedMultiplier,
      audioVolume,
      audioMuted: audioVolume <= 0,
      paused,
      stepFrames: pendingStepFrames,
      onLoadError: (loadError) => setError(loadError),
      onLog: (...values) => debugLog(values.map(formatLogValue).join(" ")),
      onFrame: (frameCount) => {
        latestFrameCount = frameCount;
        refreshOpponentPanel();
      },
      onStepFrames: (stepFrames) => {
        pendingStepFrames = Math.max(0, Math.trunc(stepFrames));
      },
    };
    debugLog(`Received ROM ${(message.romBuffer.byteLength / 1024 / 1024).toFixed(1)} MiB and save ${message.saveBuffer.byteLength} bytes.`);
    blockUnexpectedNavigation = true;

    await loadDesmondRuntime();
    patchDesmondSaveStorage();

    const player = getDesmondPlayer();
    styleDesmondPlayer(player);

    setStatus("Starting emulator...");
    romUrl = URL.createObjectURL(new Blob([message.romBuffer], { type: "application/octet-stream" }));
    await loadRom(player, romUrl);
    setStatus("Waiting for emulator frames...");
    await waitForFrameProgress();
    setPlaybackControlsEnabled(true);
    blockUnexpectedNavigation = false;
    setStatus(`Running ${label}.`);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    if (romUrl) {
      const urlToRevoke = romUrl;
      window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 30000);
    }
  }
}

async function loadDesmondRuntime(): Promise<void> {
  if (runtimeLoaded) return;
  const baseUrl = new URL("./desmond/", window.location.href);
  desmondWindow.Module = {
    ...(desmondWindow.Module ?? {}),
    INITIAL_MEMORY: DESMOND_INITIAL_MEMORY,
    locateFile: (path) => cacheBust(new URL(path, baseUrl)),
    onAbort: (reason) => setError(`Emulator failed to initialize: ${String(reason)}`),
  };

  setStatus("Loading emulator runtime...");
  await loadClassicScript(cacheBust(new URL("desmond.js", baseUrl)));
  await waitForRuntimeHeap();
  debugLog("Desmond runtime loaded.");
  runtimeLoaded = true;
}

function patchDesmondSaveStorage(): void {
  const localforage = desmondWindow.localforage;
  if (!localforage) return;
  localforage.getItem = async (key: string) => {
    if (!key.startsWith("sav-")) return undefined;
    debugLog(`Supplying in-memory save for ${key} (${activeSaveBytes?.length ?? 0} bytes).`);
    return activeSaveBytes;
  };
  localforage.setItem = async (_key: string, value: unknown) => value;
  localforage.removeItem = async () => undefined;
}

function exportEmulatorState(): string {
  const baseName = safeFilenameBase(activeTestLabel || activeRomName || "pokeweb-test-battle");
  const timestamp = timestampForFilename(new Date());
  const desmumeState = readDesmumeStateBytes();
  lastStateExportAttempted = true;
  if (desmumeState) {
    lastExportedDesmumeStateBytes = new Uint8Array(desmumeState);
    lastInBrowserStateSnapshot = undefined;
    syncLastStateControl();
    downloadBytes(desmumeState, `${baseName}-${timestamp}.dst`, "application/octet-stream");
    return `Exported DeSmuME savestate (${formatByteCount(desmumeState.length)}). Load Last State is ready.`;
  }

  const inBrowserSnapshot = captureInBrowserStateSnapshot();
  lastExportedDesmumeStateBytes = undefined;
  lastInBrowserStateSnapshot = inBrowserSnapshot;
  syncLastStateControl();
  const snapshot = buildDebugSnapshotZip();
  downloadBytes(snapshot, `${baseName}-${timestamp}.pokeweb-state.zip`, "application/zip");
  if (inBrowserSnapshot) {
    return `Exported Pokeweb debug snapshot (${formatByteCount(snapshot.length)}). Captured in-browser state (${formatByteCount(inBrowserSnapshotSize(inBrowserSnapshot))}); Load Last State is ready in this tab.`;
  }
  return `Exported Pokeweb debug snapshot (${formatByteCount(snapshot.length)}). Load Last State is unavailable because emulator memory could not be captured.`;
}

function loadLastExportedState(): string {
  const stateBytes = lastExportedDesmumeStateBytes;
  if (!stateBytes) {
    const snapshot = lastInBrowserStateSnapshot;
    if (!snapshot) throw new Error("Export a state before loading the last state.");
    restoreInBrowserStateSnapshot(snapshot);
    refreshOpponentPanel(true);
    debugLog(`Loaded in-browser state snapshot (${formatByteCount(inBrowserSnapshotSize(snapshot))}).`);
    return `Loaded last in-browser state (${formatByteCount(inBrowserSnapshotSize(snapshot))}).`;
  }

  const stateSize = desmumeStateSizeFromBytes(stateBytes);
  if (stateSize === undefined || stateSize !== stateBytes.length) {
    throw new Error("The last exported state is not a valid DeSmuME savestate.");
  }

  const stateGetPointer = desmondWindow.Module?._stateGetPointer;
  const loadState = desmondWindow.Module?._loadState;
  if (typeof stateGetPointer !== "function" || typeof loadState !== "function") {
    throw new Error("This emulator runtime cannot load DeSmuME savestates.");
  }

  const pointer = stateGetPointer(stateBytes.length);
  const heap = getHeap();
  if (!heap || !isHeapRange(heap, pointer, stateBytes.length)) {
    throw new Error("Could not reserve emulator memory for the savestate.");
  }

  heap.set(stateBytes, pointer);
  const result = loadState(pointer);
  if (result === 0) {
    throw new Error("Desmond rejected the last state. It may not match this ROM.");
  }

  refreshOpponentPanel(true);
  debugLog(`Loaded DeSmuME savestate (${formatByteCount(stateBytes.length)}).`);
  return `Loaded last exported state (${formatByteCount(stateBytes.length)}).`;
}

function captureInBrowserStateSnapshot(): InBrowserStateSnapshot | undefined {
  const heap = getHeap();
  if (!heap) return undefined;
  const startedAt = performance.now();
  const pageSize = IN_BROWSER_STATE_PAGE_BYTES;
  const pageCount = Math.ceil(heap.byteLength / pageSize);
  const pages: InBrowserStateSnapshot["pages"] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const start = index * pageSize;
    const end = Math.min(heap.byteLength, start + pageSize);
    if (!heapRangeHasNonZeroByte(heap, start, end)) continue;
    pages.push({ index, bytes: new Uint8Array(heap.slice(start, end)) });
  }

  const snapshot: InBrowserStateSnapshot = {
    heapByteLength: heap.byteLength,
    pageSize,
    pageCount,
    pages,
    frameCount: latestFrameCount,
    createdAt: new Date().toISOString(),
  };
  debugLog(`Captured in-browser state in ${Math.round(performance.now() - startedAt)}ms (${pages.length}/${pageCount} pages, ${formatByteCount(inBrowserSnapshotSize(snapshot))}).`);
  return snapshot;
}

function restoreInBrowserStateSnapshot(snapshot: InBrowserStateSnapshot): void {
  const heap = getHeap();
  if (!heap) throw new Error("Emulator memory is not available.");
  if (heap.byteLength !== snapshot.heapByteLength) {
    throw new Error("The last state was captured from a different emulator memory layout.");
  }

  const startedAt = performance.now();
  const pages = new Map(snapshot.pages.map((page) => [page.index, page.bytes]));
  for (let index = 0; index < snapshot.pageCount; index += 1) {
    const start = index * snapshot.pageSize;
    const end = Math.min(heap.byteLength, start + snapshot.pageSize);
    const page = pages.get(index);
    if (page) {
      heap.set(page, start);
    } else {
      heap.fill(0, start, end);
    }
  }
  latestFrameCount = snapshot.frameCount;
  pendingStepFrames = 0;
  syncPlaybackState();
  debugLog(`Restored in-browser state from ${snapshot.createdAt} in ${Math.round(performance.now() - startedAt)}ms.`);
}

function heapRangeHasNonZeroByte(heap: Uint8Array, start: number, end: number): boolean {
  const wordEnd = start + Math.floor((end - start) / 4) * 4;
  const words = new Uint32Array(heap.buffer, heap.byteOffset + start, (wordEnd - start) / 4);
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== 0) return true;
  }
  for (let index = wordEnd; index < end; index += 1) {
    if (heap[index] !== 0) return true;
  }
  return false;
}

function inBrowserSnapshotSize(snapshot: InBrowserStateSnapshot): number {
  return snapshot.pages.reduce((sum, page) => sum + page.bytes.length, 0);
}

function readDesmumeStateBytes(): Uint8Array | undefined {
  const saveState = desmondWindow.Module?._saveState;
  const stateGetSize = desmondWindow.Module?._stateGetSize;
  const stateGetPointer = desmondWindow.Module?._stateGetPointer;
  if (typeof stateGetPointer !== "function") return undefined;
  if (typeof saveState === "function") {
    const startedAt = performance.now();
    const savedSize = saveState(1);
    const stateSize = typeof stateGetSize === "function" ? stateGetSize() : savedSize;
    if (!Number.isInteger(savedSize) || savedSize <= 0 || !Number.isInteger(stateSize) || stateSize <= 0 || stateSize > MAX_DESMUME_STATE_BYTES) {
      debugLog(`Desmond saveState failed (${savedSize}, ${stateSize}).`);
      return undefined;
    }

    const pointer = stateGetPointer(0);
    const stateBytes = copyHeapBytes(pointer, stateSize);
    const parsedSize = stateBytes ? desmumeStateSizeFromBytes(stateBytes) : undefined;
    if (!stateBytes || parsedSize !== stateSize) {
      debugLog(`Desmond saveState produced an invalid savestate (${formatByteCount(stateSize)}).`);
      return undefined;
    }

    debugLog(`Captured DeSmuME savestate in ${Math.round(performance.now() - startedAt)}ms (${formatByteCount(stateSize)}).`);
    return stateBytes;
  }

  // Older cores briefly exposed the state buffer without a matching save call.
  // Keep this as a compatibility probe, but do not allocate a huge fallback buffer.
  const pointer = stateGetPointer(0);
  return copyDesmumeStateAt(pointer);
}

function copyDesmumeStateAt(pointer: number): Uint8Array | undefined {
  const size = desmumeStateSizeAt(pointer);
  return size === undefined ? undefined : copyHeapBytes(pointer, size);
}

function desmumeStateSizeAt(pointer: number): number | undefined {
  const heap = getHeap();
  if (!heap || !isHeapRange(heap, pointer, DESMUME_STATE_HEADER_SIZE)) return undefined;
  return desmumeStateSizeFromBytes(heap.subarray(pointer, Math.min(heap.byteLength, pointer + MAX_DESMUME_STATE_BYTES)));
}

function desmumeStateSizeFromBytes(bytes: Uint8Array): number | undefined {
  if (bytes.length < DESMUME_STATE_HEADER_SIZE) return undefined;
  for (let index = 0; index < DESMUME_STATE_MAGIC.length; index += 1) {
    if (bytes[index] !== DESMUME_STATE_MAGIC[index]) return undefined;
  }
  const stateVersion = readU32(bytes, 16);
  const uncompressedLength = readU32(bytes, 24);
  const compressedLength = readU32(bytes, 28);
  const totalSize = compressedLength === 0xffffffff ? uncompressedLength : DESMUME_STATE_HEADER_SIZE + compressedLength;
  if (stateVersion === 0 || stateVersion > 1000) return undefined;
  if (totalSize < DESMUME_STATE_HEADER_SIZE || totalSize > MAX_DESMUME_STATE_BYTES) return undefined;
  return totalSize <= bytes.length ? totalSize : undefined;
}

function buildDebugSnapshotZip(): Uint8Array {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const currentSave = readCurrentBatterySaveBytes();
  if (currentSave) files.push({ name: "current-battery-save.sav", data: currentSave });
  if (activeSaveBytes) files.push({ name: "initial-battery-save.sav", data: new Uint8Array(activeSaveBytes) });
  const mainMemory = readMainMemoryBytes();
  if (mainMemory) files.push({ name: "main-memory-4mb.bin", data: mainMemory });
  files.unshift({
    name: "metadata.json",
    data: new TextEncoder().encode(JSON.stringify(debugSnapshotMetadata(files), null, 2)),
  });
  return zipStoredFiles(files);
}

function debugSnapshotMetadata(files: Array<{ name: string; data: Uint8Array }>): Record<string, unknown> {
  return {
    kind: "pokeweb-desmond-debug-snapshot",
    version: 1,
    loadableSavestate: false,
    reason: "The Desmond core could not produce a readable DeSmuME savestate for this run.",
    createdAt: new Date().toISOString(),
    romName: activeRomName,
    saveName: activeSaveName,
    trainerId: activeTrainerId,
    testLabel: activeTestLabel,
    romByteLength: activeRomByteLength,
    frameCount: latestFrameCount,
    paused,
    speedMultiplier,
    files: files.map((file) => ({ name: file.name, byteLength: file.data.length })),
  };
}

function readCurrentBatterySaveBytes(): Uint8Array | undefined {
  const size = desmondWindow.Module?._savGetSize?.();
  const pointer = desmondWindow.Module?._savGetPointer?.(0);
  if (size === undefined || pointer === undefined || !Number.isFinite(size) || !Number.isFinite(pointer) || size <= 0) return undefined;
  return copyHeapBytes(pointer, size);
}

function readMainMemoryBytes(): Uint8Array | undefined {
  const memory = readMainMemoryView();
  return memory ? new Uint8Array(memory) : undefined;
}

function readMainMemoryView(): Uint8Array | undefined {
  const pointer = desmondWindow.Module?._getSymbol?.(7);
  if (pointer === undefined || !Number.isFinite(pointer) || pointer <= 0) return undefined;
  const heap = getHeap();
  if (!heap || !isHeapRange(heap, pointer, MAIN_MEMORY_DUMP_BYTES)) return undefined;
  return heap.subarray(pointer, pointer + MAIN_MEMORY_DUMP_BYTES);
}

function refreshOpponentPanel(force = false): void {
  const now = performance.now();
  if (!force && now - lastOpponentStatsPollAt < OPPONENT_STATS_POLL_INTERVAL_MS) return;
  lastOpponentStatsPollAt = now;

  if (!isSupportedGen5BattleGameCode(activeGameCode)) {
    renderOpponentPanelStatus(activeGameCode ? `Live opponent stats are unavailable for ROM ${activeGameCode}.` : "Waiting for ROM information...");
    return;
  }
  const memory = readMainMemoryView();
  if (!memory) {
    renderOpponentPanelStatus("Waiting for emulator memory...");
    return;
  }

  const snapshot = readTestBattleOpponentSnapshot(memory, activeGameCode, { lastKnownBattleMainAddress: lastOpponentBattleMainAddress });
  if (!snapshot) {
    renderOpponentPanelStatus("Waiting for a trainer battle...");
    return;
  }
  lastOpponentBattleMainAddress = snapshot.battleMainAddress;
  renderOpponentSnapshot(snapshot);
}

function renderOpponentPanelStatus(message: string): void {
  const key = `status:${message}`;
  if (lastOpponentPanelKey === key) return;
  lastOpponentPanelKey = key;
  if (opponentTrainerId) {
    opponentTrainerId.textContent = "—";
    opponentTrainerId.removeAttribute("title");
  }
  if (!opponentParty) return;
  opponentParty.replaceChildren();
  const statusLine = document.createElement("p");
  statusLine.className = "pokeweb-opponent-empty";
  statusLine.textContent = message;
  opponentParty.append(statusLine);
}

function renderOpponentSnapshot(snapshot: TestBattleOpponentSnapshot): void {
  const displayedTrainerId = activeOpponentTrainerId ?? snapshot.trainerId;
  const key = JSON.stringify([displayedTrainerId, snapshot.trainerId, snapshot.party]);
  if (lastOpponentPanelKey === key) return;
  lastOpponentPanelKey = key;
  if (opponentTrainerId) {
    opponentTrainerId.textContent = String(displayedTrainerId || "—");
    if (activeOpponentTrainerId !== undefined && snapshot.trainerId !== 0 && snapshot.trainerId !== activeOpponentTrainerId) {
      opponentTrainerId.title = `Runtime test-battle trainer slot: ${snapshot.trainerId}`;
    } else {
      opponentTrainerId.removeAttribute("title");
    }
  }
  if (!opponentParty) return;
  opponentParty.replaceChildren();
  if (snapshot.party.length === 0) {
    const statusLine = document.createElement("p");
    statusLine.className = "pokeweb-opponent-empty";
    statusLine.textContent = "Battle found; waiting for the enemy party...";
    opponentParty.append(statusLine);
    return;
  }

  for (const pokemon of snapshot.party) {
    const card = document.createElement("section");
    card.className = "pokeweb-opponent-pokemon";
    const heading = document.createElement("h3");
    const speciesName = activePokemonNames[pokemon.speciesId]?.trim();
    heading.textContent = speciesName ? `Slot ${pokemon.partySlot} · ${speciesName} · Species #${pokemon.speciesId}` : `Slot ${pokemon.partySlot} · Species #${pokemon.speciesId}`;
    card.append(heading);

    const stats = document.createElement("dl");
    appendOpponentStat(stats, "HP", pokemon.hp);
    appendOpponentStat(stats, "Atk", pokemon.attack);
    appendOpponentStat(stats, "Def", pokemon.defense);
    appendOpponentStat(stats, "Sp. Atk", pokemon.spAttack);
    appendOpponentStat(stats, "Sp. Def", pokemon.spDefense);
    appendOpponentStat(stats, "Speed", pokemon.speed);
    appendOpponentStat(stats, "PID", formatPid(pokemon.pid), true);
    card.append(stats);
    opponentParty.append(card);
  }
}

function appendOpponentStat(list: HTMLDListElement, label: string, value: string | number, wide = false): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = String(value);
  if (wide) {
    term.classList.add("-wide");
    description.classList.add("-wide");
  }
  list.append(term, description);
}

function formatPid(pid: number): string {
  return `0x${(pid >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function readRomGameCode(romBytes: Uint8Array): string {
  return romBytes.length >= 0x10 ? readAscii(romBytes, 0x0c, 4) : "";
}

function copyHeapBytes(pointer: number, size: number): Uint8Array | undefined {
  const heap = getHeap();
  if (!heap || !isHeapRange(heap, pointer, size)) return undefined;
  return new Uint8Array(heap.subarray(pointer, pointer + size));
}

function getHeap(): Uint8Array | undefined {
  return desmondWindow.Module?.HEAPU8 ?? desmondWindow.HEAPU8;
}

function isHeapRange(heap: Uint8Array, pointer: number, size: number): boolean {
  return Number.isInteger(pointer) && Number.isInteger(size) && pointer >= 0 && size >= 0 && pointer + size <= heap.byteLength;
}

function safeFilenameBase(value: string): string {
  const normalized = value
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "pokeweb-test-battle";
}

function timestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zipStoredFiles(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatBytes([...parts, ...centralParts, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDesmondPlayer(): DesmondPlayer {
  const player = document.querySelector<DesmondPlayer>("#desmond-player");
  if (!player || typeof player.loadURL !== "function") throw new Error("Desmond player did not initialize.");
  return player;
}

function loadRom(player: DesmondPlayer, romUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Timed out while loading the ROM in Desmond.")), 20000);
    player.loadURL?.(romUrl, () => {
      window.clearTimeout(timeout);
      debugLog("Desmond reported ROM load complete.");
      resolve();
    });
  });
}

function waitForFrameProgress(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startFrame = latestFrameCount;
    const startedAt = performance.now();
    const poll = () => {
      if (latestFrameCount > startFrame) {
        debugLog(`Frame loop active at frame ${latestFrameCount}.`);
        resolve();
        return;
      }
      if (performance.now() - startedAt > FIRST_FRAME_TIMEOUT_MS) {
        reject(new Error("The ROM loaded, but Desmond did not advance any frames."));
        return;
      }
      window.setTimeout(poll, 100);
    };
    poll();
  });
}

function styleDesmondPlayer(player: DesmondPlayer): void {
  const shadow = player.shadowRoot;
  if (!shadow) return;
  if (!shadow.querySelector("#pokeweb-desmond-style")) {
    const style = document.createElement("style");
    style.id = "pokeweb-desmond-style";
    shadow.appendChild(style);
  }
  syncDesmondPlayerSize();
}

function syncDesmondPlayerSize(): void {
  const player = document.querySelector<DesmondPlayer>("#desmond-player");
  const style = player?.shadowRoot?.querySelector<HTMLStyleElement>("#pokeweb-desmond-style");
  if (!style) return;
  const percent = Math.round(screenScale * 100);
  const viewportWidth = (screenScale * 100 * 256) / 384;
  style.textContent = `
    #player {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #000;
    }
    canvas {
      display: block;
      flex: 0 0 auto;
      width: min(${percent}%, ${viewportWidth.toFixed(4)}vh);
      height: auto;
      image-rendering: pixelated;
    }
  `;
}

function cacheBust(url: URL): string {
  url.searchParams.set("pokeweb", DESMOND_ASSET_VERSION);
  return url.href;
}

function waitForRuntimeHeap(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const poll = () => {
      const heap = desmondWindow.Module?.HEAPU8 ?? desmondWindow.HEAPU8;
      const prepareRomBuffer = desmondWindow.Module?._prepareRomBuffer ?? desmondWindow._prepareRomBuffer;
      if (heap && typeof heap.set === "function" && typeof prepareRomBuffer === "function") {
        debugLog(`WASM heap ready: ${(heap.byteLength / 1024 / 1024).toFixed(0)} MiB.`);
        resolve();
        return;
      }
      if (performance.now() - startedAt > 10000) {
        reject(new Error("Desmond initialized without an accessible WASM heap."));
        return;
      }
      window.setTimeout(poll, 50);
    };
    poll();
  });
}

function loadClassicScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function setStatus(message: string): void {
  if (statusText) statusText.textContent = message;
  status?.classList.remove("-error", "-hidden");
  debugLog(message);
}

function setError(message: string): void {
  if (statusText) statusText.textContent = message;
  status?.classList.add("-error");
  status?.classList.remove("-hidden");
  debugLog(`ERROR: ${message}`);
}

function readSessionId(): string {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get("session") ?? new URLSearchParams(window.location.search).get("session") ?? "";
}

window.addEventListener("beforeunload", (event) => {
  if (!blockUnexpectedNavigation) return;
  event.preventDefault();
  event.returnValue = "";
});

function installDebugLog(): (message: string) => void {
  const log = document.querySelector<HTMLPreElement>("#pokeweb-debug-log");
  const lines: string[] = [];
  const append = (message: string) => {
    lines.push(`${new Date().toLocaleTimeString()} ${message}`);
    while (lines.length > 14) lines.shift();
    if (log) log.textContent = lines.join("\n");
  };
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      append(values.map(formatLogValue).join(" "));
      original(...values);
    };
  }
  return append;
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value instanceof Blob) return `Blob(${value.size} bytes)`;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
