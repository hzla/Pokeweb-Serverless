import { canUseAiFeatures } from "./aiFeatureAccess";

/**
 * Keep experimental authoring off hosted deployments, including direct links, unless the visitor unlocked the
 * experimental features (aiFeatureAccess.ts).
 */
export function canOpenMapStudio(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return canUseAiFeatures(hostname);
}
