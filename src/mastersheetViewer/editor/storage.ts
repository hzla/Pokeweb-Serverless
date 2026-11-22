/**
 * Small per-browser memories for the editor, kept in localStorage. Each read and write is guarded: storage can be
 * off (private windows, site data blocked), and then the editor simply forgets between visits.
 *
 *   editMode         whether edit mode was on, separately for sheets opened from the editor and for ROM files
 *   draft:<rom key>  unsaved edits to a ROM file's sheet, so a refresh doesn't lose them
 *   cacheAlias       saved ROMs whose renders are the original's: a saved sheet changes the ROM's hash but not one
 *                    map or trainer scene, so the new hash points at the old cache
 */

const EDIT_MODE_KEY = "pokeweb.mastersheetViewer.editMode";
const DRAFT_PREFIX = "pokeweb.mastersheetViewer.draft:";
const CACHE_ALIAS_KEY = "pokeweb.mastersheetViewer.cacheAliases";
const MAX_ALIASES = 20;

export type EditSource = "project" | "rom";

function read<T>(key: string): T | undefined {
  try {
    const text = localStorage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as T);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is off or full: the editor works, it just doesn't remember.
  }
}

export function rememberedEditMode(source: EditSource): boolean {
  const saved = read<Partial<Record<EditSource, boolean>>>(EDIT_MODE_KEY)?.[source];
  // Opened from the editor, the point is to edit; a ROM file opens for reading.
  return saved ?? source === "project";
}

export function rememberEditMode(source: EditSource, on: boolean): void {
  write(EDIT_MODE_KEY, { ...read<Partial<Record<EditSource, boolean>>>(EDIT_MODE_KEY), [source]: on });
}

export type Draft = { source: string; base: string; savedAt: number };

export function loadDraft(romKey: string): Draft | undefined {
  const draft = read<Draft>(DRAFT_PREFIX + romKey);
  return draft && typeof draft.source === "string" && typeof draft.base === "string" ? draft : undefined;
}

export function saveDraft(romKey: string, draft: Draft | undefined): void {
  write(DRAFT_PREFIX + romKey, draft);
}

/** The cache key a ROM's renders live under: its own, or the ROM it was saved from. */
export function cacheKeyFor(romKey: string): string {
  return read<Record<string, string>>(CACHE_ALIAS_KEY)?.[romKey] ?? romKey;
}

export function addCacheAlias(newRomKey: string, cacheKey: string): void {
  if (newRomKey === cacheKey) return;
  const aliases = Object.entries(read<Record<string, string>>(CACHE_ALIAS_KEY) ?? {}).filter(([key]) => key !== newRomKey);
  aliases.push([newRomKey, cacheKey]);
  write(CACHE_ALIAS_KEY, Object.fromEntries(aliases.slice(-MAX_ALIASES)));
}
