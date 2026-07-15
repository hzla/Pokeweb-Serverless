import {
  loadBattleBackgroundCatalog,
  loadBattleBackgroundScene,
  type BattleBackgroundCatalog,
  type BattleBackgroundVariant,
} from "../pokeweb/battleBackgroundModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { mountBattleBackgroundRenderer, type BattleBackgroundRenderer } from "./battleBackgroundRenderer";

export function renderBattleBackgroundEditor(project: ProjectState, root: HTMLElement): void {
  let renderer: BattleBackgroundRenderer | undefined;
  let loadToken = 0;
  root.innerHTML = `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      <div class="battle-background-sidebar-loading">Reading the battle-background tables…</div>
    </aside>
    <main class="pokemon-list battle-background-content">
      <section class="battle-background-empty"><h1>Loading 3D battle environments</h1><p>Decoding the NSBMD catalog from the loaded ROM.</p></section>
    </main>
  `;

  void loadBattleBackgroundCatalog(project)
    .then((catalog) => {
      if (!root.isConnected) return;
      let selected = catalog.variants[0];
      root.innerHTML = renderPage(catalog, selected);
      const select = root.querySelector<HTMLSelectElement>("#battle-background-select");
      const loadSelected = () => {
        const next = catalog.variants.find((variant) => variantKey(variant) === select?.value) ?? catalog.variants[0];
        if (!next) return;
        selected = next;
        renderer?.dispose();
        renderer = undefined;
        const content = root.querySelector<HTMLElement>(".battle-background-content");
        if (!content) return;
        content.innerHTML = renderLoading(selected);
        const token = ++loadToken;
        void loadBattleBackgroundScene(project, selected.resourceId)
          .then((scene) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderLoaded(selected, scene, catalog);
            drawTexturePreviews(content, scene);
            const host = content.querySelector<HTMLElement>("#battle-background-canvas");
            if (!host) return;
            renderer = mountBattleBackgroundRenderer(host, scene);
            content.querySelector<HTMLButtonElement>("#battle-background-reset")?.addEventListener("click", () => renderer?.resetBattleCamera());
            content.querySelector<HTMLButtonElement>("#battle-background-fit")?.addEventListener("click", () => renderer?.fitModel());
          })
          .catch((error) => {
            if (token !== loadToken || !content.isConnected) return;
            content.innerHTML = renderError(selected, error instanceof Error ? error.message : String(error));
          });
      };
      select?.addEventListener("change", loadSelected);
      loadSelected();
    })
    .catch((error) => {
      if (!root.isConnected) return;
      root.innerHTML = `
        <aside class="pokemon-filter battle-background-sidebar"><div class="filter-title">Battle Backgrounds</div></aside>
        <main class="pokemon-list battle-background-content">
          <section class="battle-background-empty -error"><h1>Battle backgrounds unavailable</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section>
        </main>
      `;
    });
}

function renderPage(catalog: BattleBackgroundCatalog, selected: BattleBackgroundVariant): string {
  const nonStandardIds = [...new Set(catalog.variants.filter((variant) => variant.shapeKind === "non-standard").map((variant) => variant.tableIndex))].sort(
    (left, right) => left - right,
  );
  return `
    <aside class="pokemon-filter battle-background-sidebar">
      <div class="filter-title">Battle Backgrounds</div>
      <label class="battle-background-selector" for="battle-background-select">
        <span>Background</span>
        <select class="filter-input" id="battle-background-select">
          ${catalog.variants.map((variant) => `<option value="${variantKey(variant)}" ${variantKey(variant) === variantKey(selected) ? "selected" : ""}>${escapeHtml(`${variantLabel(variant)}${variant.shapeKind === "non-standard" ? " · custom mesh" : ""}`)}</option>`).join("")}
        </select>
      </label>
      <div class="battle-background-catalog-summary">
        <strong>${catalog.tableEntryCount}</strong>
        <span>background table entries</span>
        <small>${catalog.variants.length} renderable model variant${catalog.variants.length === 1 ? "" : "s"} · ${catalog.graphicsEntryCount} battle assets</small>
      </div>
      <section class="battle-background-shape-summary">
        <div class="battle-background-sidebar-title">Non-standard field meshes</div>
        <strong>${escapeHtml(formatIndexRanges(nonStandardIds))}</strong>
        <p>These entries use location-specific geometry instead of the regular <code>batt_field</code>/<code>batt_fd</code> arena family.</p>
      </section>
      <section class="battle-background-format-note">
        <div class="battle-background-sidebar-title">How the game stores these</div>
        <p>Each environment is an NSBMD model with embedded Nitro textures. The table can also reference NSBCA, NSBTA, and NSBMA animation resources.</p>
        <p>The battlefield platforms are separate stage models; this page previews the surrounding field model selected by the game.</p>
      </section>
    </aside>
    <main class="pokemon-list battle-background-content">${renderLoading(selected)}</main>
  `;
}

function renderLoading(variant: BattleBackgroundVariant): string {
  return `
    <section class="battle-background-viewer">
      ${renderHeader(variant)}
      <div class="battle-background-loading">Decoding NSBMD geometry and textures…</div>
    </section>
  `;
}

function renderLoaded(
  variant: BattleBackgroundVariant,
  scene: Awaited<ReturnType<typeof loadBattleBackgroundScene>>,
  catalog: BattleBackgroundCatalog,
): string {
  return `
    <section class="battle-background-viewer">
      ${renderHeader(variant)}
      <article class="battle-background-preview-card">
        <div class="battle-background-toolbar">
          <div>
            <strong>Interactive 3D Preview</strong>
            <span>Drag to orbit · scroll to zoom · R resets · F fits</span>
          </div>
          <div class="battle-background-toolbar-actions">
            <button class="btn -default" id="battle-background-reset" type="button">Battle Camera</button>
            <button class="btn -default" id="battle-background-fit" type="button">Fit Model</button>
          </div>
        </div>
        <div class="battle-background-canvas" id="battle-background-canvas"></div>
      </article>
      <div class="battle-background-metadata">
        ${metadataItem("Table entry", String(variant.tableIndex))}
        ${metadataItem("Season slot", variant.seasonName)}
        ${metadataItem("NSBMD resource", String(scene.resourceId))}
        ${metadataItem("Geometry", `${scene.primitiveCount} draw call${scene.primitiveCount === 1 ? "" : "s"} · ${formatNumber(scene.triangleCount)} triangles`)}
        ${metadataItem("Textures", String(scene.textureCount))}
        ${metadataItem("Mesh family", scene.shapeKind === "standard" ? "Standard field" : scene.shapeKind === "non-standard" ? "Non-standard / custom" : "Unknown")}
        ${metadataItem("Graphics archive", catalog.graphicsPath)}
        ${metadataItem("Lookup archive", catalog.tablePath)}
        ${metadataItem("Model bounds", boundsLabel(scene.bounds))}
      </div>
      ${renderTextureGallery(scene)}
      ${scene.warnings.length ? `<details class="battle-background-warnings"><summary>${scene.warnings.length} decoder warning${scene.warnings.length === 1 ? "" : "s"}</summary>${scene.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</details>` : ""}
    </section>
  `;
}

function renderError(variant: BattleBackgroundVariant, message: string): string {
  return `
    <section class="battle-background-viewer">
      ${renderHeader(variant)}
      <div class="battle-background-error">${escapeHtml(message)}</div>
    </section>
  `;
}

function renderHeader(variant: BattleBackgroundVariant): string {
  const shapeLabel = variant.shapeKind === "standard" ? "Standard field mesh" : variant.shapeKind === "non-standard" ? "Non-standard mesh" : "Unclassified mesh";
  return `
    <header class="battle-background-header">
      <div><span>Nitro 3D field environment</span><h1>${escapeHtml(variantLabel(variant))}</h1></div>
      <div class="battle-background-header-badges">
        <span class="battle-background-shape-badge -${variant.shapeKind}">${escapeHtml(shapeLabel)}</span>
        <code>BMD0 · ${variant.resourceId}</code>
      </div>
    </header>
  `;
}

function renderTextureGallery(scene: Awaited<ReturnType<typeof loadBattleBackgroundScene>>): string {
  return `
    <section class="battle-background-textures">
      <header>
        <div><span>Embedded TEX0 resources</span><h2>Related textures</h2></div>
        <p>Indexes are the texture dictionary positions inside NSBMD member ${scene.resourceId}.</p>
      </header>
      <div class="battle-background-texture-grid">
        ${scene.textures.map(renderTextureCard).join("")}
      </div>
    </section>
  `;
}

function renderTextureCard(texture: Awaited<ReturnType<typeof loadBattleBackgroundScene>>["textures"][number]): string {
  const palettes = texture.palettes.length
    ? texture.palettes.map((palette) => `<code>#${palette.index} ${escapeHtml(palette.name)}</code>`).join(" ")
    : texture.format === 7
      ? "Direct-color texture"
      : "No palette binding found";
  const bindings = texture.bindings.length
    ? texture.bindings
        .map(
          (binding) =>
            `<span>Model ${binding.modelIndex} · Material #${binding.materialIndex} <code>${escapeHtml(binding.materialName)}</code></span>`,
        )
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
        <dl>
          <dt>Palette</dt><dd>${palettes}</dd>
          <dt>Material bindings</dt><dd class="battle-background-texture-bindings">${bindings}</dd>
        </dl>
      </div>
    </article>
  `;
}

function drawTexturePreviews(content: HTMLElement, scene: Awaited<ReturnType<typeof loadBattleBackgroundScene>>): void {
  for (const canvas of content.querySelectorAll<HTMLCanvasElement>("canvas[data-battle-texture-index]")) {
    const index = Number(canvas.dataset.battleTextureIndex);
    const texture = scene.textures.find((candidate) => candidate.index === index);
    if (!texture?.image) continue;
    canvas.width = texture.image.width;
    canvas.height = texture.image.height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.imageSmoothingEnabled = false;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(texture.image.rgba), texture.image.width, texture.image.height),
      0,
      0,
    );
  }
}

function variantLabel(variant: BattleBackgroundVariant): string {
  const entry = String(variant.tableIndex).padStart(2, "0");
  return variant.variantCount > 1 ? `Background ${entry} · ${variant.seasonName}` : `Background ${entry}`;
}

function variantKey(variant: BattleBackgroundVariant): string {
  return `${variant.tableIndex}:${variant.seasonIndex}:${variant.resourceId}`;
}

function metadataItem(label: string, value: string): string {
  return `<div class="battle-background-metadata-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function boundsLabel(bounds: Awaited<ReturnType<typeof loadBattleBackgroundScene>>["bounds"]): string {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const depth = bounds.maxZ - bounds.minZ;
  return `${formatDecimal(width)} × ${formatDecimal(height)} × ${formatDecimal(depth)}`;
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
