import {
  loadBattleBackgroundCatalog,
  loadBattleBackgroundScene,
  type BattleBackgroundCatalog,
  type BattleBackgroundVariant,
} from "../pokeweb/battleBackgroundModel";
import type { BattleModelScene } from "../pokeweb/battleModelScene";
import {
  loadBattleEnvironmentUsage,
  type BattleEnvironmentLocationUsage,
  type BattleEnvironmentUsageCatalog,
} from "../pokeweb/battleEnvironmentUsage";
import {
  loadBattlePlatformCatalog,
  loadBattlePlatformScene,
  type BattlePlatformCatalog,
  type BattlePlatformVariant,
} from "../pokeweb/battlePlatformModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { loadBattleCamera } from "../pokeweb/battleCameraModel";
import { BattleEnvironmentControls, type BattleBackgroundEditorOptions } from "./battleEnvironmentControls";
import { battleSceneRule, loadBattleSceneSource, loadCombinedBattleScene, type BattleScene } from "../pokeweb/battleSceneModel";
import { BattleSceneView } from "./battleSceneView";
import { escapeHtml } from "./dom";
import { mountBattleBackgroundRenderer, type BattleBackgroundRenderer } from "./battleBackgroundRenderer";

type BattleViewerTab = "scene" | "backgrounds" | "platforms";

type CatalogLoadResult<T> =
  | { catalog: T; error?: undefined }
  | { catalog?: undefined; error: string };

export function renderBattleBackgroundEditor(project: ProjectState, root: HTMLElement, options: BattleBackgroundEditorOptions = {}): void {
  let renderer: BattleBackgroundRenderer | undefined;
  let loadToken = 0;
  let activeTab: BattleViewerTab = "scene";
  root.innerHTML = `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      ${renderTabs(activeTab)}
      <div class="battle-background-sidebar-loading">Reading the battle-background and platform tables…</div>
    </aside>
    <main class="pokemon-list battle-background-content">
      <section class="battle-background-empty"><h1>Loading 3D battle environments</h1><p>Decoding the NSBMD catalog from the loaded ROM.</p></section>
    </main>
  `;

  void Promise.all([
    settleCatalogLoad(loadBattleBackgroundCatalog(project)),
    settleCatalogLoad(loadBattlePlatformCatalog(project)),
    settleCatalogLoad(loadBattleEnvironmentUsage(project)),
    settleCatalogLoad(loadBattleCamera(project)),
    settleCatalogLoad(loadBattleSceneSource(project)),
  ])
    .then(([backgroundResult, platformResult, usageResult, cameraResult, sceneResult]) => {
      if (!root.isConnected) return;
      let view: BattleSceneView;
      const controls = new BattleEnvironmentControls(project, backgroundResult.catalog, platformResult.catalog,
        cameraResult.catalog, cameraResult.error, () => renderer, options, () => view.usePlacement());
      view = new BattleSceneView(() => renderer, () => controls.placementPose, () => controls.defaultPose,
        () => controls.cameraPresets, () => sceneResult.catalog?.programs ?? new Map(), () => battleSceneRule(project, controls.trainer));

      const loadScene = () => {
        const content = root.querySelector<HTMLElement>(".battle-background-content")!;
        content.innerHTML = '<section class="battle-background-empty"><h1>Battle scene</h1><p>Loading background and both platforms…</p></section>';
        const token = ++loadToken;
        void Promise.resolve().then(() => {
          if (!sceneResult.catalog || !controls.background) throw new Error(sceneResult.error ?? "Choose an available background.");
          return loadCombinedBattleScene(project, sceneResult.catalog, controls.background, controls.platform, controls.trainer);
        }).then(scene => {
          if (token !== loadToken || !content.isConnected) return;
          content.innerHTML = renderCombinedScene(scene, controls.background!.tableIndex);
          renderer = mountBattleBackgroundRenderer(content.querySelector<HTMLElement>("#battle-scene-canvas")!, scene.background, { platforms: scene.platforms, onInteract: () => view.free(), onPoseChange: pose => view.moved(pose) });
          view.mount(content.querySelector<HTMLElement>("[data-battle-scene-views]")!);
          content.querySelector("#battle-scene-reset")?.addEventListener("click", () => view.usePlacement());
          content.querySelector("#battle-scene-fit")?.addEventListener("click", () => { view.free(); renderer?.fitModel(); view.beforeSceneChange(); });
          view.refresh();
        }).catch(error => {
          if (token === loadToken && content.isConnected) content.innerHTML = `<section class="battle-background-empty -error"><h1>Battle scene unavailable</h1><p>${escapeHtml(errorMessage(error))}</p></section>`;
        });
      };

      const loadBackground = (
        editorRoot: HTMLElement,
        editorProject: ProjectState,
        catalog: BattleBackgroundCatalog,
        variant: BattleBackgroundVariant,
      ) => {
        renderer?.dispose();
        renderer = undefined;
        const content = editorRoot.querySelector<HTMLElement>(".battle-background-content");
        if (!content) return;
        content.innerHTML = renderBackgroundLoading(variant);
        const token = ++loadToken;
        void loadBattleBackgroundScene(editorProject, variant.resourceId)
          .then((scene) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderBackgroundLoaded(variant, scene, catalog);
            drawTexturePreviews(content, scene);
            renderer = mountSceneRenderer(content, scene, "background");
            controls.previewCamera();
          })
          .catch((error) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderBackgroundError(variant, errorMessage(error));
          });
      };

      const loadPlatform = (
        editorRoot: HTMLElement,
        editorProject: ProjectState,
        catalog: BattlePlatformCatalog,
        variant: BattlePlatformVariant,
      ) => {
        renderer?.dispose();
        renderer = undefined;
        const content = editorRoot.querySelector<HTMLElement>(".battle-background-content");
        if (!content) return;
        content.innerHTML = renderPlatformLoading(variant);
        const token = ++loadToken;
        void loadBattlePlatformScene(editorProject, variant.resourceId)
          .then((scene) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderPlatformLoaded(variant, scene, catalog);
            drawTexturePreviews(content, scene);
            renderer = mountSceneRenderer(content, scene, "platform");
            controls.previewCamera();
          })
          .catch((error) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderPlatformError(variant, errorMessage(error));
          });
      };

      const showTab = (tab: BattleViewerTab) => {
        view.beforeSceneChange();
        activeTab = tab;
        renderer?.dispose();
        renderer = undefined;
        loadToken += 1;
        root.innerHTML = `
          <aside class="pokemon-filter battle-background-sidebar">
            <div class="filter-title">Battle Backgrounds</div>${renderTabs(activeTab)}
            <div class="battle-environment-controls-host"></div>
            <div class="battle-environment-usage-sidebar-host"></div>
          </aside>
          <main class="pokemon-list battle-background-content"></main>`;
        bindTabs(root, showTab);
        controls.mount(root.querySelector<HTMLElement>(".battle-environment-controls-host")!, () => showTab(activeTab));
        const content = root.querySelector<HTMLElement>(".battle-background-content")!;
        if (activeTab === "scene") {
          if (controls.background) updateSidebarLocationUsage(root, "background", controls.background.tableIndex, usageResult.catalog, usageResult.error);
          loadScene();
        } else if (activeTab === "backgrounds") {
          if (backgroundResult.catalog && controls.background) {
            updateSidebarLocationUsage(root, "background", controls.background.tableIndex, usageResult.catalog, usageResult.error);
            loadBackground(root, project, backgroundResult.catalog, controls.background);
          } else content.innerHTML = `<section class="battle-background-empty -error"><h1>Battle backgrounds unavailable</h1><p>${escapeHtml(backgroundResult.error ?? "No renderable backgrounds.")}</p></section>`;
        } else if (platformResult.catalog && controls.platform) {
          updateSidebarLocationUsage(root, "platform", controls.platform.tableIndex, usageResult.catalog, usageResult.error);
          loadPlatform(root, project, platformResult.catalog, controls.platform);
        } else content.innerHTML = `<section class="battle-background-empty"><h1>Automatic platform</h1><p>${escapeHtml(platformResult.error ?? "Choose a platform to preview it.")}</p></section>`;
      };

      showTab(activeTab);
    })
    .catch((error) => {
      if (!root.isConnected) return;
      root.innerHTML = `
        <aside class="pokemon-filter battle-background-sidebar"><div class="filter-title">Battle Backgrounds</div>${renderTabs("backgrounds")}</aside>
        <main class="pokemon-list battle-background-content">
          <section class="battle-background-empty -error"><h1>Battle backgrounds unavailable</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section>
        </main>
      `;
    });
}

function bindTabs(root: HTMLElement, showTab: (tab: BattleViewerTab) => void): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-battle-viewer-tab]")) {
    button.addEventListener("click", () => showTab(button.dataset.battleViewerTab as BattleViewerTab));
  }
}

function mountSceneRenderer(content: HTMLElement, scene: BattleModelScene, prefix: "background" | "platform"): BattleBackgroundRenderer | undefined {
  const host = content.querySelector<HTMLElement>(`#battle-${prefix}-canvas`);
  if (!host) return undefined;
  const renderer = mountBattleBackgroundRenderer(host, scene);
  content.querySelector<HTMLButtonElement>(`#battle-${prefix}-reset`)?.addEventListener("click", renderer.resetBattleCamera);
  content.querySelector<HTMLButtonElement>(`#battle-${prefix}-fit`)?.addEventListener("click", renderer.fitModel);
  return renderer;
}

function renderTabs(activeTab: BattleViewerTab): string {
  return `
    <div class="battle-background-tabs" role="tablist" aria-label="Battle background viewer">
      <button type="button" role="tab" data-battle-viewer-tab="scene" aria-selected="${activeTab === "scene"}" class="${activeTab === "scene" ? "-active" : ""}">Scene</button>
      <button type="button" role="tab" data-battle-viewer-tab="backgrounds" aria-selected="${activeTab === "backgrounds"}" class="${activeTab === "backgrounds" ? "-active" : ""}">Backgrounds</button>
      <button type="button" role="tab" data-battle-viewer-tab="platforms" aria-selected="${activeTab === "platforms"}" class="${activeTab === "platforms" ? "-active" : ""}">Battle Platforms</button>
    </div>
  `;
}

export function settleCatalogLoad<T>(promise: Promise<T>): Promise<CatalogLoadResult<T>> {
  return promise.then(
    (catalog) => ({ catalog }),
    (error: unknown) => ({ error: errorMessage(error) }),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderBackgroundLoading(variant: BattleBackgroundVariant): string {
  return `<section class="battle-background-viewer">${renderBackgroundHeader(variant)}<div class="battle-background-loading">Decoding NSBMD geometry and textures…</div></section>`;
}

function renderPlatformLoading(variant: BattlePlatformVariant): string {
  return `<section class="battle-background-viewer">${renderPlatformHeader(variant)}<div class="battle-background-loading">Decoding platform NSBMD geometry and textures…</div></section>`;
}

function renderBackgroundLoaded(
  variant: BattleBackgroundVariant,
  scene: Awaited<ReturnType<typeof loadBattleBackgroundScene>>,
  catalog: BattleBackgroundCatalog,
): string {
  return `
    <section class="battle-background-viewer">
      ${renderBackgroundHeader(variant)}
      ${renderPreviewCard("background")}
      <div class="battle-background-metadata">
        ${metadataItem("Table entry", String(variant.tableIndex))}
        ${metadataItem("Season slot", variant.seasonName)}
        ${metadataItem("NSBMD resource", String(scene.resourceId))}
        ${metadataItem("Geometry", geometryLabel(scene))}
        ${metadataItem("Textures", String(scene.textureCount))}
        ${metadataItem("Mesh family", scene.shapeKind === "standard" ? "Standard field" : scene.shapeKind === "non-standard" ? "Non-standard / custom" : "Unknown")}
        ${metadataItem("Graphics archive", catalog.graphicsPath)}
        ${metadataItem("Lookup archive", catalog.tablePath)}
        ${metadataItem("Model bounds", boundsLabel(scene.bounds))}
      </div>
      ${renderTextureGallery(scene)}
      ${renderWarnings(scene)}
    </section>
  `;
}

function renderPlatformLoaded(
  variant: BattlePlatformVariant,
  scene: Awaited<ReturnType<typeof loadBattlePlatformScene>>,
  catalog: BattlePlatformCatalog,
): string {
  return `
    <section class="battle-background-viewer">
      ${renderPlatformHeader(variant)}
      ${renderPreviewCard("platform")}
      <div class="battle-background-metadata">
        ${metadataItem("Platform table index", String(variant.tableIndex))}
        ${metadataItem("Season", `${variant.seasonName}${variant.modelFallback ? " · Spring model fallback" : ""}`)}
        ${metadataItem("Player model", String(scene.resourceId))}
        ${variant.opponentResourceId === undefined ? "" : metadataItem("Opponent model", String(variant.opponentResourceId))}
        ${metadataItem("Geometry", geometryLabel(scene))}
        ${metadataItem("Textures", String(scene.textureCount))}
        ${metadataItem("Model bounds", boundsLabel(scene.bounds))}
        ${edgeColorMetadata(variant.edgeColor)}
        ${variant.nsbcaResourceId === undefined ? "" : metadataItem("NSBCA resource", String(variant.nsbcaResourceId))}
        ${variant.nsbtaResourceId === undefined ? "" : metadataItem("NSBTA resource", String(variant.nsbtaResourceId))}
        ${variant.nsbmaResourceId === undefined ? "" : metadataItem("NSBMA resource", String(variant.nsbmaResourceId))}
        ${metadataItem("Graphics archive", catalog.graphicsPath)}
        ${metadataItem("Lookup archive", `${catalog.tablePath} · member 2`)}
      </div>
      ${renderTextureGallery(scene)}
      ${renderWarnings(scene)}
    </section>
  `;
}

function updateSidebarLocationUsage(
  root: HTMLElement,
  kind: "background" | "platform",
  tableIndex: number,
  usageCatalog?: BattleEnvironmentUsageCatalog,
  usageError?: string,
): void {
  const host = root.querySelector<HTMLElement>(".battle-environment-usage-sidebar-host");
  if (!host) return;
  const usages = (kind === "background" ? usageCatalog?.backgrounds : usageCatalog?.platforms)?.get(tableIndex) ?? [];
  host.innerHTML = renderSidebarLocationUsage(kind, tableIndex, usages, usageError);
}

function renderSidebarLocationUsage(
  kind: "background" | "platform",
  tableIndex: number,
  usages: BattleEnvironmentLocationUsage[],
  usageError?: string,
): string {
  const headerCount = usages.reduce((count, usage) => count + usage.headerIndexes.length, 0);
  const summary = usageError
    ? `<div class="battle-environment-usage-empty -error">Location lookup unavailable: ${escapeHtml(usageError)}</div>`
    : usages.length === 0
      ? `<div class="battle-environment-usage-empty">No loaded map header can resolve to this ${kind} table entry.</div>`
      : `<div class="battle-environment-usage-list">${usages.map(renderLocationUsageCard).join("")}</div>`;
  return `
    <section class="battle-environment-usage">
      <header>
        <div><span>Header → zone-spec lookup</span><h2>Used in locations</h2></div>
        <p>${usageError ? "Could not trace the loaded headers." : `${usages.length} location${usages.length === 1 ? "" : "s"} · ${headerCount} header${headerCount === 1 ? "" : "s"} can select ${kind} ${tableIndex}.`}</p>
      </header>
      ${summary}
      <footer>Resolved from each header's background type and the current terrain. Seasonal slots share this mapping.</footer>
    </section>
  `;
}

function renderLocationUsageCard(usage: BattleEnvironmentLocationUsage): string {
  const headers = usage.headerIndexes.map((headerIndex) => `Header ${headerIndex}`).join(", ");
  return `
    <article class="battle-environment-usage-card">
      <div class="battle-environment-usage-location"><strong>${escapeHtml(usage.locationName)}</strong><span>${escapeHtml(headers)}</span></div>
      <div class="battle-environment-usage-routes">
        ${usage.routes.map((route) => `
          <div><strong>${escapeHtml(route.battleBackgroundTypeName)}</strong><span>${escapeHtml(route.attributeNames.join(" · "))}</span></div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderPreviewCard(prefix: "background" | "platform" | "scene"): string {
  return `
    <article class="battle-background-preview-card">
      <div class="battle-background-toolbar">
        <div><strong>Interactive 3D Preview</strong>${prefix === "scene" ? "" : "<span>Drag to orbit · scroll to zoom · R resets · F fits</span>"}</div>
        <div class="battle-background-toolbar-actions">
          <button class="btn -default" id="battle-${prefix}-reset" type="button">${prefix === "scene" ? "Reset view" : "Battle Camera"}</button>
          <button class="btn -default" id="battle-${prefix}-fit" type="button">${prefix === "scene" ? "Fit scene" : "Fit Model"}</button>
        </div>
      </div>
      ${prefix === "scene" ? '<div data-battle-scene-views></div>' : ""}
      <div class="battle-background-canvas" id="battle-${prefix}-canvas"></div>
    </article>
  `;
}

function renderCombinedScene(scene: BattleScene, backgroundIndex: number): string {
  const formats = ["Singles", "Doubles", "Triples", "Rotation"];
  return `<section class="battle-background-viewer -scene">
    <header class="battle-background-header"><div><h1>Battle scene</h1></div><div class="battle-background-header-badges"><span>Background ${backgroundIndex}</span><span>${scene.rule === 3 ? "Rotation platforms" : `Platform ${scene.platformIndex}`}</span><span>${formats[scene.rule] ?? "Singles"}</span></div></header>
    ${renderPreviewCard("scene")}
    <div class="battle-background-metadata">${metadataItem("Background resource", String(scene.background.resourceId))}${metadataItem("Player platform", String(scene.platforms[0].model.resourceId))}${metadataItem("Opponent platform", String(scene.platforms[1].model.resourceId))}${metadataItem("Platform season", ["Spring", "Summer", "Autumn", "Winter"][scene.platformSeason])}</div>
    ${renderWarnings(scene.background)}
  </section>`;
}

function renderBackgroundError(variant: BattleBackgroundVariant, message: string): string {
  return `<section class="battle-background-viewer">${renderBackgroundHeader(variant)}<div class="battle-background-error">${escapeHtml(message)}</div></section>`;
}

function renderPlatformError(variant: BattlePlatformVariant, message: string): string {
  return `<section class="battle-background-viewer">${renderPlatformHeader(variant)}<div class="battle-background-error">${escapeHtml(message)}</div></section>`;
}

function renderBackgroundHeader(variant: BattleBackgroundVariant): string {
  const shapeLabel = variant.shapeKind === "standard" ? "Standard field mesh" : variant.shapeKind === "non-standard" ? "Non-standard mesh" : "Unclassified mesh";
  return `
    <header class="battle-background-header">
      <div><h1>${escapeHtml(backgroundVariantLabel(variant))}</h1></div>
      <div class="battle-background-header-badges">
        <span class="battle-background-shape-badge -${variant.shapeKind}">${escapeHtml(shapeLabel)}</span>
        <code>BMD0 · ${variant.resourceId}</code>
      </div>
    </header>
  `;
}

function renderPlatformHeader(variant: BattlePlatformVariant): string {
  return `
    <header class="battle-background-header">
      <div><h1>${escapeHtml(platformVariantLabel(variant))}</h1></div>
      <div class="battle-background-header-badges">
        <span class="battle-background-shape-badge -platform">Single-model preview</span>
        <code>BMD0 · ${variant.resourceId}</code>
      </div>
    </header>
  `;
}

function renderTextureGallery(scene: BattleModelScene): string {
  return `
    <section class="battle-background-textures">
      <header>
        <div><span>Embedded TEX0 resources</span><h2>Related textures</h2></div>
        <p>Indexes are the texture dictionary positions inside NSBMD member ${scene.resourceId}.</p>
      </header>
      <div class="battle-background-texture-grid">${scene.textures.map(renderTextureCard).join("")}</div>
    </section>
  `;
}

function renderTextureCard(texture: BattleModelScene["textures"][number]): string {
  const palettes = texture.palettes.length
    ? texture.palettes.map((palette) => `<code>#${palette.index} ${escapeHtml(palette.name)}</code>`).join(" ")
    : texture.format === 7
      ? "Direct-color texture"
      : "No palette binding found";
  const bindings = texture.bindings.length
    ? texture.bindings
        .map((binding) => `<span>Model ${binding.modelIndex} · Material #${binding.materialIndex} <code>${escapeHtml(binding.materialName)}</code></span>`)
        .join("")
    : "<span>Not referenced by a model material</span>";
  return `
    <article class="battle-background-texture-card">
      <div class="battle-background-texture-preview ${texture.image ? "" : "-empty"}">
        ${texture.image ? `<canvas data-battle-texture-index="${texture.index}" aria-label="Preview of texture ${escapeHtml(texture.name)}"></canvas>` : "Preview unavailable"}
      </div>
      <div class="battle-background-texture-body">
        <div class="battle-background-texture-index">Texture #${texture.index}</div>
        <h3>${escapeHtml(texture.name)}</h3>
        <div class="battle-background-texture-facts">
          <span>${texture.width} × ${texture.height}</span>
          <span>${escapeHtml(textureFormatLabel(texture.format))}</span>
          <span>${formatBytes(texture.byteLength)}</span>
        </div>
        <dl><dt>Palette</dt><dd>${palettes}</dd><dt>Material bindings</dt><dd class="battle-background-texture-bindings">${bindings}</dd></dl>
      </div>
    </article>
  `;
}

function drawTexturePreviews(content: HTMLElement, scene: BattleModelScene): void {
  for (const canvas of content.querySelectorAll<HTMLCanvasElement>("canvas[data-battle-texture-index]")) {
    const index = Number(canvas.dataset.battleTextureIndex);
    const texture = scene.textures.find((candidate) => candidate.index === index);
    if (!texture?.image) continue;
    canvas.width = texture.image.width;
    canvas.height = texture.image.height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.imageSmoothingEnabled = false;
    context.putImageData(new ImageData(new Uint8ClampedArray(texture.image.rgba), texture.image.width, texture.image.height), 0, 0);
  }
}

function renderWarnings(scene: BattleModelScene): string {
  return scene.warnings.length
    ? `<details class="battle-background-warnings"><summary>${scene.warnings.length} decoder warning${scene.warnings.length === 1 ? "" : "s"}</summary>${scene.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</details>`
    : "";
}

function backgroundVariantLabel(variant: BattleBackgroundVariant): string {
  const entry = String(variant.tableIndex).padStart(2, "0");
  return variant.variantCount > 1 ? `Background ${entry} · ${variant.seasonName}` : `Background ${entry}`;
}

function platformVariantLabel(variant: BattlePlatformVariant): string {
  const entry = String(variant.tableIndex).padStart(2, "0");
  return variant.variantCount > 1 ? `Platform ${entry} · ${variant.seasonName}` : `Platform ${entry}`;
}

function metadataItem(label: string, value: string): string {
  return `<div class="battle-background-metadata-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function edgeColorMetadata(value: number): string {
  const hex = `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
  return `<div class="battle-background-metadata-item"><span>Stage edge color</span><strong class="battle-platform-edge-color"><i style="background:${edgeColorCss(value)}"></i>${hex}</strong></div>`;
}

function edgeColorCss(value: number): string {
  const channel = (shift: number) => Math.round(((value >>> shift) & 0x1f) * 255 / 31);
  return `rgb(${channel(0)} ${channel(5)} ${channel(10)})`;
}

function geometryLabel(scene: BattleModelScene): string {
  return `${scene.primitiveCount} draw call${scene.primitiveCount === 1 ? "" : "s"} · ${formatNumber(scene.triangleCount)} triangles`;
}

function boundsLabel(bounds: BattleModelScene["bounds"]): string {
  return `${formatDecimal(bounds.maxX - bounds.minX)} × ${formatDecimal(bounds.maxY - bounds.minY)} × ${formatDecimal(bounds.maxZ - bounds.minZ)}`;
}

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function textureFormatLabel(format: number): string {
  const labels = ["No texture", "A3I5", "2-color", "16-color", "256-color", "4×4 compressed", "A5I3", "Direct color"];
  return `Format ${format} · ${labels[format] ?? "Unknown"}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KiB`;
}
