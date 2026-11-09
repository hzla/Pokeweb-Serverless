import { TreeForge, TreeStyles } from "treeforge";
import "treeforge/styles/ui.css";
import bw2NarcInfoText from "../assets/data/bw2_narc_info.txt?raw";
import { NintendoDSRom } from "../nds/rom";
import { prepareArm9Download } from "../pokeweb/exportRom";
import {
  addRomFile,
  buildFileSystemSnapshot,
  downloadBytes,
  filenameForRef,
  getNodeBytes,
  importArm9Bytes,
  insertNarcFiles,
  replaceNarcFile,
  replaceRomFile,
  tryParseNarc,
  type FileSystemNodeRef,
  type FileSystemTreeNode,
  type NarcInsertPosition,
} from "../pokeweb/fileSystemModel";
import {
  applyOverlayBytes,
  getOverlayInfo,
  getOverlayWorkingBytes,
  importOverlayBytes,
  isOverlayStaged,
  overlayChangedByteCount,
  overlayIdForFile,
  overlayTableOwners,
  restoreOriginalOverlay,
  type OverlayInfo,
} from "../pokeweb/overlayEditModel";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, formatBytes } from "./dom";

type FileSystemEditorOptions = {
  onDirty: () => void;
};

type TreeForgeInstance = {
  data: unknown;
  refresh: () => void;
};

type NarcReferenceEntry = {
  path: string;
  description: string;
};

const PAGE_SIZE = 0x1000;
const BYTES_PER_ROW = 16;
const BW2_NARC_REFERENCE = parseNarcReference(bw2NarcInfoText);

let selectedRef: FileSystemNodeRef | undefined;
let draftBytes = new Uint8Array();
let cleanBytes = new Uint8Array();
let pageOffset = 0;
let searchQuery = "";
let searchMatchOffset = -1;
let searchNeedleLength = 0;
let selectedTreePath = "";
/** RAM address of byte 0 in the hex view (an overlay's load address, else 0). */
let addressBase = 0;

export async function renderFileSystemEditor(project: ProjectState, root: HTMLElement, options: FileSystemEditorOptions): Promise<void> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) {
    root.innerHTML = `
      <div class="file-system-page">
        <div class="file-system-empty">Reload the ROM before opening the File System tab.</div>
      </div>
    `;
    return;
  }

  let snapshot = buildFileSystemSnapshot(project, romBytes);
  selectedRef = undefined;
  cleanBytes = new Uint8Array();
  draftBytes = new Uint8Array();
  pageOffset = 0;
  searchQuery = "";
  searchMatchOffset = -1;
  searchNeedleLength = 0;
  selectedTreePath = "";
  addressBase = 0;

  root.innerHTML = `
    <div class="file-system-page">
      <aside class="file-system-sidebar">
        <div class="file-system-sidebar__header">
          <h1>File System</h1>
          <p>${escapeHtml(project.romInfo.fileName)} · ${snapshot.rom.files.length} files</p>
        </div>
        <div class="file-system-sidebar__arm9">
          <div class="file-system-sidebar__arm9-title">ARM9 Import / Export</div>
          <div class="file-system-sidebar__arm9-status" id="fs-arm9-status">${formatBytes(project.arm9.length)} decompressed working copy · ROM export will be ${project.arm9Compressed ? "compressed" : "decompressed"}</div>
          <div class="file-system-sidebar__arm9-actions">
            <button class="btn -default" id="fs-export-arm9-compressed" type="button">Compressed</button>
            <button class="btn -default" id="fs-export-arm9-decompressed" type="button">Decompressed</button>
            <button class="btn -default file-system-sidebar__arm9-import" id="fs-import-arm9" type="button">Import Edited ARM9</button>
          </div>
          <input id="fs-import-arm9-input" type="file" accept=".bin,.arm9,application/octet-stream" hidden />
        </div>
        <div id="file-system-tree" class="file-system-tree"></div>
        <textarea id="file-system-tree-input" hidden></textarea>
      </aside>
      <section id="file-system-detail" class="file-system-detail">
        ${renderEmptyDetail(project)}
      </section>
    </div>
  `;

  const detail = root.querySelector<HTMLElement>("#file-system-detail");
  const treeContainer = root.querySelector<HTMLElement>("#file-system-tree");
  if (!detail || !treeContainer) throw new Error("Missing file system containers");

  root.querySelector<HTMLButtonElement>("#fs-export-arm9-compressed")?.addEventListener("click", () => {
    downloadBytes(prepareArm9Download(project, snapshot.rom, true), "arm9-compressed.bin");
  });
  root.querySelector<HTMLButtonElement>("#fs-export-arm9-decompressed")?.addEventListener("click", () => {
    downloadBytes(prepareArm9Download(project, snapshot.rom, false), "arm9-decompressed.bin");
  });
  const arm9ImportInput = root.querySelector<HTMLInputElement>("#fs-import-arm9-input");
  const arm9Status = root.querySelector<HTMLElement>("#fs-arm9-status");
  root.querySelector<HTMLButtonElement>("#fs-import-arm9")?.addEventListener("click", () => arm9ImportInput?.click());
  arm9ImportInput?.addEventListener("change", async () => {
    const file = arm9ImportInput.files?.[0];
    if (!file) return;
    try {
      if (!window.confirm("Replace the current ARM9 working copy and all unsaved ARM9 edits with this file?")) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = importArm9Bytes(project, snapshot.rom, bytes);
      options.onDirty();
      if (arm9Status) {
        arm9Status.classList.remove("-error");
        arm9Status.textContent = `Imported ${result.compressed ? "compressed" : "decompressed"} ARM9 · ${formatBytes(result.decompressedSize)} working copy`;
      }
      window.alert(
        `Imported ${result.compressed ? "compressed" : "decompressed"} ARM9. The ROM will export it ${result.compressed ? "compressed" : "decompressed"}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (arm9Status) {
        arm9Status.classList.add("-error");
        arm9Status.textContent = message;
      }
      window.alert(`Unable to import ARM9: ${message}`);
    } finally {
      arm9ImportInput.value = "";
    }
  });

  let tree: TreeForgeInstance;

  const refreshSnapshot = () => {
    snapshot = buildFileSystemSnapshot(project, romBytes);
    tree.data = snapshot.roots;
    tree.refresh();
    markSelectedTreeNode(treeContainer, selectedTreePath);
  };

  const selectRef = (ref: FileSystemNodeRef) => {
    selectedRef = ref;
    let bytes: Uint8Array;
    try {
      bytes = ref.kind === "overlay" ? getOverlayWorkingBytes(project, snapshot.rom, ref.overlayId) : getNodeBytes(project, snapshot.rom, ref);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      return;
    }
    addressBase = ref.kind === "overlay" ? getOverlayInfo(project, snapshot.rom, ref.overlayId)?.ramAddress ?? 0 : 0;
    cleanBytes = bytes.slice();
    draftBytes = bytes.slice();
    pageOffset = 0;
    searchQuery = "";
    searchMatchOffset = -1;
    searchNeedleLength = 0;
    selectedTreePath = ref.path;
    renderDetail(project, snapshot.rom, detail, ref, {
      onDirty: options.onDirty,
      refreshSnapshot,
      rerender: () => renderDetail(project, snapshot.rom, detail, ref, actions),
    });
    markSelectedTreeNode(treeContainer, ref.path);
  };

  const openReferencePath = (path: string) => {
    const normalized = path.replace(/^\/+/u, "");
    const ref = snapshot.pathRefs.get(normalized);
    if (!ref || ref.kind !== "romFile") {
      window.alert(`Could not find ${path} in this ROM.`);
      return;
    }
    expandTreePath(snapshot.roots, normalized);
    tree.data = snapshot.roots;
    tree.refresh();
    markSelectedTreeNode(treeContainer, normalized);
    selectRef(ref);
    window.setTimeout(() => {
      const node = treeContainer.querySelector<HTMLElement>(`.tf-node[data-path="${cssEscape(normalized)}"]`);
      node?.scrollIntoView({ block: "center" });
    }, 0);
  };

  const actions = {
    onDirty: options.onDirty,
    refreshSnapshot,
    rerender: () => {
      if (selectedRef) renderDetail(project, snapshot.rom, detail, selectedRef, actions);
    },
  };

  tree = new TreeForge({
    containerId: "file-system-tree",
    localData: snapshot.roots,
    editorInputId: "file-system-tree-input",
    settings: {
      ...TreeStyles.MINIMAL,
      icons: { folder: "▸", file: "•" },
    },
    onFileOpen: (node: FileSystemTreeNode) => {
      if (node.meta?.kind === "romFile" || node.meta?.kind === "narcFile" || node.meta?.kind === "addedRomFile" || node.meta?.kind === "overlay") selectRef(node.meta);
    },
  }) as TreeForgeInstance;

  renderReferenceOrEmpty(project, detail, openReferencePath);
  treeContainer.addEventListener("dblclick", (event) => event.preventDefault(), { capture: true });
  treeContainer.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });
}

function renderDetail(
  project: ProjectState,
  rom: NintendoDSRom,
  root: HTMLElement,
  ref: FileSystemNodeRef,
  actions: { onDirty: () => void; refreshSnapshot: () => void; rerender: () => void },
): void {
  if (ref.kind === "folder") {
    root.innerHTML = renderEmptyDetail(project);
    return;
  }
  if (ref.kind === "overlay") {
    renderOverlayDetail(project, rom, root, ref.overlayId, actions);
    return;
  }
  const dirty = !bytesEqual(cleanBytes, draftBytes);
  const title = ref.kind === "narcFile" ? `${ref.parentPath} / ${filenameForRef(project, rom, ref)}` : ref.path;
  const isNarcParent = ref.kind === "romFile" && Boolean(tryParseNarc(getNodeBytes(project, rom, ref)));
  const canNarcInsert = ref.kind === "narcFile" || isNarcParent;
  const targetIndex = ref.kind === "narcFile" ? ref.index : 0;
  const parentFileId = ref.kind === "narcFile" ? ref.parentFileId : ref.kind === "romFile" ? ref.fileId : -1;
  const fileKindLabel = ref.kind === "romFile" ? `file id ${ref.fileId}` : ref.kind === "narcFile" ? `NARC entry ${ref.index}` : "new ROM file";
  const overlayId = ref.kind === "romFile" ? overlayIdForFile(project, rom, ref.fileId) : undefined;
  const overlayNote = overlayId === undefined
    ? ""
    : isOverlayStaged(project, overlayId)
      ? ` · stored image of overlay ${overlayId}. That overlay has staged edits, so export rebuilds this file from _overlays and ignores changes made here.`
      : ` · stored (possibly compressed) image of overlay ${overlayId}. Edit its code decompressed under _overlays.`;

  root.innerHTML = `
    <div class="file-system-detail__header">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${formatBytes(draftBytes.length)} · ${fileKindLabel}${escapeHtml(overlayNote)}</p>
      </div>
      <div class="file-system-actions">
        <button class="btn -default" id="fs-export" type="button">Export</button>
        <button class="btn -default" id="fs-import" type="button">Import</button>
        <button class="btn -default" id="fs-insert-before" type="button" ${ref.kind === "narcFile" ? "" : "disabled"}>Insert Before</button>
        <button class="btn -default" id="fs-insert-after" type="button" ${ref.kind === "narcFile" ? "" : "disabled"}>Insert After</button>
        <button class="btn -default" id="fs-append" type="button" ${canNarcInsert ? "" : "disabled"}>Append</button>
        <button class="btn -primary" id="fs-apply" type="button" ${dirty ? "" : "disabled"}>Apply Hex</button>
        <button class="btn -default" id="fs-revert" type="button" ${dirty ? "" : "disabled"}>Revert</button>
      </div>
    </div>
    ${renderHexView()}
    <div id="file-system-status" class="file-system-status">${dirty ? "Hex edits are staged in the browser." : "No staged hex edits."}</div>
    <input id="fs-import-input" type="file" hidden />
    <input id="fs-insert-input" type="file" multiple hidden />
  `;

  root.querySelector<HTMLButtonElement>("#fs-export")?.addEventListener("click", () => {
    downloadBytes(draftBytes, filenameForRef(project, rom, ref));
  });

  const importInput = root.querySelector<HTMLInputElement>("#fs-import-input");
  root.querySelector<HTMLButtonElement>("#fs-import")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ref.kind === "romFile") replaceRomFile(project, rom, ref.fileId, bytes);
    if (ref.kind === "narcFile") replaceNarcFile(project, rom, ref.parentFileId, ref.index, bytes);
    if (ref.kind === "addedRomFile") addRomFile(project, ref.path, bytes);
    cleanBytes = bytes.slice();
    draftBytes = bytes.slice();
    pageOffset = Math.min(pageOffset, Math.max(0, draftBytes.length - 1));
    actions.onDirty();
    actions.refreshSnapshot();
    actions.rerender();
  });

  const insertInput = root.querySelector<HTMLInputElement>("#fs-insert-input");
  const triggerInsert = (position: NarcInsertPosition) => {
    insertInput!.dataset.position = position;
    insertInput?.click();
  };
  root.querySelector<HTMLButtonElement>("#fs-insert-before")?.addEventListener("click", () => triggerInsert("before"));
  root.querySelector<HTMLButtonElement>("#fs-insert-after")?.addEventListener("click", () => triggerInsert("after"));
  root.querySelector<HTMLButtonElement>("#fs-append")?.addEventListener("click", () => triggerInsert("append"));
  insertInput?.addEventListener("change", async () => {
    const files = [...(insertInput.files ?? [])];
    if (files.length === 0 || parentFileId < 0) return;
    const position = (insertInput.dataset.position as NarcInsertPosition | undefined) ?? "append";
    if (position !== "append" && !window.confirm("Inserting will shift later NARC subfile indexes and may break game references. Continue?")) return;
    const inserts = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    insertNarcFiles(project, rom, parentFileId, targetIndex, inserts, position);
    actions.onDirty();
    actions.refreshSnapshot();
    actions.rerender();
  });

  root.querySelector<HTMLButtonElement>("#fs-apply")?.addEventListener("click", () => {
    if (ref.kind === "romFile") replaceRomFile(project, rom, ref.fileId, draftBytes.slice());
    if (ref.kind === "narcFile") replaceNarcFile(project, rom, ref.parentFileId, ref.index, draftBytes.slice());
    if (ref.kind === "addedRomFile") addRomFile(project, ref.path, draftBytes.slice());
    cleanBytes = draftBytes.slice();
    actions.onDirty();
    actions.refreshSnapshot();
    actions.rerender();
  });

  root.querySelector<HTMLButtonElement>("#fs-revert")?.addEventListener("click", () => {
    draftBytes = cleanBytes.slice();
    actions.rerender();
  });

  bindHexView(root, actions.rerender);
}

function renderOverlayDetail(
  project: ProjectState,
  rom: NintendoDSRom,
  root: HTMLElement,
  overlayId: number,
  actions: { onDirty: () => void; refreshSnapshot: () => void; rerender: () => void },
): void {
  const info = getOverlayInfo(project, rom, overlayId);
  if (!info) {
    root.innerHTML = `<div class="file-system-empty">Overlay ${overlayId} is no longer in the overlay table.</div>`;
    return;
  }
  const dirty = !bytesEqual(cleanBytes, draftBytes);
  const readOnly = Boolean(info.readOnlyReason);
  const staged = isOverlayStaged(project, overlayId);
  const changed = overlayChangedByteCount(project, rom, overlayId);
  const owners = overlayTableOwners(project, overlayId);
  const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  const notes = [
    info.readOnlyReason,
    staged
      ? `Staged: ${changed} byte${changed === 1 ? "" : "s"} differ from the loaded ROM. Export writes this overlay ${exportFormLabel(info)} and updates its overlay table entry.`
      : `Unmodified. Applying a hex edit stages the overlay; export then writes it ${exportFormLabel(info)} and updates its overlay table entry.`,
    owners.length ? `The ${owners.join(" and ")} table inside this overlay is written from its editor on export, over any hex edits to that range.` : undefined,
    project.fileSystem?.replacements?.[info.fileId] ? `File ${info.fileId}, this overlay's stored image, was replaced in the File System; these bytes start from that replacement.` : undefined,
  ].filter((note): note is string => Boolean(note));

  root.innerHTML = `
    <div class="file-system-detail__header">
      <div>
        <h2>Overlay ${overlayId}</h2>
        <p>RAM ${hex(info.ramAddress)}–${hex(info.ramAddress + info.ramSize - 1)} · ${formatBytes(draftBytes.length)} decompressed · file id ${info.fileId} · stored ${storedFormLabel(info)}</p>
      </div>
      <div class="file-system-actions">
        <button class="btn -default" id="fs-export" type="button">Export</button>
        <button class="btn -default" id="fs-import" type="button" ${readOnly ? "disabled" : ""}>Import</button>
        <button class="btn -primary" id="fs-apply" type="button" ${dirty && !readOnly ? "" : "disabled"}>Apply Hex</button>
        <button class="btn -default" id="fs-revert" type="button" ${dirty ? "" : "disabled"}>Revert</button>
        <button class="btn -default" id="fs-restore-overlay" type="button" ${staged && !readOnly ? "" : "disabled"}>Restore Original</button>
      </div>
    </div>
    <div class="file-system-status">Go to accepts a RAM address (${hex(info.ramAddress)}…) or an offset. ${notes.map(escapeHtml).join(" ")}</div>
    ${renderHexView()}
    <div id="file-system-status" class="file-system-status">${dirty ? "Unapplied hex edits. Click Apply Hex to stage them." : "No unapplied hex edits."}</div>
    <input id="fs-import-input" type="file" hidden />
  `;

  const fail = (error: unknown) => window.alert(error instanceof Error ? error.message : String(error));
  root.querySelector<HTMLButtonElement>("#fs-export")?.addEventListener("click", () => {
    downloadBytes(draftBytes, `overlay_${overlayId.toString().padStart(4, "0")}.decompressed.bin`);
  });

  const importInput = root.querySelector<HTMLInputElement>("#fs-import-input");
  root.querySelector<HTMLButtonElement>("#fs-import")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      importOverlayBytes(project, rom, overlayId, new Uint8Array(await file.arrayBuffer()));
      cleanBytes = getOverlayWorkingBytes(project, rom, overlayId).slice();
      draftBytes = cleanBytes.slice();
      actions.onDirty();
      actions.refreshSnapshot();
      actions.rerender();
    } catch (error) {
      fail(error);
    } finally {
      importInput.value = "";
    }
  });

  root.querySelector<HTMLButtonElement>("#fs-apply")?.addEventListener("click", () => {
    try {
      applyOverlayBytes(project, rom, overlayId, draftBytes.slice());
      cleanBytes = draftBytes.slice();
      actions.onDirty();
      actions.refreshSnapshot();
      actions.rerender();
    } catch (error) {
      fail(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#fs-revert")?.addEventListener("click", () => {
    draftBytes = cleanBytes.slice();
    actions.rerender();
  });

  root.querySelector<HTMLButtonElement>("#fs-restore-overlay")?.addEventListener("click", () => {
    if (!window.confirm(`Restore overlay ${overlayId} to the loaded ROM's original code? This also undoes changes other Pokeweb features (Patches, starters, code injection installers) made to this overlay.`)) return;
    try {
      restoreOriginalOverlay(project, rom, overlayId);
      cleanBytes = getOverlayWorkingBytes(project, rom, overlayId).slice();
      draftBytes = cleanBytes.slice();
      actions.onDirty();
      actions.refreshSnapshot();
      actions.rerender();
    } catch (error) {
      fail(error);
    }
  });

  bindHexView(root, actions.rerender);
}

function storedFormLabel(info: OverlayInfo): string {
  const parts = [info.compressed ? "compressed" : "uncompressed"];
  if (info.signed) parts.push("signed");
  return parts.join(", ");
}

/** Mirrors exportRom: signed overlays are left decompressed, others are recompressed. */
function exportFormLabel(info: OverlayInfo): string {
  return info.signed ? "decompressed (signed overlays are not recompressed)" : "recompressed";
}

function bindHexView(root: HTMLElement, rerender: () => void): void {
  root.querySelector<HTMLButtonElement>("#fs-page-prev")?.addEventListener("click", () => {
    pageOffset = Math.max(0, pageOffset - PAGE_SIZE);
    rerender();
  });
  root.querySelector<HTMLButtonElement>("#fs-page-next")?.addEventListener("click", () => {
    pageOffset = Math.min(Math.max(0, draftBytes.length - 1), pageOffset + PAGE_SIZE);
    pageOffset -= pageOffset % BYTES_PER_ROW;
    rerender();
  });
  root.querySelector<HTMLInputElement>("#fs-page-offset")?.addEventListener("change", (event) => {
    const value = parseOffset((event.target as HTMLInputElement).value);
    goToOffset(value, rerender);
  });
  root.querySelector<HTMLButtonElement>("#fs-page-go")?.addEventListener("click", () => {
    goToOffset(parseOffset(root.querySelector<HTMLInputElement>("#fs-page-offset")?.value ?? ""), rerender);
  });
  root.querySelector<HTMLInputElement>("#fs-search-query")?.addEventListener("input", (event) => {
    searchQuery = (event.target as HTMLInputElement).value;
  });
  root.querySelector<HTMLInputElement>("#fs-search-query")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    findSearchMatch(1, rerender);
  });
  root.querySelector<HTMLButtonElement>("#fs-search-prev")?.addEventListener("click", () => findSearchMatch(-1, rerender));
  root.querySelector<HTMLButtonElement>("#fs-search-next")?.addEventListener("click", () => findSearchMatch(1, rerender));

  if (searchMatchOffset >= pageOffset && searchMatchOffset < pageOffset + PAGE_SIZE) {
    window.setTimeout(() => focusHexCell(searchMatchOffset), 0);
  }

  root.querySelectorAll<HTMLInputElement>(".hex-cell").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^0-9A-F]/gu, "").slice(0, 2);
      if (input.value.length !== 2) {
        input.classList.add("-invalid");
        return;
      }
      input.classList.remove("-invalid");
      const offset = Number(input.dataset.offset);
      draftBytes[offset] = Number.parseInt(input.value, 16);
      rerender();
    });
  });
}

function renderHexView(): string {
  return `
    <div class="file-system-hex-toolbar">
      <button class="btn -default" id="fs-page-prev" type="button" ${pageOffset === 0 ? "disabled" : ""}>Prev</button>
      <label>
        <span>Go to</span>
        <input id="fs-page-offset" type="text" value="0x${(addressBase + pageOffset).toString(16).toUpperCase()}" />
      </label>
      <button class="btn -default" id="fs-page-go" type="button">Go</button>
      <button class="btn -default" id="fs-page-next" type="button" ${pageOffset + PAGE_SIZE >= draftBytes.length ? "disabled" : ""}>Next</button>
      <label class="file-system-search">
        <span>Search</span>
        <input id="fs-search-query" type="text" value="${escapeHtml(searchQuery)}" placeholder="hex bytes or text" />
      </label>
      <button class="btn -default" id="fs-search-prev" type="button">Prev</button>
      <button class="btn -default" id="fs-search-next" type="button">Next</button>
      <span>${rangeLabel()}</span>
    </div>
    <div id="file-system-hex" class="file-system-hex">
      ${renderHexPage()}
    </div>
  `;
}

function renderHexPage(): string {
  if (draftBytes.length === 0) return `<div class="file-system-empty">This file is empty.</div>`;
  const end = Math.min(draftBytes.length, pageOffset + PAGE_SIZE);
  const rows: string[] = [];
  for (let offset = pageOffset; offset < end; offset += BYTES_PER_ROW) {
    const row = draftBytes.slice(offset, Math.min(end, offset + BYTES_PER_ROW));
    rows.push(`
      <div class="hex-row">
        <code class="hex-offset">${(addressBase + offset).toString(16).padStart(8, "0").toUpperCase()}</code>
        <div class="hex-bytes">
          ${[...row]
            .map(
              (byte, index) => {
                const absoluteOffset = offset + index;
                const matchClass =
                  searchMatchOffset >= 0 && absoluteOffset >= searchMatchOffset && absoluteOffset < searchMatchOffset + searchNeedleLength ? " -match" : "";
                return `<input class="hex-cell${matchClass}" data-offset="${absoluteOffset}" maxlength="2" value="${byte.toString(16).padStart(2, "0").toUpperCase()}" aria-label="Byte ${absoluteOffset}" />`;
              },
            )
            .join("")}
        </div>
        <code class="hex-ascii">${escapeHtml([...row].map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join(""))}</code>
      </div>
    `);
  }
  return rows.join("");
}

function renderEmptyDetail(project: ProjectState): string {
  if (project.session.baseRom === "BW2") return renderBw2ReferenceTable();
  return `<div class="file-system-empty">Select a file or NARC subfile to inspect its bytes.</div>`;
}

function renderReferenceOrEmpty(project: ProjectState, root: HTMLElement, onOpenPath: (path: string) => void): void {
  root.innerHTML = renderEmptyDetail(project);
  root.querySelectorAll<HTMLButtonElement>("[data-reference-path]").forEach((button) => {
    button.addEventListener("click", () => onOpenPath(button.dataset.referencePath ?? ""));
  });
}

function renderBw2ReferenceTable(): string {
  return `
    <div class="narc-reference">
      <div class="narc-reference__header">
        <h2>BW2 NARC Reference</h2>
        <p>Select a file or use a path below to open it in the explorer.</p>
      </div>
      <div class="narc-reference__table">
        ${BW2_NARC_REFERENCE.map(
          (entry) => `
            <button class="narc-reference__row" type="button" data-reference-path="${escapeHtml(entry.path)}">
              <code>${escapeHtml(entry.path)}</code>
              <span>${escapeHtml(entry.description)}</span>
            </button>
          `,
        ).join("")}
      </div>
    </div>
  `;
}

function rangeLabel(): string {
  if (draftBytes.length === 0) return "0 B";
  const end = Math.min(draftBytes.length, pageOffset + PAGE_SIZE);
  return `Showing 0x${(addressBase + pageOffset).toString(16).toUpperCase()}-0x${(addressBase + end - 1).toString(16).toUpperCase()} of ${formatBytes(draftBytes.length)}`;
}

function parseOffset(value: string): number {
  const trimmed = value.trim();
  let parsed: number;
  if (/^0x[0-9a-f]+$/iu.test(trimmed)) parsed = Number.parseInt(trimmed.slice(2), 16);
  else if (/^[0-9]+$/u.test(trimmed)) parsed = Number.parseInt(trimmed, 10);
  else return pageOffset;
  // Overlays accept either a RAM address inside the overlay or a file offset.
  return addressBase && parsed >= addressBase && parsed < addressBase + draftBytes.length ? parsed - addressBase : parsed;
}

function goToOffset(offset: number, rerender: () => void): void {
  pageOffset = Math.max(0, Math.min(Math.max(0, draftBytes.length - 1), offset));
  pageOffset -= pageOffset % BYTES_PER_ROW;
  rerender();
  window.setTimeout(() => focusHexCell(offset), 0);
}

function findSearchMatch(direction: 1 | -1, rerender: () => void): void {
  const needle = parseSearchNeedle(searchQuery);
  if (needle.length === 0) {
    searchMatchOffset = -1;
    searchNeedleLength = 0;
    rerender();
    return;
  }
  const start =
    searchMatchOffset >= 0
      ? searchMatchOffset + direction
      : direction > 0
        ? pageOffset
        : Math.max(0, Math.min(draftBytes.length - 1, pageOffset + PAGE_SIZE - 1));
  const match = direction > 0 ? indexOfBytes(draftBytes, needle, Math.max(0, start)) : lastIndexOfBytes(draftBytes, needle, Math.min(draftBytes.length - 1, start));
  if (match < 0) {
    window.alert("No match found.");
    return;
  }
  searchMatchOffset = match;
  searchNeedleLength = needle.length;
  pageOffset = match - (match % BYTES_PER_ROW);
  rerender();
}

function parseSearchNeedle(query: string): Uint8Array {
  const trimmed = query.trim();
  if (!trimmed) return new Uint8Array();
  const compact = trimmed.replace(/\s+/gu, "");
  if (/^[0-9a-f]+$/iu.test(compact) && compact.length % 2 === 0) {
    const out = new Uint8Array(compact.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return new TextEncoder().encode(trimmed);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  for (let offset = start; offset <= haystack.length - needle.length; offset += 1) {
    if (matchesAt(haystack, needle, offset)) return offset;
  }
  return -1;
}

function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  for (let offset = Math.min(start, haystack.length - needle.length); offset >= 0; offset -= 1) {
    if (matchesAt(haystack, needle, offset)) return offset;
  }
  return -1;
}

function matchesAt(haystack: Uint8Array, needle: Uint8Array, offset: number): boolean {
  for (let index = 0; index < needle.length; index += 1) {
    if (haystack[offset + index] !== needle[index]) return false;
  }
  return true;
}

function focusHexCell(offset: number): void {
  const cell = document.querySelector<HTMLInputElement>(`.hex-cell[data-offset="${offset}"]`);
  cell?.focus();
  cell?.select();
}

function parseNarcReference(text: string): NarcReferenceEntry[] {
  return text
    .split(/\r?\n/u)
    .map((line) => /^\/(a\/\d+\/\d+\/\d+)\s+(.+)$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ path: match[1], description: match[2].trim() }));
}

function expandTreePath(nodes: FileSystemTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.meta?.path === path) {
      if (node.children) node.collapsed = false;
      return true;
    }
    if (node.children && path.startsWith(`${node.meta?.path ?? node.name}/`)) {
      node.collapsed = false;
      if (expandTreePath(node.children, path)) return true;
    }
  }
  return false;
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/gu, "\\$&");
}

function markSelectedTreeNode(root: HTMLElement, path: string): void {
  root.querySelectorAll(".tf-node.-selected").forEach((node) => node.classList.remove("-selected"));
  if (!path) return;
  root.querySelector<HTMLElement>(`.tf-node[data-path="${cssEscape(path)}"]`)?.classList.add("-selected");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
