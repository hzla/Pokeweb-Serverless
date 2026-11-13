/**
 * Experimental features (Map Studio, Mega Evolution, Regional Forms, Species Expansion, the Mastersheet Viewer, UI
 * screens, BW2 scripts, cutscenes and field tours) are developed with AI assistance. They are available when Pokeweb
 * runs locally, and on the hosted site once a visitor opens it with `?okWithAI=true`: the unlock is kept in the
 * browser's storage until its site data is cleared (`?okWithAI=false` locks them again).
 *
 * Features that need the local development server (opening a ROM by its file path, W2U sync) stay local-only: see
 * localRomBridge.ts.
 */
export const AI_FEATURES_PARAM = "okWithAI";
const STORAGE_KEY = "pokeweb.okWithAI";

export const AI_FEATURES_NOTICE = [
  "The patches you've unlocked were developed with AI assistance. They are still experimental and receiving updates as bug fixes are made.",
  "If you encounter bugs or compatibility issues with the below patches, pls request support in the pokeweb Discord. Please do not bother developers of other tools for debugging issues caused by these patches.",
].join("\n\n");

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function currentLocation(): Partial<Location> | undefined {
  if (typeof window !== "undefined") return window.location;
  return typeof location === "undefined" ? undefined : location;
}
const currentHostname = (): string => currentLocation()?.hostname ?? "";
const currentSearch = (): string => currentLocation()?.search ?? "";
function currentStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

export function isLocalPokewebHost(hostname = currentHostname()): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

function paramValue(search: string): "true" | "false" | undefined {
  const value = new URLSearchParams(search).get(AI_FEATURES_PARAM)?.toLowerCase();
  return value === "true" || value === "false" ? value : undefined;
}

function storedUnlock(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Unlocked by the URL (this page load, even without storage) or by an earlier visit's. */
export function hasAiFeaturesUnlock(search = currentSearch(), storage = currentStorage()): boolean {
  const param = paramValue(search);
  return param ? param === "true" : storedUnlock(storage);
}

/** Whether the experimental features are available: locally, or unlocked on the hosted site. */
export function canUseAiFeatures(hostname = currentHostname()): boolean {
  return isLocalPokewebHost(hostname) || hasAiFeaturesUnlock();
}

/**
 * Applies `?okWithAI=true|false` at start-up: keeps the unlock in storage, and shows the notice when this load
 * unlocks the features (not on later loads, nor locally where they are always available).
 * Returns what changed.
 */
export function applyAiFeaturesParam(
  { search = currentSearch(), storage = currentStorage(), hostname = currentHostname(), notify = (text: string) => window.alert(text) }:
    { search?: string; storage?: Storage; hostname?: string; notify?: (text: string) => void } = {},
): "unlocked" | "locked" | "unchanged" {
  const param = paramValue(search);
  if (!param) return "unchanged";
  const was = storedUnlock(storage);
  try {
    if (param === "true") storage?.setItem(STORAGE_KEY, "true");
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the URL still unlocks this page load.
  }
  if (param === "false") return was ? "locked" : "unchanged";
  if (was) return "unchanged";
  if (!isLocalPokewebHost(hostname)) notify(AI_FEATURES_NOTICE);
  return "unlocked";
}
