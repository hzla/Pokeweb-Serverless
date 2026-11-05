import type { HeaderRow } from "../pokeweb/headerModel";
import { getMatrixSnapshot } from "../pokeweb/matrixModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { MatrixSeason } from "../pokeweb/seasonalMatrixModel";
import { escapeHtml } from "./dom";
import { matrixThumbnailKey } from "./matrixThumbnails";
import type { createOverworldMapThumbnailRenderer } from "./overworldMapRenderer";

/** Top-down thumbnails of the zones that use a piece of data, rendered lazily one at a time. */

const THUMBNAIL_SIZE = 192;
const CACHE_LIMIT = 200;
const MAX_THUMBNAILS = 6;
const imageCaches = new WeakMap<ProjectState, Map<string, string>>();
let renderer: ReturnType<typeof createOverworldMapThumbnailRenderer> | undefined;
let queue: Promise<void> = Promise.resolve();

type ZoneThumbnail = { zoneId: number; name: string; key: string };

/** One thumbnail per distinct area: headers on a matrix without zones all show the same picture. */
export function zoneThumbnailsFor(project: ProjectState, rows: HeaderRow[]): ZoneThumbnail[] {
  const seen = new Set<string>();
  const result: ZoneThumbnail[] = [];
  for (const row of rows) {
    const matrixId = Number(row.matrix_id ?? 0);
    let zoned = true;
    try {
      zoned = getMatrixSnapshot(project, matrixId).hasHeaders;
    } catch {
      // Unknown matrices are keyed per header.
    }
    const key = zoned ? `${matrixId}:${row.index}` : `${matrixId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ zoneId: Number(row.index), name: String(row.location_name ?? `Zone ${row.index}`), key });
  }
  return result;
}

export function renderZoneThumbnails(thumbnails: ZoneThumbnail[]): string {
  if (thumbnails.length === 0) return "";
  const shown = thumbnails.slice(0, MAX_THUMBNAILS);
  const more = thumbnails.length - shown.length;
  return `<div class="zone-thumbs">
    ${shown.map((thumb) => `<a class="zone-thumb" href="#maps3d/${thumb.zoneId}" data-zone-thumb="${thumb.zoneId}" title="${escapeHtml(`${thumb.name} · zone ${thumb.zoneId} (open in the map editor)`)}" aria-label="${escapeHtml(`${thumb.name}, zone ${thumb.zoneId}`)}"></a>`).join("")}
    ${more > 0 ? `<span class="zone-thumb-more">+${more}</span>` : ""}
  </div>`;
}

/** Starts rendering thumbnails inside `scope` as they scroll into view. */
export function installZoneThumbnails(project: ProjectState, scope: HTMLElement, season: MatrixSeason = "spring"): void {
  const cache = imageCaches.get(project) ?? new Map<string, string>();
  imageCaches.set(project, cache);
  const thumbs = [...scope.querySelectorAll<HTMLElement>("[data-zone-thumb]")];
  if (thumbs.length === 0) return;
  const load = (thumb: HTMLElement) => {
    const zoneId = Number(thumb.dataset.zoneThumb);
    const row = Object.values(project.headers?.rows ?? {}).find((entry) => Number(entry.index) === zoneId);
    const key = `${season}:${zoneId}:${matrixThumbnailKey(project, Number(row?.matrix_id ?? 0), Number(row?.texture_id ?? 0))}`;
    const cached = cache.get(key);
    if (cached) {
      apply(thumb, cached);
      return;
    }
    thumb.classList.add("-loading");
    queue = queue.then(async () => {
      if (!thumb.isConnected) return;
      try {
        const [{ loadMap3dZone }, { createOverworldMapThumbnailRenderer }] = await Promise.all([import("../pokeweb/map3dModel"), import("./overworldMapRenderer")]);
        const data = await loadMap3dZone(project, zoneId, { season, cache: false });
        if (!thumb.isConnected) return;
        renderer ??= createOverworldMapThumbnailRenderer(THUMBNAIL_SIZE);
        const image = renderer.render(data);
        cache.set(key, image);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        apply(thumb, image);
      } catch (error) {
        thumb.classList.add("-unavailable");
        thumb.title += ` Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        thumb.classList.remove("-loading");
      }
      // Yield so typing and scrolling stay responsive between renders.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  if (typeof IntersectionObserver === "undefined") {
    thumbs.forEach(load);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      load(entry.target as HTMLElement);
    }
  });
  thumbs.forEach((thumb) => observer.observe(thumb));
}

function apply(thumb: HTMLElement, image: string): void {
  thumb.style.backgroundImage = `url("${image}")`;
  thumb.classList.add("-ready");
}
