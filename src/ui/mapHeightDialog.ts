import type { ProjectState } from "../pokeweb/projectStore";
import type { Map3dSceneData, Map3dPrimitive } from "../pokeweb/map3dModel";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { applyMapHeightEdit, prepareMapHeightEdit, type GeneratedMapHeights, type MapHeightEdit } from "../pokeweb/mapHeightEdit";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { escapeHtml } from "./dom";

export function openMapHeightDialog(project: ProjectState, root: HTMLElement, scene: Map3dSceneData, callbacks: {
  lock(locked: boolean): void; preview(scene: Map3dSceneData): void; restore(): void; applied(edit: MapHeightEdit): Promise<void>;
}) {
  const dialog = document.createElement("dialog"); dialog.className = "map3d-native-import"; dialog.setAttribute("aria-label", "Generate walking heights");
  const chunks = scene.chunks.filter((c, i, list) => list.findIndex(q => q.chunkId === c.chunkId) === i);
  dialog.innerHTML = `<strong>Generate walking heights</strong><label class="map3d-field">Map chunk<select data-height-chunk>${chunks.map((c, i) => `<option value="${i}">Map ${c.chunkId} · Cell ${c.matrixX}, ${c.matrixY}</option>`).join("")}</select></label><p>Snap: 0.0625 tiles</p><div data-height-result role="status"></div><div class="map3d-building-actions"><button class="ow-tool" data-height="generate">Generate</button><button class="ow-tool" data-height="original" hidden>Show original</button><button class="ow-tool" data-height="preview" hidden>Show generated heights</button><button class="ow-tool" data-height="apply" disabled>Apply heights</button><button class="ow-tool" data-height="cancel">Cancel</button></div>`;
  root.append(dialog); callbacks.lock(true); dialog.show();
  const selector = dialog.querySelector<HTMLSelectElement>("select")!, status = dialog.querySelector<HTMLElement>("[data-height-result]")!;
  const button = (name: string) => dialog.querySelector<HTMLButtonElement>(`[data-height="${name}"]`)!;
  let worker: Worker | undefined, result: GeneratedMapHeights | undefined, edit: MapHeightEdit | undefined, preview: Map3dSceneData | undefined, closed = false, busy = false, epoch = 0;
  const close = (restore = true) => { if (closed) return; closed = true; epoch++; worker?.terminate(); dialog.close(); dialog.remove(); callbacks.lock(false); if (restore) callbacks.restore(); };
  const reset = () => { epoch++; worker?.terminate(); worker = undefined; result = edit = preview = undefined; busy = false; button("apply").disabled = true; button("generate").disabled = false; button("original").hidden = button("preview").hidden = true; status.textContent = ""; callbacks.restore(); };
  selector.addEventListener("change", reset);
  dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
  dialog.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  dialog.addEventListener("click", async event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-height]")?.dataset.height;
    if (action === "cancel") { close(); return; } if (!action || busy) return;
    if (action === "original") { callbacks.restore(); return; }
    if (action === "preview" && preview) { callbacks.preview(preview); return; }
    if (action === "apply" && edit) {
      try { applyMapHeightEdit(project, edit); close(false); await callbacks.applied(edit); }
      catch (error) { status.textContent = String(error); } return;
    }
    if (action !== "generate") return;
    const generation = ++epoch; result = edit = preview = undefined;
    try {
      materializeProjectEdits(project);
      const chunk = chunks[Number(selector.value)]; if (!chunk) throw new Error("Choose a loaded map chunk.");
      const source = project.narcs.maps!.rawFiles[chunk.chunkId].slice(), parsed = readGen5MapBin(source);
      busy = true; button("generate").disabled = true; button("apply").disabled = true; status.textContent = "Computing walking surfaces…";
      worker?.terminate(); worker = new Worker(new URL("../pokeweb/mapHeightWorker.ts", import.meta.url), { type: "module" });
      const generated = await new Promise<GeneratedMapHeights>((resolve, reject) => {
        worker!.onmessage = e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
        worker!.onerror = e => reject(new Error(e.message));
        worker!.postMessage([chunk.primitives.map(p => ({ positions: p.positions, indices: p.indices })), parsed.files[1], parsed.placements === 3 ? parsed.files[2] : undefined, project.session.baseRom]);
      });
      if (closed || generation !== epoch || worker === undefined) return; worker.terminate(); worker = undefined; result = generated;
      const coordinates = (indices: number[]) => indices.slice(0, 8).map(i => `${i % 32},${Math.floor(i / 32)}`).join(" · ");
      const issues = [[result.missing, "Missing full-tile terrain"], [result.unsupported, "Heights outside the native plane table"], [result.extraSurfaces, "Overlapping surfaces need collision/layer setup"]] as const;
      status.innerHTML = `<p>${result.walkable} walkable tiles · ${result.plates.length} plates</p><p>Match within 0.03125 tiles: ${result.matchingSamples}/${result.samples} samples · ${result.changedTiles.length} changed tiles</p>${issues.filter(([ids]) => ids.length).map(([ids, label]) => `<p>${label}: ${ids.length} tiles (${escapeHtml(coordinates(ids))})</p>`).join("")}`;
      if (result.canApply) edit = prepareMapHeightEdit(chunk.chunkId, source, result);
      button("apply").disabled = !edit; button("original").hidden = button("preview").hidden = false;
      const { gen5HeightPreview } = await import("../pokeweb/gen5MapHeightGeneration");
      if (closed || generation !== epoch) return;
      const mesh = gen5HeightPreview(result.plates);
      const surface: Map3dPrimitive = { ...mesh, material: { name: "Generated walking heights", diffuse: [.2, 1, .6], alpha: .65 } };
      preview = { ...scene, chunks: scene.chunks.map(c => c.chunkId === chunk.chunkId ? { ...c, primitives: [...c.primitives, surface] } : c) };
      callbacks.preview(preview);
    } catch (error) { if (!closed && generation === epoch) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { if (!closed && generation === epoch) { worker?.terminate(); worker = undefined; busy = false; button("generate").disabled = false; } }
  });
}
