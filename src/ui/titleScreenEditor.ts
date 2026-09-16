import {
  decodeTitleComposition, decodeTitleModel, exportTitleBundle, importTitleAssets,
  loadTitleScreenDocument, readTitleBundle, titleAnimationFrames, titleCameraFrame,
  type TitleAsset, type TitleComposition, type TitleScreenDocument,
} from "../pokeweb/titleScreenModel";
import { nitroCellEffectFrameAt } from "../pokeweb/nitroCell";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { mountBattleBackgroundRenderer, type BattleBackgroundRenderer } from "./battleBackgroundRenderer";
import { advanceTitleFrame, compileTitleScene, TITLE_IDLE_START, TITLE_LAST_FRAME, type TitleScene } from "../pokeweb/titleScreenScene";
import { mountTitleSceneRenderer } from "./titleSceneRenderer";

let disposeEditor: (() => void) | undefined;
export function stopTitleScreenEditor(): void { disposeEditor?.(); disposeEditor = undefined; }

export function renderTitleScreenEditor(project: ProjectState, root: HTMLElement, options: { onDirty: () => void; onPreview: () => Promise<void> }): void {
  stopTitleScreenEditor();
  let disposed = false, busy = false, playing = false;
  let document: TitleScreenDocument;
  let composition: TitleComposition;
  let selected = "scene", frame = 0, cameraFrame = 7300, sceneFrame = TITLE_IDLE_START, idleOnly = true;
  let status = "", isError = false;
  let renderer: BattleBackgroundRenderer | undefined;
  let sceneRenderer: ReturnType<typeof mountTitleSceneRenderer> | undefined;
  let scene: TitleScene | undefined;
  let animationRequest = 0, lastTick = 0;
  let layerImages: Record<string, HTMLCanvasElement> = {};
  disposeEditor = () => { disposed = true; playing = false; cancelAnimationFrame(animationRequest); renderer?.dispose(); sceneRenderer?.dispose(); };
  root.innerHTML = `<main class="title-editor"><section class="title-card"><h1>Title Screen</h1><p>Loading title assets…</p></section></main>`;

  function setStatus(message: string, error = false): void {
    status = message; isError = error;
    const element = root.querySelector<HTMLElement>(".title-status");
    if (element) { element.textContent = message; element.classList.toggle("-error", error); }
  }

  function render(): void {
    if (disposed) return;
    renderer?.dispose(); renderer = undefined;
    sceneRenderer?.dispose(); sceneRenderer = undefined;
    cancelAnimationFrame(animationRequest);
    root.innerHTML = `<main class="title-editor">
      <header class="title-page-header"><div><span class="title-eyebrow">${document.version === "B2" ? "Black 2" : "White 2"} · Title assets</span><h1>Title Screen</h1><p>Inspect the title, exchange native assets, and preview your changes in game.</p></div>
        <div class="title-toolbar"><button class="btn -default" data-action="export-bundle">Export bundle</button><button class="btn -default" data-action="import-bundle">Import bundle</button><button class="btn -primary" data-action="preview-game">Preview in game ↗</button></div>
      </header>
      <div class="title-status ${isError ? "-error" : ""}" role="status" aria-live="polite">${escapeHtml(status)}</div>
      <div class="title-layout"><aside class="title-sidebar">
        <button class="title-nav ${selected === "scene" ? "-active" : ""}" data-select="scene">Bottom-screen animation</button>
        <button class="title-nav ${selected === "composition" ? "-active" : ""}" data-select="composition">2D composition</button>
        <button class="title-nav ${selected === "camera" ? "-active" : ""}" data-select="camera">Camera inspector</button>
        ${["2D graphics", "3D scene"].map((group, groupIndex) => `<h2>${group}</h2>${document.assets.filter((asset) => (asset.path === "a/0/2/6") === (groupIndex === 0) && asset.id !== "camera").map((asset) => `<button class="title-nav ${selected === asset.id ? "-active" : ""}" data-select="${asset.id}"><span>${escapeHtml(asset.label)}${asset.changed ? ` <i title="Changed from original ROM">●</i>` : ""}</span><small>${asset.format} · #${asset.member}</small></button>`).join("")}`).join("")}
        <p class="title-muted">${document.assets.length} native assets<br>${document.assets.filter((asset) => asset.changed).length} changed from original ROM</p>
      </aside><section class="title-detail">${selected === "scene" ? sceneHtml() : selected === "composition" ? compositionHtml() : assetHtml(document.assets.find((asset) => asset.id === selected)!)}</section></div>
      <input hidden type="file" id="title-native-input"><input hidden type="file" id="title-bundle-input" accept=".zip,application/zip">
    </main>`;
    root.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((button) => button.addEventListener("click", () => { playing = false; selected = button.dataset.select!; render(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => button.addEventListener("click", () => void action(button.dataset.action!)));
    root.querySelector<HTMLInputElement>("#title-native-input")?.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      const id = selected;
      if (file) void runImport(async () => new Map([[id, await readFile(file)]]));
    });
    root.querySelector<HTMLInputElement>("#title-bundle-input")?.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) void runImport(async () => readTitleBundle(await readFile(file), document.version));
    });
    if (selected === "scene") {
      hydrateScene();
    } else if (selected === "composition") {
      root.querySelector<HTMLInputElement>("#title-frame")?.addEventListener("input", (event) => { frame = Number((event.target as HTMLInputElement).value); drawComposition(); });
      drawComposition();
      if (playing) { lastTick = performance.now(); animationRequest = requestAnimationFrame(tick); }
    } else if (selected === "camera") {
      const updateFrame = (event: Event) => {
        const input = event.target as HTMLInputElement;
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < 0 || value >= document.camera.frameCount) { input.value = String(cameraFrame); return; }
        cameraFrame = value; drawCamera();
      };
      root.querySelector<HTMLInputElement>("#title-camera-frame")?.addEventListener("input", updateFrame);
      root.querySelector<HTMLInputElement>("#title-camera-number")?.addEventListener("change", updateFrame);
      drawCamera();
    } else hydrateAsset(document.assets.find((asset) => asset.id === selected)!);
    updateBusy();
  }

  function sceneHtml(): string {
    return `<section class="title-card"><div class="title-section-header"><div><h2>Bottom-screen animation</h2><p>Kyurem, its reflection, and the animated environment through the game's recorded camera.</p></div><span class="title-scene-badge">256 × 192 · 60 fps</span></div>
      <div class="title-screen-wrap"><div class="title-bottom-screen"><div id="title-scene-host"></div><canvas id="title-scene-credits" width="256" height="192" aria-label="Game Freak credit overlay"></canvas></div></div>
      <div class="title-playback"><button class="btn -default" data-action="play">${playing ? "Pause" : "Play"}</button><label for="title-scene-number">Frame</label><input id="title-scene-number" type="number" min="0" max="7780" value="${sceneFrame}" step="1"><span id="title-scene-time" class="title-muted"></span></div>
      <input id="title-scene-frame" class="title-scene-slider" type="range" aria-label="Animation frame" min="0" max="7780" step="1" value="${sceneFrame}">
      <div class="title-toolbar title-scene-controls"><label><input id="title-idle-only" type="checkbox" ${idleOnly ? "checked" : ""}> Loop idle (7300–7780)</label><button class="btn -default" data-action="scene-start">Sequence start</button><button class="btn -default" data-action="scene-cry">Cry pose</button><button class="btn -default" data-action="scene-idle">Idle start</button></div>
      <p class="title-muted">Scrub or play the original animation. The camera follows the saved track. Screen swaps, fades, sound, and DS rasterization are available in Preview in game.</p><p id="title-scene-error" role="alert"></p></section>`;
  }

  function hydrateScene(): void {
    try {
      scene ??= compileTitleScene(document);
      sceneRenderer = mountTitleSceneRenderer(root.querySelector<HTMLElement>("#title-scene-host")!, scene, document.camera);
      const updateFrame = (event: Event) => {
        const input = event.target as HTMLInputElement, value = Number(input.value);
        if (!input.value) return;
        if (!Number.isInteger(value) || value < 0 || value >= scene!.frameCount) { input.value = String(sceneFrame); return; }
        sceneFrame = value;
        if (sceneFrame < TITLE_IDLE_START) { idleOnly = false; root.querySelector<HTMLInputElement>("#title-idle-only")!.checked = false; }
        lastTick = performance.now(); drawScene();
      };
      root.querySelector<HTMLInputElement>("#title-scene-frame")!.addEventListener("input", updateFrame);
      root.querySelector<HTMLInputElement>("#title-scene-number")!.addEventListener("input", updateFrame);
      root.querySelector<HTMLInputElement>("#title-idle-only")!.addEventListener("change", (event) => {
        idleOnly = (event.target as HTMLInputElement).checked;
        if (idleOnly && sceneFrame < TITLE_IDLE_START) sceneFrame = Math.min(TITLE_IDLE_START, scene!.frameCount - 1);
        lastTick = performance.now(); drawScene();
      });
      drawScene();
    } catch (error) {
      sceneRenderer?.dispose(); sceneRenderer = undefined; playing = false;
      root.querySelector("#title-scene-error")!.textContent = `Preview unavailable: ${errorMessage(error)}`;
    }
  }

  function drawScene(): void {
    if (!sceneRenderer || !scene) return;
    sceneFrame = Math.min(sceneFrame, scene.frameCount - 1);
    sceneRenderer.draw(sceneFrame);
    const end = Math.min(TITLE_LAST_FRAME, scene.frameCount - 1);
    for (const id of ["title-scene-frame", "title-scene-number"]) { const input = root.querySelector<HTMLInputElement>(`#${id}`)!; input.value = String(sceneFrame); input.max = String(end); }
    root.querySelector("#title-scene-time")!.textContent = `${(sceneFrame / 60).toFixed(2)} s`;
    const credits = root.querySelector<HTMLCanvasElement>("#title-scene-credits")!, ctx = credits.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 192);
    if (sceneFrame >= TITLE_IDLE_START) ctx.drawImage(layerImages.credits, 0, 0);
  }

  function compositionHtml(): string {
    return `<section class="title-card"><div class="title-section-header"><div><h2>2D composition</h2><p>Logo, scrolling background, and animated Press Start.</p></div><button class="btn -default" data-action="export-composition">Export screen PNG</button></div>
      <div class="title-screen-wrap"><canvas id="title-top-screen" width="256" height="192" aria-label="Title logo screen preview"></canvas></div>
      <div class="title-playback"><button class="btn -default" data-action="play">${playing ? "Pause" : "Play 2D"}</button><label for="title-frame">Frame <output id="title-frame-value">${frame}</output></label><input id="title-frame" type="range" min="0" max="7780" step="1" value="${frame}"></div>
      <p class="title-muted">This view previews the 2D layers. Choose Bottom-screen animation for the 3D scene, or Preview in game for screen swaps and transitions.</p></section>
      <section class="title-card"><h2>Export individual layers</h2><div class="title-layer-grid">${[["logo", "Logo"], ["background", "Scrolling background"], ["credits", "Game Freak credit layer"], ["prompt", "Press Start frame"]].map(([id, label]) => `<figure><canvas data-layer="${id}" aria-label="${label}"></canvas><figcaption>${label}</figcaption><button class="btn -default" data-action="png-${id}">Export PNG</button></figure>`).join("")}</div><p class="title-muted">The logo and scrolling background share tiles and a palette. PNG exports are for external editing; this version imports native resources.</p></section>`;
  }

  function assetHtml(asset: TitleAsset): string {
    const camera = asset.format === "camera";
    let description = camera ? "Inspect the game camera's recorded position and rotation. Values are read-only in this version." : "Export this native resource, edit it externally, and import the compiled replacement.";
    if (asset.format.startsWith("NSB")) description += " Keep model/animation bindings and the 7,781-frame title timeline compatible.";
    return `<section class="title-card"><div class="title-section-header"><div><h2>${escapeHtml(asset.label)}</h2><p>${description}</p></div><div class="title-toolbar"><button class="btn -default" data-action="export-native">Export native</button><button class="btn -default" data-action="import-native">Import native</button></div></div>
      <dl class="title-metadata"><div><dt>File</dt><dd>${escapeHtml(asset.filename)}</dd></div><div><dt>Archive / member</dt><dd>${asset.path} / ${asset.member}</dd></div><div><dt>Format</dt><dd>${camera ? "Camera binary" : asset.format}</dd></div><div><dt>ROM storage</dt><dd>${asset.compressed ? "LZ10 compressed" : "Uncompressed"}</dd></div><div><dt>Native size</dt><dd>${asset.bytes.length.toLocaleString()} bytes</dd></div><div><dt>Status</dt><dd>${asset.changed ? "Changed" : "Original"}</dd></div></dl>
      ${camera ? cameraHtml() : `<div id="title-asset-preview"></div>`}
      <p class="title-muted">Native exports are decompressed. Required ROM compression is restored on import. Use Export ROM to save project changes to an .nds file.</p></section>`;
  }

  function cameraHtml(): string {
    return `<h3>Camera track · ${document.camera.frameCount.toLocaleString()} frames</h3><div class="title-playback"><label for="title-camera-number">Frame</label><input id="title-camera-number" type="number" min="0" max="${document.camera.frameCount - 1}" step="1" value="${cameraFrame}"><input id="title-camera-frame" aria-label="Camera frame" type="range" min="0" max="${document.camera.frameCount - 1}" value="${cameraFrame}"></div>
      <div class="title-toolbar"><button class="btn -default" data-action="camera-start">First frame</button><button class="btn -default" data-action="camera-idle">Idle loop (7300)</button><button class="btn -default" data-action="camera-json">Export camera JSON</button></div>
      <div id="title-camera-values"></div><p class="title-muted">Rotation is measured in degrees. Camera scrubbing inspects the track; it does not animate the model viewer.</p>`;
  }

  function drawCamera(): void {
    const values = titleCameraFrame(document.camera, cameraFrame);
    for (const id of ["title-camera-frame", "title-camera-number"]) { const input = root.querySelector<HTMLInputElement>(`#${id}`); if (input) input.value = String(cameraFrame); }
    const host = root.querySelector<HTMLElement>("#title-camera-values");
    if (host) host.innerHTML = `<table class="title-values"><thead><tr><th>Channel</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>${[["Position", values.position], ["Rotation (°)", values.rotation], ["Scale", values.scale]].filter(([, value]) => value).map(([name, value]) => `<tr><th>${name}</th>${(value as number[]).map((number) => `<td>${number.toFixed(5)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function drawComposition(): void {
    const top = root.querySelector<HTMLCanvasElement>("#title-top-screen");
    const context = top?.getContext("2d");
    if (!context || !top) return;
    context.imageSmoothingEnabled = false;
    const [r, g, b] = composition.logo.indexed.palette[0];
    context.fillStyle = `rgb(${r},${g},${b})`; context.fillRect(0, 0, 256, 192);
    const offset = ((Math.trunc((document.version === "B2" ? frame : -frame) / 2) % 256) + 256) % 256;
    context.drawImage(layerImages.background, -offset, 0); context.drawImage(layerImages.background, 256 - offset, 0);
    context.drawImage(layerImages.logo, 0, 0);
    const prompt = nitroCellEffectFrameAt(composition.prompt, frame);
    if (prompt) {
      const canvas = rgbaCanvas(prompt.width, prompt.height, prompt.rgba);
      context.save(); context.translate(128 + prompt.x, 96 + prompt.y); context.rotate(prompt.rotation * Math.PI / 180); context.scale(prompt.xScale, prompt.yScale); context.drawImage(canvas, -prompt.width / 2, -prompt.height / 2); context.restore();
      layerImages.prompt = canvas;
    }
    root.querySelectorAll<HTMLCanvasElement>("[data-layer]").forEach((canvas) => {
      const source = layerImages[canvas.dataset.layer!];
      canvas.width = source.width; canvas.height = source.height;
      canvas.getContext("2d")?.drawImage(source, 0, 0);
    });
    const slider = root.querySelector<HTMLInputElement>("#title-frame"); if (slider) slider.value = String(frame);
    const output = root.querySelector("#title-frame-value"); if (output) output.textContent = String(frame);
  }

  function tick(now: number): void {
    if (disposed || !playing || !["composition", "scene"].includes(selected)) return;
    const advance = Math.floor((now - lastTick) * 60 / 1000);
    if (advance) {
      lastTick += advance * 1000 / 60;
      if (selected === "scene" && sceneRenderer && scene) {
        const end = Math.min(TITLE_LAST_FRAME, scene.frameCount - 1), start = idleOnly ? Math.min(TITLE_IDLE_START, end) : 0;
        sceneFrame = advanceTitleFrame(sceneFrame, advance, start, end); drawScene();
      } else { frame = (frame + advance) % 7781; drawComposition(); }
    }
    animationRequest = requestAnimationFrame(tick);
  }

  function hydrateAsset(asset: TitleAsset): void {
    const host = root.querySelector<HTMLElement>("#title-asset-preview");
    if (!host) return;
    try {
      if (asset.format === "NSBMD") {
        const scene = decodeTitleModel(asset, document.assets.find((a) => a.id === `${asset.id}-animation`), document.assets.find((a) => a.id === `${asset.id}-texture-animation`));
        host.innerHTML = `<h3>Model inspection · idle pose</h3><p class="title-muted">Drag to orbit, scroll to zoom, press F to fit. Bones and weighted parts are evaluated at frame 7300. Choose Bottom-screen animation to see the complete scene in motion.</p><div class="title-model-host"></div><p>${scene.triangleCount.toLocaleString()} decoded triangles · ${scene.textureCount} textures</p><h3>Textures</h3><div class="title-layer-grid" id="title-textures"></div>`;
        renderer = mountBattleBackgroundRenderer(host.querySelector<HTMLElement>(".title-model-host")!, scene, { nativeColors: true });
        renderer.fitModel();
        host.querySelector("canvas")?.setAttribute("aria-label", `Static ${asset.label} inspection`);
        const textures = host.querySelector("#title-textures")!;
        for (const texture of scene.textures) {
          if (!texture.image) continue;
          const figure = window.document.createElement("figure");
          const canvas = rgbaCanvas(texture.width, texture.height, texture.image.rgba);
          const caption = window.document.createElement("figcaption"); caption.textContent = `${texture.name} · ${texture.width}×${texture.height}`;
          const button = window.document.createElement("button"); button.className = "btn -default"; button.textContent = "Export PNG"; button.addEventListener("click", () => savePng(canvas, `${asset.id}-${texture.name.replace(/[^\w.-]/g, "_")}.png`));
          figure.append(canvas, caption, button); textures.append(figure);
        }
      } else if (asset.format === "NSBCA" || asset.format === "NSBTA") {
        host.innerHTML = `<h3>${titleAnimationFrames(asset.bytes).toLocaleString()} animation frames</h3><p>Choose Bottom-screen animation to play this track with the title scene.</p>`;
      } else {
        const key = asset.id.startsWith("credits") ? "credits" : asset.id.startsWith("prompt") ? "prompt" : asset.id.startsWith("background") ? "background" : "logo";
        host.innerHTML = `<h3>Related layer</h3><div class="title-related-layer"></div><button class="btn -default" id="title-related-png">Export layer PNG</button>`;
        const source = layerImages[key];
        const canvas = window.document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height; canvas.getContext("2d")?.drawImage(source, 0, 0);
        host.querySelector(".title-related-layer")!.append(canvas);
        host.querySelector("#title-related-png")!.addEventListener("click", () => savePng(canvas, `${document.version}-${key}.png`));
      }
    } catch (error) { host.textContent = `Preview unavailable: ${errorMessage(error)}`; }
  }

  async function action(name: string): Promise<void> {
    if (busy) return;
    const asset = document.assets.find((candidate) => candidate.id === selected);
    try {
      if (name === "export-bundle") download(exportTitleBundle(document), `${document.version}-title.zip`, "application/zip");
      else if (name === "import-bundle") root.querySelector<HTMLInputElement>("#title-bundle-input")!.click();
      else if (name === "export-native" && asset) download(asset.bytes, asset.filename);
      else if (name === "import-native" && asset) {
        const input = root.querySelector<HTMLInputElement>("#title-native-input")!; input.accept = `.${asset.format === "camera" ? "bin" : asset.format.toLowerCase()},.bin`; input.value = ""; input.click();
      } else if (name === "export-composition") savePng(root.querySelector<HTMLCanvasElement>("#title-top-screen")!, `${document.version}-title-logo-screen.png`);
      else if (name.startsWith("png-")) savePng(layerImages[name.slice(4)], `${document.version}-${name.slice(4)}.png`);
      else if (name === "play") {
        if (selected === "scene" && !sceneRenderer) return;
        playing = !playing; cancelAnimationFrame(animationRequest);
        root.querySelector<HTMLButtonElement>('[data-action="play"]')!.textContent = playing ? "Pause" : selected === "scene" ? "Play" : "Play 2D";
        if (playing) { lastTick = performance.now(); animationRequest = requestAnimationFrame(tick); }
      }
      else if (name.startsWith("scene-") && sceneRenderer) {
        sceneFrame = name === "scene-start" ? 0 : name === "scene-cry" ? 7001 : TITLE_IDLE_START;
        idleOnly = name === "scene-idle"; root.querySelector<HTMLInputElement>("#title-idle-only")!.checked = idleOnly;
        lastTick = performance.now(); drawScene();
      }
      else if (name === "camera-start" || name === "camera-idle") { cameraFrame = name === "camera-start" ? 0 : Math.min(7300, document.camera.frameCount - 1); drawCamera(); }
      else if (name === "camera-json") {
        const data = { game: document.version, frameCount: document.camera.frameCount, rotationUnits: "degrees", frames: Array.from({ length: document.camera.frameCount }, (_, index) => ({ frame: index, ...titleCameraFrame(document.camera, index) })) };
        download(new TextEncoder().encode(JSON.stringify(data, null, 2)), `${document.version}-title-camera.json`, "application/json");
      } else if (name === "preview-game") {
        busy = true; updateBusy(); setStatus("Building a temporary ROM for the title preview…");
        // Invoke while the click still has activation, so the launcher can open its tab.
        await options.onPreview();
        if (!disposed) setStatus("Preview opened. The game boots normally; press Enter to skip the opening movie and reach the title.");
      }
    } catch (error) { if (!disposed) setStatus(errorMessage(error), true); }
    finally { busy = false; if (!disposed) updateBusy(); }
  }

  async function runImport(read: () => Promise<Map<string, Uint8Array>>): Promise<void> {
    if (busy) return;
    busy = true; updateBusy(); setStatus("Validating native title assets…");
    try {
      const imports = await read();
      if (disposed) return;
      const count = await importTitleAssets(project, imports);
      if (count) options.onDirty();
      if (disposed) return;
      await reload();
      if (!disposed) { setStatus(count ? `Imported ${count} native asset${count === 1 ? "" : "s"}. Changes are saved with your project.` : "All imported assets already match the project."); render(); }
    } catch (error) { if (!disposed) setStatus(errorMessage(error), true); }
    finally { busy = false; if (!disposed) updateBusy(); }
  }

  function updateBusy(): void {
    root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.disabled = busy);
    root.querySelectorAll<HTMLInputElement>("input").forEach((input) => input.disabled = busy);
  }

  async function reload(): Promise<void> {
    const loaded = await loadTitleScreenDocument(project);
    if (disposed) return;
    document = loaded; composition = decodeTitleComposition(document); scene = undefined; playing = false;
    cameraFrame = Math.min(cameraFrame, document.camera.frameCount - 1);
    layerImages = Object.fromEntries(["logo", "background", "credits"].map((key) => {
      const image = composition[key as "logo" | "background" | "credits"];
      return [key, rgbaCanvas(image.width, image.height, image.rgba)];
    }));
    const prompt = nitroCellEffectFrameAt(composition.prompt, frame)!;
    layerImages.prompt = rgbaCanvas(prompt.width, prompt.height, prompt.rgba);
  }

  void reload().then(() => { if (!disposed) render(); }).catch((error) => {
    if (!disposed) root.innerHTML = `<main class="title-editor"><section class="title-card"><h1>Title Screen unavailable</h1><p role="alert">${escapeHtml(errorMessage(error))}</p></section></main>`;
  });
}

function rgbaCanvas(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}
function savePng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => { if (blob) downloadBlob(blob, filename); }, "image/png");
}
function download(bytes: Uint8Array, filename: string, type = "application/octet-stream"): void { downloadBlob(new Blob([new Uint8Array(bytes).buffer], { type }), filename); }
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readFile(file: File): Promise<Uint8Array> {
  if (file.size > 16 * 1024 * 1024) throw new Error("Title imports are limited to 16 MiB.");
  return new Uint8Array(await file.arrayBuffer());
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
