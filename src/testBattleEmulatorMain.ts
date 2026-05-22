import "./styles/testBattleEmulator.css";

type TestBattleLoadMessage = {
  type: "pokeweb-test-battle-load";
  sessionId: string;
  romName: string;
  saveName: string;
  trainerId: number;
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
      _prepareRomBuffer?: (size: number) => number;
      locateFile?: (path: string) => string;
      onAbort?: (reason: unknown) => void;
    };
    HEAPU8?: Uint8Array;
    _prepareRomBuffer?: (size: number) => number;
    localforage?: {
      getItem?: (key: string) => Promise<unknown>;
      setItem?: (key: string, value: unknown) => Promise<unknown>;
      removeItem?: (key: string) => Promise<void>;
    };
  };

const DESMOND_INITIAL_MEMORY = 1024 * 1024 * 1024;
const DESMOND_ASSET_VERSION = "test-battle-desmond-2026-05-21-1535";
const DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER = 4;
const MIN_TEST_BATTLE_SPEED_MULTIPLIER = 0.05;
const MAX_TEST_BATTLE_SPEED_MULTIPLIER = 8;
const FIRST_FRAME_TIMEOUT_MS = 5000;
const statusText = document.querySelector<HTMLSpanElement>("#pokeweb-status-text");
const status = document.querySelector<HTMLDivElement>("#pokeweb-status");
const speedSlider = document.querySelector<HTMLInputElement>("#pokeweb-speed");
const speedValue = document.querySelector<HTMLOutputElement>("#pokeweb-speed-value");
const pauseButton = document.querySelector<HTMLButtonElement>("#pokeweb-pause");
const stepButton = document.querySelector<HTMLButtonElement>("#pokeweb-step");
const controls = document.querySelector<HTMLDivElement>("#pokeweb-controls");
const sessionId = readSessionId();
const desmondWindow = window as DesmondWindow;
const debugLog = installDebugLog();

let started = false;
let readyTimer: number | undefined;
let blockUnexpectedNavigation = false;
let runtimeLoaded = false;
let activeSaveBytes: Uint8Array | undefined;
let latestFrameCount = 0;
let speedMultiplier = DEFAULT_TEST_BATTLE_SPEED_MULTIPLIER;
let paused = false;
let pendingStepFrames = 0;

setStatus("Waiting for battle data...");
shieldControlsFromEmulatorInput();
installSpeedControl();
installPlaybackControls();
setPlaybackControlsEnabled(false);
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

function installPlaybackControls(): void {
  pauseButton?.addEventListener("click", () => setPaused(!paused, true));
  stepButton?.addEventListener("click", () => {
    setPaused(true, false);
    pendingStepFrames = currentPendingStepFrames() + 1;
    syncPlaybackState();
    debugLog("Stepping one frame.");
  });
  syncPlaybackState();
}

function setPlaybackControlsEnabled(enabled: boolean): void {
  if (pauseButton) pauseButton.disabled = !enabled;
  if (stepButton) stepButton.disabled = !enabled;
}

function shieldControlsFromEmulatorInput(): void {
  if (!controls) return;
  const stop = (event: Event) => event.stopPropagation();
  for (const eventName of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "touchstart", "touchmove", "touchend", "touchcancel", "keydown", "keyup"]) {
    controls.addEventListener(eventName, stop);
  }
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

async function bootTestBattle(message: TestBattleLoadMessage): Promise<void> {
  let romUrl: string | undefined;
  const label = message.testLabel ?? `trainer ${message.trainerId} test battle`;
  try {
    setStatus(`Loading ${label}...`);
    activeSaveBytes = new Uint8Array(message.saveBuffer);
    desmondWindow.POKEWEB_TEST_BATTLE = {
      disableSavePersistence: true,
      saveBytes: activeSaveBytes,
      speedMultiplier,
      paused,
      stepFrames: pendingStepFrames,
      onLoadError: (loadError) => setError(loadError),
      onLog: (...values) => debugLog(values.map(formatLogValue).join(" ")),
      onFrame: (frameCount) => {
        latestFrameCount = frameCount;
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
  if (!shadow || shadow.querySelector("#pokeweb-desmond-style")) return;
  const style = document.createElement("style");
  style.id = "pokeweb-desmond-style";
  style.textContent = `
    #player { position: fixed; inset: 0; display: grid; place-content: center; gap: 0; background: #000; }
    canvas { display: block; width: min(100vw, calc(100vh * 256 / 384)); height: auto; image-rendering: pixelated; }
  `;
  shadow.appendChild(style);
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
