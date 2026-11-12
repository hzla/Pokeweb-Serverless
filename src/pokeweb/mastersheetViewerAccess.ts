import { canOpenMapStudio } from "./mapStudioAccess";

/** The Mastersheet Viewer is still in development: like Map Studio, it opens only when Pokeweb runs on localhost, including direct links. */
export function canOpenMastersheetViewer(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return canOpenMapStudio(hostname);
}
