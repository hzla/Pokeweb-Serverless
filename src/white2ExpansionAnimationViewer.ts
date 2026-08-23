import { unzipSync } from "fflate";
import "./styles/white2ExpansionAnimationViewer.css";
import { NARC } from "./nds/narc";
import { decodeBattleModelScene, type BattleModelScene } from "./pokeweb/battleModelScene";
import { decompileMoveAnimationBytes } from "./pokeweb/moveAnimationModel";
import { buildMoveAnimationPreview } from "./pokeweb/moveAnimationPreviewModel";
import type { MoveAnimationBattleEnvironment } from "./pokeweb/moveAnimationBattleEnvironment";
import { parseNitroBackground } from "./pokeweb/nitroBg";
import { parseSpaArchive } from "./pokeweb/nitroSpa";
import { parsePwanHeader, pwanFrameRgbaImage, pwanTimeline } from "./pokeweb/pwanCompiler";
import type { RgbaImageData } from "./pokeweb/pokemonSpriteModel";
import type { ProjectState } from "./pokeweb/projectStore";
import { installMoveAnimationPreview, type MoveAnimationPreviewController } from "./ui/moveAnimationPreview";

type ViewerMove = { id: number; key: string; name: string; generation: number };
type ViewerPwanSide = { path: string; frames: number; timelineFrames: number; fps: number };
type ViewerSprite = {
  id: number;
  key: string;
  name: string;
  kind: string;
  speciesId: number;
  formIndex: number;
  assetIndex?: number;
  generation: number;
  credits: string;
  pwanChunk?: string;
  pwan: Partial<Record<"front" | "back", ViewerPwanSide>>;
  native: Partial<Record<"front" | "back", string>>;
};
type ArchiveEntry = { path: string; sha256: string; bytes: number };
type BattleModelEntry = ArchiveEntry & { resourceId: number };
type ViewerManifest = {
  format: string;
  version: number;
  sourceRomSha256: string;
  moves: ViewerMove[];
  sprites: ViewerSprite[];
  archives: Record<"moveAnimations" | "moveSpas" | "moveBackgrounds", ArchiveEntry>;
  battleEnvironment: {
    backgroundIndex: number;
    backgroundSeasonIndex: number;
    background: BattleModelEntry;
    platformIndex: number;
    platformSeasonIndex: number;
    platform: BattleModelEntry;
  };
};

type MoveData = {
  project: ProjectState;
  animations: NARC;
  spas: NARC;
  backgrounds: NARC;
  battleBackground: BattleModelScene;
  battlePlatform: BattleModelScene;
};

type LoadedSpriteSide =
  | { kind: "pwan"; image: RgbaImageData; bytes: Uint8Array; metadata: ViewerPwanSide }
  | { kind: "native"; image: RgbaImageData };

const status = requiredElement<HTMLElement>("viewer-status");
const spriteView = requiredElement<HTMLElement>("sprite-view");
const moveView = requiredElement<HTMLElement>("move-view");
const spriteSearch = requiredElement<HTMLInputElement>("sprite-search");
const moveSearch = requiredElement<HTMLInputElement>("move-search");
const spriteList = requiredElement<HTMLElement>("sprite-list");
const moveList = requiredElement<HTMLElement>("move-list");
const spriteCanvas = requiredElement<HTMLCanvasElement>("sprite-canvas");
const spriteName = requiredElement<HTMLElement>("sprite-name");
const spriteNumber = requiredElement<HTMLElement>("sprite-number");
const spriteFormat = requiredElement<HTMLElement>("sprite-format");
const spriteCredit = requiredElement<HTMLElement>("sprite-credit");
const moveName = requiredElement<HTMLElement>("move-name");
const moveNumber = requiredElement<HTMLElement>("move-number");
const moveStatus = requiredElement<HTMLElement>("move-status");
const movePreviewHost = requiredElement<HTMLElement>("move-preview-host");
const battlePokemon = requiredElement<HTMLSelectElement>("battle-pokemon");

let manifest: ViewerManifest;
let activeView: "sprites" | "moves" = "sprites";
let selectedSpriteId = 650;
let selectedMoveId = 560;
let selectedSide: "front" | "back" = "front";
let phaseIndex = 0;
let moveDataPromise: Promise<MoveData> | undefined;
let previewController: MoveAnimationPreviewController | undefined;
let previewSerial = 0;
let spriteSerial = 0;
let spriteAnimationFrame: number | undefined;
const imageCache = new Map<string, Promise<RgbaImageData>>();
const pwanChunkCache = new Map<string, Promise<Record<string, Uint8Array>>>();
const pwanSideCache = new Map<string, Promise<LoadedSpriteSide>>();
const pwanFrameCache = new WeakMap<Uint8Array, Map<number, RgbaImageData>>();
const spaCache = new Map<number, ReturnType<typeof parseSpaArchive>>();
const backgroundCache = new Map<number, ReturnType<typeof parseNitroBackground>>();

void initialize();

async function initialize(): Promise<void> {
  try {
    const response = await fetch("./data/viewer-manifest.json");
    if (!response.ok) throw new Error(`Animation manifest returned ${response.status}.`);
    manifest = (await response.json()) as ViewerManifest;
    if (manifest.format !== "white2expansion-animation-viewer" || manifest.version !== 3) {
      throw new Error("This animation viewer data bundle is not supported.");
    }

    const query = new URLSearchParams(window.location.search);
    activeView = query.get("view") === "moves" ? "moves" : "sprites";
    selectedSpriteId = validId(query.get("species"), manifest.sprites.map((entry) => entry.id))
      ?? manifest.sprites.find((entry) => entry.id === 650)?.id
      ?? manifest.sprites[0]?.id
      ?? 650;
    selectedMoveId = validId(query.get("move"), manifest.moves.map((entry) => entry.id)) ?? manifest.moves[0]?.id ?? 560;
    selectedSide = query.get("side") === "back" ? "back" : "front";

    battlePokemon.innerHTML = "";
    for (const sprite of manifest.sprites) {
      const option = document.createElement("option");
      option.value = String(sprite.id);
      option.textContent = sprite.formIndex > 0
        ? `${sprite.speciesId}.${sprite.formIndex} - ${sprite.name}`
        : `${sprite.speciesId} - ${sprite.name}`;
      option.selected = sprite.id === selectedSpriteId;
      battlePokemon.append(option);
    }

    wireControls();
    renderSpriteList();
    renderMoveList();
    showView(activeView, false);
    void renderSprite();
    const pwanCount = manifest.sprites.filter((entry) => Object.keys(entry.pwan).length > 0).length;
    status.textContent = `${manifest.sprites.length} Gen 6-9 sprite sets (${pwanCount} PWAN) and ${manifest.moves.length} move animations`;
    if (activeView === "moves") void renderMove(true);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add("is-error");
  }
}

function wireControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view === "moves" ? "moves" : "sprites"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSide = button.dataset.side === "back" ? "back" : "front";
      syncSideControls();
      void renderSprite();
      updateUrl();
    });
  });
  spriteSearch.addEventListener("input", renderSpriteList);
  moveSearch.addEventListener("input", renderMoveList);
  battlePokemon.addEventListener("change", () => {
    selectedSpriteId = Number(battlePokemon.value);
    renderSpriteList();
    void renderSprite();
    updateUrl();
    if (activeView === "moves") void renderMove(true);
  });
}

function showView(view: "sprites" | "moves", update = true): void {
  activeView = view;
  spriteView.hidden = view !== "sprites";
  moveView.hidden = view !== "moves";
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (update) updateUrl();
  if (view === "moves" && !previewController) void renderMove(true);
}

function renderSpriteList(): void {
  const query = normalizeSearch(spriteSearch.value);
  spriteList.replaceChildren();
  for (const sprite of manifest.sprites.filter((entry) => matchesSpriteSearch(entry, query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-row";
    button.classList.toggle("is-active", sprite.id === selectedSpriteId);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(sprite.id === selectedSpriteId));
    const number = sprite.formIndex > 0 ? `#${sprite.speciesId} F${sprite.formIndex}` : `#${sprite.speciesId}`;
    button.innerHTML = `<span>${escapeHtml(sprite.name)}</span><small>${number}</small>`;
    button.addEventListener("click", () => {
      selectedSpriteId = sprite.id;
      battlePokemon.value = String(sprite.id);
      renderSpriteList();
      void renderSprite();
      updateUrl();
    });
    spriteList.append(button);
  }
  setEmptyListMessage(spriteList);
}

function renderMoveList(): void {
  const query = normalizeSearch(moveSearch.value);
  moveList.replaceChildren();
  for (const move of manifest.moves.filter((entry) => matchesSearch(entry, query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-row";
    button.classList.toggle("is-active", move.id === selectedMoveId);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(move.id === selectedMoveId));
    button.innerHTML = `<span>${escapeHtml(move.name)}</span><small>#${move.id}</small>`;
    button.addEventListener("click", () => {
      selectedMoveId = move.id;
      phaseIndex = 0;
      renderMoveList();
      updateUrl();
      void renderMove(true);
    });
    moveList.append(button);
  }
  setEmptyListMessage(moveList);
}

async function renderSprite(): Promise<void> {
  const requestId = ++spriteSerial;
  stopSpriteAnimation();
  const sprite = selectedSprite();
  if (!sprite) return;
  if (!hasSpriteSide(sprite, selectedSide)) selectedSide = selectedSide === "front" ? "back" : "front";
  syncSideControls();
  spriteName.textContent = sprite.name;
  spriteNumber.textContent = sprite.formIndex > 0
    ? `Pokemon #${sprite.speciesId} / Form ${sprite.formIndex} / Gen ${sprite.generation}`
    : `Pokemon #${sprite.speciesId} / Gen ${sprite.generation}`;
  spriteFormat.textContent = `Loading ${selectedSide}`;
  spriteFormat.classList.remove("is-error");
  spriteCredit.textContent = sprite.credits ? `Credit: ${sprite.credits}` : "";
  clearSpriteCanvas();
  try {
    const loaded = await loadSpriteSide(sprite, selectedSide);
    if (requestId !== spriteSerial) return;
    if (loaded.kind === "pwan") {
      spriteFormat.textContent = `${capitalize(selectedSide)} / PWAN / ${loaded.metadata.timelineFrames} timeline frames / ${formatFps(loaded.metadata.fps)} FPS`;
      playPwan(loaded.bytes, requestId);
    } else {
      spriteFormat.textContent = `${capitalize(selectedSide)} / Native ROM fallback`;
      drawSpriteImage(loaded.image);
    }
  } catch (error) {
    if (requestId !== spriteSerial) return;
    spriteFormat.textContent = error instanceof Error ? error.message : String(error);
    spriteFormat.classList.add("is-error");
  }
}

async function renderMove(initialPlaying: boolean): Promise<void> {
  const requestId = ++previewSerial;
  previewController?.destroy();
  previewController = undefined;
  const move = manifest.moves.find((entry) => entry.id === selectedMoveId);
  const sprite = selectedSprite();
  if (!move || !sprite) return;
  moveName.textContent = move.name;
  moveNumber.textContent = `Move #${move.id} / Gen ${move.generation}`;
  moveStatus.textContent = "Loading ROM animation assets";
  moveStatus.classList.remove("is-error");
  movePreviewHost.innerHTML = '<div class="preview-loading">Building preview</div>';
  try {
    const data = await loadMoveData();
    const scriptBytes = data.animations.files[move.id];
    if (!scriptBytes) throw new Error(`Move animation ${move.id} is missing from the bundled ROM archive.`);
    const [userSprite, targetSprite] = await Promise.all([
      loadSpriteImage(sprite, "back"),
      loadSpriteImage(sprite, "front"),
    ]);
    const preview = await buildMoveAnimationPreview(data.project, move.id, decompileMoveAnimationBytes(scriptBytes), {
      phaseIndex,
      loadSpaArchive: async (_project, spaId) => {
        const cached = spaCache.get(spaId);
        if (cached) return cached;
        const bytes = data.spas.files[spaId];
        if (!bytes) throw new Error(`Move SPA ${spaId} is missing from the bundled ROM archive.`);
        const parsed = parseSpaArchive(bytes);
        spaCache.set(spaId, parsed);
        return parsed;
      },
      loadBackground: async (_project, backgroundId) => {
        const cached = backgroundCache.get(backgroundId);
        if (cached) return cached;
        const screen = data.backgrounds.files[backgroundId];
        const characters = data.backgrounds.files[backgroundId + 1];
        const palette = data.backgrounds.files[backgroundId + 2];
        if (!screen || !characters || !palette) throw new Error(`Move background ${backgroundId} is incomplete.`);
        const parsed = parseNitroBackground(backgroundId, screen, characters, palette, {
          paletteBankOffset: 8,
          transparentIndexZero: true,
        });
        backgroundCache.set(backgroundId, parsed);
        return parsed;
      },
    });
    if (requestId !== previewSerial) return;
    phaseIndex = preview.phaseIndex ?? 0;
    preview.battleEnvironment = {
      backgroundIndex: manifest.battleEnvironment.backgroundIndex,
      backgroundSeasonIndex: manifest.battleEnvironment.backgroundSeasonIndex,
      platformIndex: manifest.battleEnvironment.platformIndex,
      platformSeasonIndex: manifest.battleEnvironment.platformSeasonIndex,
      swappedSides: false,
      speciesId: sprite.speciesId,
      background: data.battleBackground,
      platform: data.battlePlatform,
      userSprite,
      targetSprite,
    } satisfies MoveAnimationBattleEnvironment;
    previewController = await installMoveAnimationPreview(movePreviewHost, preview, {
      initialPlaying,
      onPhaseChange: (nextPhase) => {
        phaseIndex = nextPhase;
        void renderMove(true);
      },
    });
    if (requestId !== previewSerial) {
      previewController.destroy();
      previewController = undefined;
      return;
    }
    moveStatus.textContent = `${preview.frameCount} frames / ${preview.spaIds.length} SPA archives / ${preview.warnings.length} preview warnings`;
  } catch (error) {
    if (requestId !== previewSerial) return;
    const message = error instanceof Error ? error.message : String(error);
    moveStatus.textContent = message;
    moveStatus.classList.add("is-error");
    movePreviewHost.innerHTML = `<div class="preview-loading is-error">${escapeHtml(message)}</div>`;
  }
}

function loadMoveData(): Promise<MoveData> {
  moveDataPromise ??= Promise.all([
    fetchBytes(manifest.archives.moveAnimations.path),
    fetchBytes(manifest.archives.moveSpas.path),
    fetchBytes(manifest.archives.moveBackgrounds.path),
    fetchBytes(manifest.battleEnvironment.background.path),
    fetchBytes(manifest.battleEnvironment.platform.path),
  ]).then(([animationBytes, spaBytes, backgroundBytes, battleBackgroundBytes, battlePlatformBytes]) => {
    const animations = new NARC(animationBytes);
    const spas = new NARC(spaBytes);
    const backgrounds = new NARC(backgroundBytes);
    const project = {
      narcs: {
        move_animations: {
          rawFiles: animations.files,
        },
      },
    } as unknown as ProjectState;
    return {
      project,
      animations,
      spas,
      backgrounds,
      battleBackground: decodeBattleModelScene(battleBackgroundBytes, manifest.battleEnvironment.background.resourceId),
      battlePlatform: decodeBattleModelScene(battlePlatformBytes, manifest.battleEnvironment.platform.resourceId),
    };
  });
  return moveDataPromise;
}

function loadSpriteSide(sprite: ViewerSprite, side: "front" | "back"): Promise<LoadedSpriteSide> {
  const key = `${sprite.id}:${side}`;
  let promise = pwanSideCache.get(key);
  if (!promise) {
    promise = (async () => {
      const pwan = sprite.pwan[side];
      if (pwan && sprite.pwanChunk) {
        const files = await loadPwanChunk(sprite.pwanChunk);
        const bytes = files[pwan.path];
        if (!bytes) throw new Error(`${sprite.name} ${side} is missing from ${sprite.pwanChunk}.`);
        return { kind: "pwan", image: cachedPwanFrame(bytes, 0), bytes, metadata: pwan };
      }
      const native = sprite.native[side];
      if (native) return { kind: "native", image: await loadRgbaImage(resolveAsset(native)) };
      throw new Error(`${sprite.name} does not have a ${side} sprite.`);
    })();
    pwanSideCache.set(key, promise);
  }
  return promise;
}

async function loadSpriteImage(sprite: ViewerSprite, preferredSide: "front" | "back"): Promise<RgbaImageData> {
  const side = hasSpriteSide(sprite, preferredSide) ? preferredSide : preferredSide === "front" ? "back" : "front";
  return (await loadSpriteSide(sprite, side)).image;
}

function loadPwanChunk(relativePath: string): Promise<Record<string, Uint8Array>> {
  let promise = pwanChunkCache.get(relativePath);
  if (!promise) {
    promise = fetchBytes(relativePath).then((bytes) => unzipSync(bytes));
    pwanChunkCache.set(relativePath, promise);
  }
  return promise;
}

async function fetchBytes(relativePath: string): Promise<Uint8Array> {
  const response = await fetch(resolveAsset(relativePath));
  if (!response.ok) throw new Error(`${relativePath} returned ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function loadRgbaImage(url: string): Promise<RgbaImageData> {
  let promise = imageCache.get(url);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          reject(new Error("Canvas image decoding is unavailable."));
          return;
        }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        resolve({ width: canvas.width, height: canvas.height, pixels });
      };
      image.onerror = () => reject(new Error(`Could not load ${url}.`));
      image.src = url;
    });
    imageCache.set(url, promise);
  }
  return promise;
}

function playPwan(bytes: Uint8Array, requestId: number): void {
  const header = parsePwanHeader(bytes);
  const timeline = pwanTimeline(bytes);
  if (timeline.length === 0 || header.totalTicks <= 0) {
    drawSpriteImage(cachedPwanFrame(bytes, 0));
    return;
  }
  let currentFrame = -1;
  const startedAt = performance.now();
  const draw = (now: number) => {
    if (requestId !== spriteSerial) return;
    const tick = ((now - startedAt) * 60 / 1000) % header.totalTicks;
    let elapsed = 0;
    let frameIndex = timeline[0]?.frameIndex ?? 0;
    for (const entry of timeline) {
      elapsed += Math.max(1, entry.ticks);
      if (tick < elapsed) {
        frameIndex = entry.frameIndex;
        break;
      }
    }
    if (frameIndex !== currentFrame) {
      currentFrame = frameIndex;
      drawSpriteImage(cachedPwanFrame(bytes, frameIndex));
    }
    spriteAnimationFrame = requestAnimationFrame(draw);
  };
  spriteAnimationFrame = requestAnimationFrame(draw);
}

function cachedPwanFrame(bytes: Uint8Array, frameIndex: number): RgbaImageData {
  let frames = pwanFrameCache.get(bytes);
  if (!frames) {
    frames = new Map();
    pwanFrameCache.set(bytes, frames);
  }
  let image = frames.get(frameIndex);
  if (!image) {
    image = pwanFrameRgbaImage(bytes, frameIndex);
    frames.set(frameIndex, image);
  }
  return image;
}

function drawSpriteImage(image: RgbaImageData): void {
  spriteCanvas.width = image.width;
  spriteCanvas.height = image.height;
  const context = spriteCanvas.getContext("2d");
  if (!context) return;
  const output = context.createImageData(image.width, image.height);
  output.data.set(image.pixels);
  context.putImageData(output, 0, 0);
}

function clearSpriteCanvas(): void {
  const context = spriteCanvas.getContext("2d");
  context?.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
}

function stopSpriteAnimation(): void {
  if (spriteAnimationFrame !== undefined) cancelAnimationFrame(spriteAnimationFrame);
  spriteAnimationFrame = undefined;
}

function syncSideControls(): void {
  const sprite = selectedSprite();
  document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((button) => {
    const side = button.dataset.side === "back" ? "back" : "front";
    const active = side === selectedSide;
    button.disabled = sprite ? !hasSpriteSide(sprite, side) : true;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function hasSpriteSide(sprite: ViewerSprite, side: "front" | "back"): boolean {
  return Boolean(sprite.pwan[side] || sprite.native[side]);
}

function selectedSprite(): ViewerSprite | undefined {
  return manifest.sprites.find((entry) => entry.id === selectedSpriteId);
}

function updateUrl(): void {
  const query = new URLSearchParams();
  query.set("view", activeView);
  query.set("species", String(selectedSpriteId));
  query.set("side", selectedSide);
  if (activeView === "moves") query.set("move", String(selectedMoveId));
  window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
}

function matchesSearch(entry: { id: number; name: string; key: string }, query: string): boolean {
  return !query || String(entry.id).includes(query) || entry.name.toLowerCase().includes(query) || entry.key.toLowerCase().includes(query);
}

function matchesSpriteSearch(entry: ViewerSprite, query: string): boolean {
  return matchesSearch(entry, query) || String(entry.speciesId).includes(query) || (entry.formIndex > 0 && `form ${entry.formIndex}`.includes(query));
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function validId(value: string | null, ids: number[]): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && ids.includes(id) ? id : undefined;
}

function resolveAsset(relativePath: string): string {
  return new URL(relativePath, window.location.href).href;
}

function setEmptyListMessage(host: HTMLElement): void {
  if (host.childElementCount > 0) return;
  const empty = document.createElement("p");
  empty.className = "library-empty";
  empty.textContent = "No matching entries";
  host.append(empty);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatFps(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
