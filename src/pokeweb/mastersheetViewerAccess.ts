import { canOpenMapStudio } from "./mapStudioAccess";

/** The Mastersheet Viewer is still in development: like Map Studio, it opens only locally or once unlocked (aiFeatureAccess.ts), including direct links. */
export function canOpenMastersheetViewer(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return canOpenMapStudio(hostname);
}
