import { makeEditProject } from "../src/test/fixtures/editProject";
import { getMoveRecord, updateMoveField, updateItemPackedField } from "../src/pokeweb/moveItemModel";
import { persistableProject, saveActiveRomBytes, saveActiveProject } from "../src/pokeweb/persistence";
import { materializeProjectEdits } from "../src/pokeweb/projectMaterialize";
import { projectEditSession } from "../src/pokeweb/editSession";

export async function smokeMoveItemEditors() {
  const { renderMoveEditor, renderItemEditor } = await import("../src/ui/moveItemEditor");
  const project = makeEditProject(), root = document.createElement("div");
  document.body.append(root);
  let commits = 0, legacyNotifications = 0;
  const unsubscribe = projectEditSession(project).subscribe(() => { commits++; });
  const legacy = () => { legacyNotifications++; };
  const edit = (selector: string, value: string) => {
    const field = root.querySelector<HTMLElement>(selector);
    if (!field) throw new Error(`Missing UI field: ${selector}`);
    field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    field.textContent = value;
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    if (!field.isConnected) throw new Error("Field edit replaced the editor DOM");
    return field;
  };
  try {
    renderMoveEditor(project, root, legacy);
    const selector = ".move-card[data-index='1'] [data-field-name='power']";
    edit(selector, "90");
    if (getMoveRecord(project, 1).raw.power !== 90 || commits !== 1) throw new Error("Move UI did not commit once");
    edit(selector, "090");
    if (Number(commits) !== 1) throw new Error("No-op move UI edit committed");
    const invalid = edit(selector, "999");
    if (invalid.textContent !== "90" || Number(commits) !== 1) throw new Error("Invalid move UI edit changed state");
    renderItemEditor(project, root, legacy);
    edit(".filterable[data-index='1'] [data-field-name='market_value']", "500");
    if (project.narcs.items!.records.get(1)?.raw?.market_value !== 500 || Number(commits) !== 2)
      throw new Error("Item UI did not commit once");
    if (legacyNotifications !== 0) throw new Error("Migrated UI fired duplicate legacy notifications");
    return { commits, legacyNotifications, invalidEditRestored: true, editorDomPreserved: true };
  } finally { unsubscribe(); root.remove(); }
}

export async function benchmarkEdits(sourceMiB: number, loaded: boolean, sessionCaches = false, legacySnapshot = false) {
  const project = makeEditProject();
  // Synthetic source only: no ROMs, user saves, or origin-wide app storage.
  const source = new Uint8Array(sourceMiB * 1024 * 1024);
  project.romInfo.size = source.length;
  const unrelatedBytes = loaded ? 64 * 1024 * 1024 : 0;
  const unrelatedFileCount = sessionCaches && loaded ? 8192 : 64;
  project.narcs.pokemon_sprites = {
    name: "pokemon_sprites", fileId: 5, sourcePath: "sprites", fileCount: unrelatedFileCount,
    rawFiles: Array.from({ length: unrelatedFileCount }, () => new Uint8Array(unrelatedBytes / unrelatedFileCount)),
    records: new Map(), dirty: new Set(),
  };
  if (loaded) for (let id = 0; id < 2048; id++) project.narcs.pokemon_sprites.records.set(id, {
    id, bytes: new Uint8Array(128), raw: { value: id }, readable: { name: `Sprite ${id}` },
  });
  // Derived runtime sources are independent of authored animation/draft data.
  const runtimeCacheBytes = sessionCaches && loaded ? 16 * 1024 * 1024 : 0;
  const romBackedCacheViewBytes = runtimeCacheBytes;
  if (runtimeCacheBytes) {
    project.bw2ScriptRuntimeContext = { fieldRamAddress: 0x02100000, fieldBytes: new Uint8Array(runtimeCacheBytes), overlays: {} };
    project.docs = { romTitle: "Benchmark", trainerLocations: Object.fromEntries(Array.from({ length: 8000 }, (_, id) => [id, ["Generated location"]])),
      trainerDiffs: {}, itemLocations: {}, groundItemScriptMap: {} };
    // Snapshot-only synthetic archive view: reproduces a retained ROM-backed
    // source cache without running animation codecs or allocating another ROM.
    project.w2animAnimations = { fileId: 7, sourceBytes: source.subarray(0, romBackedCacheViewBytes),
      editorOriginals: {}, editorTargets: {} };
  }
  getMoveRecord(project, 1);
  await saveActiveRomBytes(source, { fileName: project.romInfo.fileName, fairy: false,
    selectedNarcs: Object.keys(project.narcs), idCode: project.romInfo.idCode, sourceSize: source.length });
  let peakObservedJSHeapBytes = 0;
  const sampleMemory = () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (memory) peakObservedJSHeapBytes = Math.max(peakObservedJSHeapBytes, memory.usedJSHeapSize);
  };
  const durations: number[] = [];
  sampleMemory();
  let longTasks = 0, longestTaskMs = 0;
  const observer = new PerformanceObserver(list => {
    for (const task of list.getEntries()) { longTasks++; longestTaskMs = Math.max(longestTaskMs, task.duration); }
  });
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) observer.observe({ type: "longtask" });
  const slice = Uint8Array.prototype.slice;
  let explicitEditCopiedBytes = 0;
  Uint8Array.prototype.slice = function(start?: number, end?: number) {
    const result = slice.call(this, start, end);
    explicitEditCopiedBytes += result.byteLength;
    return result;
  };
  try { for (let n = 0; n < 100; n++) {
    const start = performance.now();
    updateMoveField(project, 1, "power", String(40 + n % 2));
    updateItemPackedField(project, 1, "type_attribute", "important_item", Boolean(n % 2));
    updateMoveField(project, 1, "animation", String(2 + n % 2));
    durations.push(performance.now() - start);
    sampleMemory();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  } } finally { Uint8Array.prototype.slice = slice; }
  materializeProjectEdits(project);
  const snapshotTimes: number[] = [], cloneTimes: number[] = [];
  let cloneInputBytes = 0;
  let serializedSnapshotBufferBytes = 0;
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = ((value: unknown) => {
    cloneInputBytes += binaryBytes(value);
    return clone(value);
  }) as typeof structuredClone;
  try {
    for (let n = 0; n < 5; n++) {
      const start = performance.now();
      // Older persistence prepares authored bytes outside its snapshot builder.
      // Include that work on both sides of the document-boundary comparison.
      if (legacySnapshot) materializeProjectEdits(project);
      const snapshot = persistableProject(project, true);
      snapshotTimes.push(performance.now() - start);
      serializedSnapshotBufferBytes = backingBufferBytes(snapshot);
      sampleMemory();
      // Structured clone is the serialization cost at the IndexedDB boundary.
      const cloneStart = performance.now();
      clone(snapshot);
      cloneTimes.push(performance.now() - cloneStart);
      sampleMemory();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { globalThis.structuredClone = clone; }
  const saveTimes: number[] = [];
  for (let n = 0; n < 5; n++) {
    updateMoveField(project, 1, "power", String(90 + n % 2));
    const start = performance.now();
    await saveActiveProject(project);
    saveTimes.push(performance.now() - start);
    sampleMemory();
  }
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  observer.disconnect();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return {
    sourceMiB, loaded, sourceBufferBytes: source.byteLength, unrelatedBytes, unrelatedFileCount, runtimeCacheBytes,
    romBackedCacheViewBytes, serializedSnapshotBufferBytes,
    explicitEditCopiedBytesPerGroup: explicitEditCopiedBytes / 100,
    editGroupP95Ms: percentile(durations, .95), snapshotP95Ms: percentile(snapshotTimes, .95),
    saveP95Ms: percentile(saveTimes, .95), peakObservedJSHeapBytes,
    serializationP95Ms: percentile(cloneTimes, .95), explicitSnapshotCloneBytesPerSave: cloneInputBytes / 5,
    longTasks, longestTaskMs, usedJSHeapBytes: memory?.usedJSHeapSize, totalJSHeapBytes: memory?.totalJSHeapSize,
  };
}

export async function smokeProjectDocuments() {
  const { makePaddedRom } = await import("../src/test/fixtures/projectRom");
  const { loadProjectFromRomBytes } = await import("../src/pokeweb/loader");
  const { loadActiveProject, loadActiveRomBytes } = await import("../src/pokeweb/persistence");
  const { NintendoDSRom } = await import("../src/nds/rom");
  const { NARC } = await import("../src/nds/narc");
  const { exportModifiedRom } = await import("../src/pokeweb/exportRom");
  const project = await loadProjectFromRomBytes(makePaddedRom(), "browser-fixture.nds", { selectedNarcs: ["personal"] });
  project.narcs.personal!.rawFiles[1][0] = 99;
  project.narcs.personal!.dirty.add(1);
  project.bw2ScriptEditor = { selectedFileId: 5, drafts: { 5: { source: "unfinished source" } } };
  await saveActiveProject(project);
  const restored = await loadActiveProject();
  if (!restored || restored.bw2ScriptEditor?.drafts[5].source !== "unfinished source" || restored.bw2ScriptEditor.selectedFileId !== undefined)
    throw new Error("Draft or fresh-session state was lost during browser reload");
  if (restored.narcs.personal!.records.size !== 0 || restored.narcs.personal!.rawFiles[1][0] !== 99)
    throw new Error("Restored caches or resource edits were incorrect");
  const exported = new NintendoDSRom(await exportModifiedRom(restored));
  if (new NARC(exported.getFileByName("a/0/1/6")).files[1][0] !== 99) throw new Error("Export lost authored bytes");
  if (!(await loadActiveRomBytes())?.length) throw new Error("Source ROM was lost");
  const { renderTrainerEditor } = await import("../src/ui/trainerEditor");
  const { renderDocGenerators } = await import("../src/ui/docGenerators");
  const root = document.createElement("div"); document.body.append(root);
  let dirtyNotifications = 0;
  const onDirty = () => { dirtyNotifications++; };
  restored.narcs.overworlds = { name: "overworlds", fileId: -1, sourcePath: "fixture", fileCount: 0,
    rawFiles: [], records: new Map(), dirty: new Set() };
  restored.docs!.trainerLocations = { 1: ["Stale derived location"] };
  try {
    renderTrainerEditor(restored, root, onDirty);
    renderDocGenerators(restored, root, { onDirty });
    root.querySelector<HTMLButtonElement>("#trainer-locations-btn")!.click();
    if (dirtyNotifications !== 0) throw new Error("Derived location refresh scheduled a save");
    const title = root.querySelector<HTMLInputElement>("#rom-title-input")!;
    title.value = "Authored title"; title.dispatchEvent(new Event("input", { bubbles: true }));
    if (Number(dirtyNotifications) !== 1 || restored.docs!.romTitle !== "Authored title") throw new Error("Authored documentation edit did not request persistence");
  } finally { root.remove(); }
  return { realIndexedDbReload: true, draftsRetained: true, selectionReset: true, decodedCachesReset: true,
    exportPreserved: true, derivedRefreshDoesNotSave: true, authoredDocEditRequestsSave: true };
}

/** Seed a future-version save in the isolated benchmark profile to exercise app boot. */
export async function seedUnsupportedProjectDocument() {
  await new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("pokeweb-serverless", 2);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction("projects", "readwrite"), store = transaction.objectStore("projects");
      const reading = store.get("active");
      reading.onsuccess = () => store.put({ ...reading.result, version: 99 }, "active");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

function percentile(values: number[], fraction: number) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
}
function binaryBytes(value: unknown, seen = new Set<unknown>()): number {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof Map) return [...value.values()].reduce((sum, entry) => sum + binaryBytes(entry, seen), 0);
  return Object.values(value).reduce<number>((sum, entry) => sum + binaryBytes(entry, seen), 0);
}

function backingBufferBytes(value: unknown, seen = new Set<unknown>()): number {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return backingBufferBytes(value.buffer, seen);
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof Map) return [...value.values()].reduce((sum, entry) => sum + backingBufferBytes(entry, seen), 0);
  return Object.values(value).reduce<number>((sum, entry) => sum + backingBufferBytes(entry, seen), 0);
}
