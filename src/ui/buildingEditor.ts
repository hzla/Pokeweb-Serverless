import { buildingLibraryScene, exportBuildingGlb, loadBuildingLibrary, type BuildingLibrary, type BuildingLibraryAsset } from "../pokeweb/buildingLibraryModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { createBuildingLibraryPreview } from "./map3dEditor";
import { applyBuildingImport, prepareBuildingImport, type BuildingImport } from "../pokeweb/buildingImportModel";
import { openTestBattleEmulator } from "../pokeweb/testBattleEmulatorLauncher";

export function renderBuildingEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="pokemon-filter map3d-sidebar">
      <div class="filter-title">Buildings</div>
      <input class="filter-input" id="buildings-search" type="search" aria-label="Search building models" placeholder="Search name, UID, or bundle" disabled />
      <label class="map3d-field">Type<select class="filter-input" id="buildings-kind" aria-label="Building type" disabled><option value="all">All buildings</option><option value="exterior">Exterior</option><option value="interior">Interior</option></select></label>
      <label class="map3d-field">Bundle<select class="filter-input" id="buildings-bundle" aria-label="Building bundle" disabled><option value="all">All bundles</option></select></label>
      <div id="buildings-count" class="map3d-building-note">Loading building library…</div>
      <select class="filter-input building-library-list" id="buildings-list" size="10" aria-label="Building models" disabled></select>
      <div class="map3d-building-actions"><button class="ow-tool" id="buildings-prev" type="button" disabled>Previous</button><button class="ow-tool" id="buildings-next" type="button" disabled>Next</button></div>
      <section class="map3d-building-inspector" id="buildings-details" aria-label="Building details">Choose a building to preview its model and textures.</section>
      <section id="buildings-import-review" class="map3d-building-inspector" aria-label="Review building import" hidden></section>
      <div class="map3d-building-note">Browse all exterior and interior bundles. Repeated UIDs can have different models or textures in different bundles. This is a static model viewer; placement editing is on Maps → Map Editor.</div>
    </div>
    <div class="pokemon-list map3d-view">
      <div class="map3d-toolbar">
        <div class="map3d-toolbar-buttons"><button class="ow-tool" id="buildings-reset" type="button">Reset View</button><button class="ow-tool" id="buildings-topdown" type="button">Top Down</button><button class="ow-tool" id="buildings-export" type="button" disabled>Export for Blender (.glb)</button>
        ${project.session.baseRom === "BW2" ? '<button class="ow-tool" id="buildings-import" type="button" disabled>Import edited GLB</button><button class="ow-tool" id="buildings-undo-import" type="button" disabled>Undo last import</button><button class="ow-tool" id="buildings-test-game" type="button">Test ROM in game</button><input id="buildings-import-file" type="file" accept=".glb" hidden />' : ''}</div>
        <div class="map3d-export-status" id="buildings-export-status" role="status"></div>
        <div class="map3d-controls"><strong>Controls</strong><div>Drag: rotate</div><div>Shift + drag: pan</div><div>Arrow keys: pan</div><div>Trackpad pinch or wheel: zoom</div></div>
      </div>
      <div class="map3d-canvas-wrap" id="buildings-canvas"></div>
      <div class="map3d-warnings" id="buildings-warnings" role="status"></div>
    </div>`;
  const search = root.querySelector<HTMLInputElement>("#buildings-search")!;
  const kind = root.querySelector<HTMLSelectElement>("#buildings-kind")!;
  const bundle = root.querySelector<HTMLSelectElement>("#buildings-bundle")!;
  const list = root.querySelector<HTMLSelectElement>("#buildings-list")!;
  const count = root.querySelector<HTMLElement>("#buildings-count")!;
  const details = root.querySelector<HTMLElement>("#buildings-details")!;
  const warnings = root.querySelector<HTMLElement>("#buildings-warnings")!;
  const exportStatus = root.querySelector<HTMLElement>("#buildings-export-status")!;
  const exportButton = root.querySelector<HTMLButtonElement>("#buildings-export")!;
  const importButton = root.querySelector<HTMLButtonElement>("#buildings-import");
  const undoButton = root.querySelector<HTMLButtonElement>("#buildings-undo-import");
  const importFile = root.querySelector<HTMLInputElement>("#buildings-import-file");
  const review = root.querySelector<HTMLElement>("#buildings-import-review")!;
  const previous = root.querySelector<HTMLButtonElement>("#buildings-prev")!;
  const next = root.querySelector<HTMLButtonElement>("#buildings-next")!;
  const canvas = root.querySelector<HTMLElement>("#buildings-canvas")!;
  const preview = createBuildingLibraryPreview(canvas);
  let library: BuildingLibrary | undefined;
  let active: BuildingLibraryAsset | undefined;
  let exporting = false;
  let pending: BuildingImport | undefined;
  let lastApplied: BuildingImport | undefined;
  let importing = false;

  function selectModel() {
    pending = undefined;
    review.hidden = true;
    active = undefined;
    exportButton.disabled = true;
    if (importButton) importButton.disabled = true;
    if (undoButton) undoButton.disabled = true;
    exportStatus.textContent = "";
    warnings.textContent = "";
    previous.disabled = list.selectedIndex <= 0;
    next.disabled = list.selectedIndex < 0 || list.selectedIndex >= list.options.length - 1;
    preview.clear();
    if (!library || !list.value) {
      details.textContent = "No matching buildings. Try another search or bundle.";
      return;
    }
    try {
      active = library.load(list.value);
      preview.show(buildingLibraryScene(active));
      const materials = [...new Set(active.primitives.map((p) => p.material.name))];
      const textures = [...new Set(active.primitives.flatMap((p) => p.material.texture ? [`${p.material.texture.name} (${p.material.texture.width} × ${p.material.texture.height})`] : []))];
      details.innerHTML = `<strong>${escapeHtml(active.name)}</strong><div class="map3d-building-details"><dl>
        <dt>Model UID</dt><dd>${active.uid}</dd><dt>Type</dt><dd>${active.kind}</dd><dt>Bundle</dt><dd>${active.bundleId}</dd><dt>Resource index</dt><dd>${active.resourceIndex}</dd>
        <dt>Triangles</dt><dd>${active.primitives.reduce((n, p) => n + p.indices.length / 3, 0)}</dd>
        </dl><details><summary>Materials (${materials.length}) / textures (${textures.length})</summary><strong>Materials</strong><ul>${materials.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul><strong>Textures</strong><ul>${textures.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul></details></div>`;
      warnings.innerHTML = `<strong>${escapeHtml(active.name)} · UID ${active.uid}</strong><div>${active.kind} bundle ${active.bundleId} · Static model preview</div>${active.warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}${library.warnings.length ? `<details><summary>${library.warnings.length} library warnings</summary>${library.warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</details>` : ""}`;
      exportButton.disabled = exporting;
      if (importButton) importButton.disabled = importing;
      if (undoButton) undoButton.disabled = importing || lastApplied?.original.id !== active.id;
    } catch (error) {
      active = undefined;
      details.textContent = "This model could not be previewed. Select another building.";
      warnings.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function filter() {
    const selected = list.value;
    const query = search.value.trim().toLowerCase();
    const entries = library?.entries.filter((entry) => (kind.value === "all" || kind.value === entry.kind)
      && (bundle.value === "all" || bundle.value === `${entry.kind}:${entry.bundleId}`)
      && (!query || `${entry.name} uid ${entry.uid} ${entry.kind} bundle ${entry.bundleId}`.toLowerCase().includes(query))) ?? [];
    list.innerHTML = entries.map((entry) => `<option value="${entry.id}">${escapeHtml(`${entry.name} · UID ${entry.uid} · ${entry.kind} ${entry.bundleId}`)}</option>`).join("");
    list.disabled = !entries.length;
    count.textContent = `${entries.length} / ${library?.entries.length ?? 0} models`;
    list.value = entries.some((entry) => entry.id === selected) ? selected : entries[0]?.id ?? "";
    selectModel();
  }

  function updateBundles() {
    const choices = [...new Set(library?.entries.filter((entry) => kind.value === "all" || kind.value === entry.kind).map((entry) => `${entry.kind}:${entry.bundleId}`))];
    bundle.innerHTML = `<option value="all">All bundles</option>${choices.map((key) => `<option value="${key}">${key.replace(":", " bundle ")}</option>`).join("")}`;
    filter();
  }
  search.addEventListener("input", filter);
  kind.addEventListener("change", updateBundles);
  bundle.addEventListener("change", filter);
  list.addEventListener("change", selectModel);
  previous.addEventListener("click", () => { list.selectedIndex -= 1; selectModel(); });
  next.addEventListener("click", () => { list.selectedIndex += 1; selectModel(); });
  root.querySelector("#buildings-reset")!.addEventListener("click", preview.reset);
  root.querySelector("#buildings-topdown")!.addEventListener("click", preview.topDown);
  exportButton.addEventListener("click", async () => {
    if (!active || exporting) return;
    const asset = active;
    exporting = true;
    exportButton.disabled = true;
    exportStatus.textContent = `Exporting ${asset.name}…`;
    try {
      const result = await exportBuildingGlb(asset);
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "model/gltf-binary" }));
      const link = document.createElement("a");
      link.href = url; link.download = result.filename;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (active === asset) exportStatus.textContent = "Exported with textures and import metadata. When exporting back from Blender, enable Include → Custom Properties, keep vertex colors and materials, and disable animations.";
    } catch (error) { if (active === asset) exportStatus.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`; }
    finally { exporting = false; exportButton.disabled = !active; }
  });

  importButton?.addEventListener("click", () => { if (active && !importing) importFile?.click(); });
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0], asset = active;
    importFile.value = "";
    if (!file || !asset || importing) return;
    if (file.size > 64 * 1024 * 1024) { exportStatus.textContent = "Choose a GLB smaller than 64 MB."; return; }
    importing = true; importButton!.disabled = true; pending = undefined; review.hidden = true;
    exportStatus.textContent = `Converting ${file.name}…`;
    try {
      const result = await prepareBuildingImport(asset, new Uint8Array(await file.arrayBuffer()));
      if (active !== asset || !canvas.isConnected) return;
      pending = result;
      preview.show(buildingLibraryScene(result.converted));
      review.hidden = false;
      review.innerHTML = `<strong>Converted game model: ${escapeHtml(asset.name)}</strong>
        <p>${result.originalTriangles} → ${result.convertedTriangles} visible triangles · ${asset.modelBytes.length.toLocaleString()} → ${result.converted.modelBytes.length.toLocaleString()} model bytes</p>
        <p>Geometry and UVs will replace UID ${asset.uid} in ${asset.kind} bundle ${asset.bundleId}. Every placement using this bundle entry will change.</p>
        <p>Original textures, material settings, native shadows, doors, and collision are retained. Texture-image and shader edits in the GLB are not imported in this version.</p>
        <div class="map3d-building-actions"><button type="button" class="ow-tool" data-import-view="original">Show original</button><button type="button" class="ow-tool" data-import-view="converted">Show converted</button><button type="button" class="ow-tool" data-import-apply>Apply building import</button><button type="button" class="ow-tool" data-import-cancel>Cancel</button></div>`;
      exportStatus.textContent = "Previewing the converted NSBMD. Review it before applying.";
    } catch (error) {
      if (active === asset) { preview.show(buildingLibraryScene(asset)); exportStatus.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`; }
    } finally { importing = false; if (importButton) importButton.disabled = !active; }
  });
  review.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    const result = pending;
    if (!button || !result || importing) return;
    if (button.dataset.importView) { preview.show(buildingLibraryScene(button.dataset.importView === "original" ? result.original : result.converted)); return; }
    if (button.hasAttribute("data-import-cancel")) { selectModel(); return; }
    if (!button.hasAttribute("data-import-apply")) return;
    importing = true; button.disabled = true;
    try {
      await applyBuildingImport(project, result);
      onDirty?.(); lastApplied = result;
      library = await loadBuildingLibrary(project);
      if (!canvas.isConnected) return;
      importing = false; selectModel();
      exportStatus.textContent = "Building imported. Map previews and exported ROMs now use the converted model. Test the changed building in-game before distributing the ROM.";
    } catch (error) { exportStatus.textContent = `Apply failed: ${error instanceof Error ? error.message : String(error)}`; }
    finally { importing = false; button.disabled = false; }
  });
  undoButton?.addEventListener("click", async () => {
    const result = lastApplied;
    if (!result || importing) return;
    importing = true; undoButton.disabled = true;
    try {
      await applyBuildingImport(project, result, true);
      onDirty?.(); lastApplied = undefined; library = await loadBuildingLibrary(project);
      if (!canvas.isConnected) return;
      importing = false; selectModel(); exportStatus.textContent = "Restored the model from before the last import.";
    } catch (error) { exportStatus.textContent = `Undo failed: ${error instanceof Error ? error.message : String(error)}`; }
    finally { importing = false; undoButton.disabled = lastApplied?.original.id !== active?.id; }
  });
  root.querySelector<HTMLButtonElement>("#buildings-test-game")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (pending || importing) { exportStatus.textContent = "Apply or cancel the pending import before testing the ROM."; return; }
    let emulator: ReturnType<typeof openTestBattleEmulator> | undefined;
    try {
      emulator = openTestBattleEmulator();
      button.disabled = true;
      exportStatus.textContent = "Building the current ROM. The test save starts in Aspertia City; apply any pending import first.";
      const [{ exportModifiedRom }, { getTestBattleConfigForProject, loadTestBattleSave }] = await Promise.all([
        import("../pokeweb/exportRom"), import("../pokeweb/testBattle"),
      ]);
      const [romBytes, save] = await Promise.all([exportModifiedRom(project), loadTestBattleSave(getTestBattleConfigForProject(project))]);
      await emulator.launch({ romName: "building-import-test.nds", saveName: "building-import-test.sav", trainerId: 0,
        testLabel: "Building test — starts in Aspertia City; visit the edited building", romBytes, saveBytes: save.rawSaveBytes });
      exportStatus.textContent = "Game test launched with applied project edits. Continue the save in Aspertia City and visit the edited building.";
    } catch (error) { emulator?.close(); exportStatus.textContent = `Game test failed: ${error instanceof Error ? error.message : String(error)}`; }
    finally { button.disabled = false; }
  });

  void loadBuildingLibrary(project).then((loaded) => {
    if (!canvas.isConnected) return;
    library = loaded;
    search.disabled = kind.disabled = bundle.disabled = false;
    updateBundles();
    if (!loaded.entries.length) warnings.textContent = loaded.warnings.join("\n") || "This ROM contains no building resources.";
  }).catch((error) => {
    if (!canvas.isConnected) return;
    count.textContent = "Building library failed to load.";
    warnings.textContent = error instanceof Error ? error.message : String(error);
  });
}
