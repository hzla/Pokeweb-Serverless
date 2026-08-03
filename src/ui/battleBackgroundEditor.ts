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
import { escapeHtml } from "./dom";
import { mountBattleBackgroundRenderer, type BattleBackgroundRenderer } from "./battleBackgroundRenderer";

type BattleViewerTab = "backgrounds" | "platforms";

type CatalogLoadResult<T> =
  | { catalog: T; error?: undefined }
  | { catalog?: undefined; error: string };

export function renderBattleBackgroundEditor(project: ProjectState, root: HTMLElement): void {
  let renderer: BattleBackgroundRenderer | undefined;
  let loadToken = 0;
  let activeTab: BattleViewerTab = "backgrounds";
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
  ])
    .then(([backgroundResult, platformResult, usageResult]) => {
      if (!root.isConnected) return;
      let selectedBackground = backgroundResult.catalog?.variants[0];
      let selectedPlatform = platformResult.catalog?.variants[0];

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
          })
          .catch((error) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderPlatformError(variant, errorMessage(error));
          });
      };

      const showTab = (tab: BattleViewerTab) => {
        activeTab = tab;
        renderer?.dispose();
        renderer = undefined;
        loadToken += 1;
        if (activeTab === "backgrounds") {
          const backgroundCatalog = backgroundResult.catalog;
          const fallbackBackground = backgroundCatalog?.variants[0];
          if (!backgroundCatalog || !fallbackBackground) {
            root.innerHTML = renderCatalogUnavailablePage(
              activeTab,
              "Battle backgrounds unavailable",
              backgroundResult.error ?? "The battle-background table does not contain any renderable entries.",
            );
            bindTabs(root, showTab);
            return;
          }
          selectedBackground ??= fallbackBackground;
          root.innerHTML = renderBackgroundPage(backgroundCatalog, selectedBackground, activeTab);
          bindTabs(root, showTab);
          const select = root.querySelector<HTMLSelectElement>("#battle-background-select");
          const loadSelected = () => {
            selectedBackground =
              backgroundCatalog.variants.find((variant) => backgroundVariantKey(variant) === select?.value) ?? fallbackBackground;
            updateSidebarLocationUsage(root, "background", selectedBackground.tableIndex, usageResult.catalog, usageResult.error);
            loadBackground(root, project, backgroundCatalog, selectedBackground);
          };
          select?.addEventListener("change", loadSelected);
          loadSelected();
          return;
        }

        const platformCatalog = platformResult.catalog;
        const fallbackPlatform = platformCatalog?.variants[0];
        if (!platformCatalog || !fallbackPlatform) {
          root.innerHTML = renderCatalogUnavailablePage(
            activeTab,
            "Battle platforms unavailable",
            platformResult.error ?? "The stage table does not contain any renderable platform entries.",
          );
          bindTabs(root, showTab);
          return;
        }
        selectedPlatform ??= fallbackPlatform;
        root.innerHTML = renderPlatformPage(platformCatalog, selectedPlatform, activeTab);
        bindTabs(root, showTab);
        const select = root.querySelector<HTMLSelectElement>("#battle-platform-select");
        const loadSelected = () => {
          selectedPlatform =
            platformCatalog.variants.find((variant) => platformVariantKey(variant) === select?.value) ?? fallbackPlatform;
          updateSidebarLocationUsage(root, "platform", selectedPlatform.tableIndex, usageResult.catalog, usageResult.error);
          loadPlatform(root, project, platformCatalog, selectedPlatform);
        };
        select?.addEventListener("change", loadSelected);
        loadSelected();
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
    button.addEventListener("click", () => showTab(button.dataset.battleViewerTab === "platforms" ? "platforms" : "backgrounds"));
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
      <button type="button" role="tab" data-battle-viewer-tab="backgrounds" aria-selected="${activeTab === "backgrounds"}" class="${activeTab === "backgrounds" ? "-active" : ""}">Backgrounds</button>
      <button type="button" role="tab" data-battle-viewer-tab="platforms" aria-selected="${activeTab === "platforms"}" class="${activeTab === "platforms" ? "-active" : ""}">Battle Platforms</button>
    </div>
  `;
}

function renderCatalogUnavailablePage(activeTab: BattleViewerTab, title: string, message: string): string {
  return `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      ${renderTabs(activeTab)}
    </aside>
    <main class="pokemon-list battle-background-content">
      <section class="battle-background-empty -error"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>The other catalog can still be viewed from its tab.</p></section>
    </main>
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

function renderBackgroundPage(catalog: BattleBackgroundCatalog, selected: BattleBackgroundVariant, activeTab: BattleViewerTab): string {
  const nonStandardIds = [...new Set(catalog.variants.filter((variant) => variant.shapeKind === "non-standard").map((variant) => variant.tableIndex))].sort(
    (left, right) => left - right,
  );
  return `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      ${renderTabs(activeTab)}
      <label class="battle-background-selector" for="battle-background-select">
        <span>Background</span>
        <select class="filter-input" id="battle-background-select">
          ${catalog.variants.map((variant) => `<option value="${backgroundVariantKey(variant)}" ${backgroundVariantKey(variant) === backgroundVariantKey(selected) ? "selected" : ""}>${escapeHtml(`${backgroundVariantLabel(variant)}${variant.shapeKind === "non-standard" ? " · custom mesh" : ""}`)}</option>`).join("")}
        </select>
      </label>
      <div class="battle-background-catalog-summary">
        <strong>${catalog.tableEntryCount}</strong>
        <span>background table entries</span>
        <small>${catalog.variants.length} renderable model variant${catalog.variants.length === 1 ? "" : "s"} · ${catalog.graphicsEntryCount} battle assets</small>
      </div>
      <div class="battle-environment-usage-sidebar-host"></div>
      <section class="battle-background-shape-summary">
        <div class="battle-background-sidebar-title">Non-standard field meshes</div>
        <strong>${escapeHtml(formatIndexRanges(nonStandardIds))}</strong>
        <p>These entries use location-specific geometry instead of the regular <code>batt_field</code>/<code>batt_fd</code> arena family.</p>
      </section>
      <section class="battle-background-format-note">
        <div class="battle-background-sidebar-title">How the game stores these</div>
        <p>Each environment is an NSBMD model with embedded Nitro textures. The table can also reference NSBCA, NSBTA, and NSBMA animation resources.</p>
        <p>Battle platforms remain separate stage models and are not baked into this preview.</p>
      </section>
    </aside>
    <main class="pokemon-list battle-background-content">${renderBackgroundLoading(selected)}</main>
  `;
}

function renderPlatformPage(catalog: BattlePlatformCatalog, selected: BattlePlatformVariant, activeTab: BattleViewerTab): string {
  const omitted = catalog.tableEntryCount - catalog.renderableEntryCount;
  return `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      ${renderTabs(activeTab)}
      <label class="battle-background-selector" for="battle-platform-select">
        <span>Platform</span>
        <select class="filter-input" id="battle-platform-select">
          ${catalog.variants.map((variant) => `<option value="${platformVariantKey(variant)}" ${platformVariantKey(variant) === platformVariantKey(selected) ? "selected" : ""}>${escapeHtml(platformVariantLabel(variant))}</option>`).join("")}
        </select>
      </label>
      <div class="battle-background-catalog-summary -platforms">
        <strong>${catalog.renderableEntryCount}</strong>
        <span>renderable platform entries</span>
        <small>${catalog.variants.length} distinct seasonal variant${catalog.variants.length === 1 ? "" : "s"} · ${catalog.tableEntryCount} table entries${omitted > 0 ? ` · ${omitted} without a renderable NSBMD` : ""}</small>
      </div>
      <div class="battle-environment-usage-sidebar-host"></div>
      <section class="battle-platform-object-note">
        <div class="battle-background-sidebar-title">One resource, two objects</div>
        <p>The game creates player-side and opponent-side platform objects from the selected stage resource. This viewer shows one model.</p>
      </section>
      <section class="battle-background-format-note">
        <div class="battle-background-sidebar-title">Rotation battles</div>
        <p>Rotation battles use the special <code>batt_st_vs3</code> model and animation instead of the normal stage-table selection shown here.</p>
      </section>
    </aside>
    <main class="pokemon-list battle-background-content">${renderPlatformLoading(selected)}</main>
  `;
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
      <div class="battle-platform-preview-note">Single-model preview: the game positions separate player-side and opponent-side objects from this same stage resource.</div>
      <div class="battle-background-metadata">
        ${metadataItem("Platform table index", String(variant.tableIndex))}
        ${metadataItem("Season", `${variant.seasonName}${variant.modelFallback ? " · Spring model fallback" : ""}`)}
        ${metadataItem("NSBMD member", String(scene.resourceId))}
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

function renderPreviewCard(prefix: "background" | "platform"): string {
  return `
    <article class="battle-background-preview-card">
      <div class="battle-background-toolbar">
        <div><strong>Interactive 3D Preview</strong><span>Drag to orbit · scroll to zoom · R resets · F fits</span></div>
        <div class="battle-background-toolbar-actions">
          <button class="btn -default" id="battle-${prefix}-reset" type="button">Battle Camera</button>
          <button class="btn -default" id="battle-${prefix}-fit" type="button">Fit Model</button>
        </div>
      </div>
      <div class="battle-background-canvas" id="battle-${prefix}-canvas"></div>
    </article>
  `;
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
      <div><span>Nitro 3D field environment</span><h1>${escapeHtml(backgroundVariantLabel(variant))}</h1></div>
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
      <div><span>Nitro 3D battle platform</span><h1>${escapeHtml(platformVariantLabel(variant))}</h1></div>
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

function backgroundVariantKey(variant: BattleBackgroundVariant): string {
  return `${variant.tableIndex}:${variant.seasonIndex}:${variant.resourceId}`;
}

function platformVariantKey(variant: BattlePlatformVariant): string {
  return `${variant.tableIndex}:${variant.seasonIndex}:${variant.resourceId}`;
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

function formatIndexRanges(indexes: number[]): string {
  if (indexes.length === 0) return "None detected";
  const ranges: string[] = [];
  let start = indexes[0] ?? 0;
  let end = start;
  for (const index of indexes.slice(1)) {
    if (index === end + 1) {
      end = index;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}–${end}`);
    start = index;
    end = index;
  }
  ranges.push(start === end ? String(start) : `${start}–${end}`);
  return ranges.join(", ");
}
