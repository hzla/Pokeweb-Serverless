import type { ProjectState } from "../pokeweb/projectStore";
import { GEN5_MATRIX_EMPTY, MATRIX_EDITOR_CELL_LIMIT, resolveMatrixCellGraphicsHeader, type MatrixSnapshot } from "../pokeweb/matrixModel";
import type { createOverworldMapThumbnailRenderer } from "./overworldMapRenderer";
import { seasonalAreaId, type MatrixSeason } from "../pokeweb/seasonalMatrixModel";

// Keep every distinct image a supported grid can display, including while off.
const CACHE_LIMIT = MATRIX_EDITOR_CELL_LIMIT;
export const MATRIX_THUMBNAIL_SIZE = 128;
const imageCaches = new WeakMap<ProjectState, Map<string, string>>();
const graphicsStores = new Set(["maps", "matrix", "headers", "map_textures", "exterior_building_models", "interior_building_models", "exterior_building_textures", "interior_building_textures"]);
export type MatrixThumbnailPreview = { snapshot: MatrixSnapshot; root: HTMLElement; season: MatrixSeason; headerId?: number; fallbackHeaderId?: number; resourceMatrixId?: number; preview?: boolean };

export function matrixThumbnailKey(project: ProjectState, mapId: number, areaId: number): string {
  const revisions = Object.entries(project.narcs).filter(([name]) => graphicsStores.has(name))
    .map(([name, store]) => `${name}:${store?.revision ?? 0}`).sort().join(";");
  return `${MATRIX_THUMBNAIL_SIZE}:${mapId}:${areaId}:${revisions}:${JSON.stringify(project.map3dAreaEdits ?? {})}`;
}

export function installMatrixThumbnails(project: ProjectState, viewport: HTMLElement, grid: HTMLElement) {
  const cache = imageCaches.get(project) ?? new Map<string, string>();
  imageCaches.set(project, cache);
  type Job = { matrixId: number; x: number; y: number; key: string; button: HTMLButtonElement; generation: number; season: MatrixSeason; previewMap?: { mapId: number; headerId: number } };
  let queue: Job[] = [], running = false, stopped = false, generation = 0;
  // Retain small encoded images while this editor is open, including while off,
  // so other preview panels cannot evict the grid's warm images.
  const displayedImages = new Map<string, string>();
  const failures = new Map<string, string>();
  let observer: IntersectionObserver | undefined;
  let renderer: ReturnType<typeof createOverworldMapThumbnailRenderer> | undefined;

  function apply(button: HTMLButtonElement, image: string): void {
    button.style.backgroundImage = `url("${image}")`;
    button.classList.add("-thumbnail"); button.dataset.matrixThumbnail = "ready";
  }
  function remember(key: string, image: string): void {
    displayedImages.set(key, image);
    while (displayedImages.size > CACHE_LIMIT) displayedImages.delete(displayedImages.keys().next().value!);
  }
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!stopped && queue.length) {
        const job = queue.shift()!;
        if (job.generation !== generation) continue;
        try {
          const failure = failures.get(job.key); if (failure) throw new Error(failure);
          let image = displayedImages.get(job.key) ?? cache.get(job.key);
          if (!image) {
            // Yield between cells so scrolling and index changes remain responsive.
            await new Promise(resolve => setTimeout(resolve, 0));
            if (stopped || job.generation !== generation) continue;
            const { loadMap3dZone } = await import("../pokeweb/map3dModel");
            const data = await loadMap3dZone(project, 0, { season: job.season, cache: false,
              matrixCell: { matrixId: job.matrixId, x: job.x, y: job.y }, ...(job.previewMap ? { previewMap: job.previewMap } : {}) });
            if (stopped || job.generation !== generation) continue;
            const { createOverworldMapThumbnailRenderer } = await import("./overworldMapRenderer");
            if (stopped || job.generation !== generation) continue;
            renderer ??= createOverworldMapThumbnailRenderer(MATRIX_THUMBNAIL_SIZE);
            image = renderer.render(data);
            cache.set(job.key, image);
            while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          }
          if (!stopped && job.generation === generation) { remember(job.key, image); apply(job.button, image); }
        } catch (error) {
          if (!stopped && job.generation === generation) {
            job.button.dataset.matrixThumbnail = "unavailable";
            const message = error instanceof Error ? error.message : String(error); failures.set(job.key, message);
            while (failures.size > CACHE_LIMIT) failures.delete(failures.keys().next().value!);
            job.button.title += ` Preview unavailable: ${message}`;
          }
        }
      }
    } finally { running = false; }
  }
  function start(requests: MatrixThumbnailPreview[]): void {
      generation++; observer?.disconnect(); queue = [];
      if (stopped || !requests.length || typeof IntersectionObserver === "undefined") return;
      const currentGeneration = generation;
      const targets = new Map<Element, { request: typeof requests[number]; index: number }>();
      for (const request of requests) request.root.querySelectorAll<HTMLButtonElement>("[data-matrix-cell]").forEach(button => targets.set(button, { request, index: Number(button.dataset.matrixCell) }));
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || stopped || currentGeneration !== generation) continue;
          const button = entry.target as HTMLButtonElement;
          observer?.unobserve(button);
          const target = targets.get(button); if (!target) continue;
          const { snapshot, season, headerId } = target.request;
          const cell = snapshot.cells[target.index];
          if (!cell || cell.mapId === GEN5_MATRIX_EMPTY || !project.narcs.maps?.rawFiles[cell.mapId]?.length) continue;
          try {
            let header = headerId === undefined ? undefined : project.headers?.rows[headerId + 1];
            if (!header) try {
              header = resolveMatrixCellGraphicsHeader({ width: snapshot.width, height: snapshot.height, hasZones: snapshot.hasHeaders,
                chunkIds: snapshot.cells.map(c => c.mapId), zoneIds: snapshot.cells.map(c => c.headerId ?? GEN5_MATRIX_EMPTY) },
                { matrixId: target.request.resourceMatrixId ?? snapshot.id, x: cell.x, y: cell.y }, Object.values(project.headers?.rows ?? {}));
            } catch (error) {
              header = project.headers?.rows[(target.request.fallbackHeaderId ?? -1) + 1]; if (!header) throw error;
            }
            if (!header) throw new Error("No header provides graphics resources for this preview.");
            const key = matrixThumbnailKey(project, cell.mapId, seasonalAreaId(project.session.baseRom, Number(header.texture_id ?? 0), season)), image = displayedImages.get(key) ?? cache.get(key);
            if (image) { remember(key, image); apply(button, image); }
            else queue.push({ matrixId: snapshot.id, x: cell.x, y: cell.y, key, button, generation, season,
              ...(headerId === undefined && !target.request.preview ? {} : { previewMap: { mapId: cell.mapId, headerId: header.index } }) });
          } catch (error) {
            button.dataset.matrixThumbnail = "unavailable";
            button.title += ` Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        void drain();
      }, { root: viewport, rootMargin: "100px" });
      targets.forEach((_target, button) => observer!.observe(button));
  }
  return {
    show(snapshot?: MatrixSnapshot, options: { allowMatrixZero?: boolean } = {}): void {
      start(snapshot && (snapshot.id !== 0 || options.allowMatrixZero) ? [{ snapshot, root: grid, season: "spring" }] : []);
    },
    showPreviews(previews: MatrixThumbnailPreview[]): void { start(previews); },
    destroy(): void { stopped = true; generation++; queue = []; displayedImages.clear(); observer?.disconnect(); renderer?.dispose(); renderer = undefined; },
  };
}
