import { readAscii } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import {
  compileMoveBackgroundImage,
  createEmptyMoveBackgroundFiles,
  type CompiledMoveBackground,
  type MoveBackgroundFiles,
  type MoveBackgroundSourceImage,
} from "./moveBackgroundCompiler";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "./moveAnimationModel";
import { ensureFileSystemState } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { parseNitroPalette } from "./nitroBg";
import type { ProjectState } from "./projectStore";

export type MoveBackgroundReference = {
  storeName: "move_animations" | "battle_animations";
  scriptIndex: number;
  moveId: number;
  moveName?: string;
};

export type ReferencedMoveBackground = {
  backgroundId: number;
  references: MoveBackgroundReference[];
};

export type MoveBackgroundCatalog = {
  backgrounds: ReferencedMoveBackground[];
  scannedScriptCount: number;
  skippedScriptCount: number;
};

const BATTLE_ANIMATION_MOVE_ID_OFFSET = 561;
export const MOVE_BACKGROUND_GRAPHICS_PATH = "a/0/9/4";

export async function getMoveBackgroundIds(project: ProjectState): Promise<number[]> {
  return listBackgroundIds((await loadMoveBackgroundArchive(project)).narc);
}

export async function appendEmptyMoveBackground(project: ProjectState): Promise<number> {
  const archive = await loadMoveBackgroundArchive(project);
  const backgroundId = archive.narc.files.length;
  const empty = createEmptyMoveBackgroundFiles(findBackgroundTemplates(archive.narc));
  archive.narc.files.push(empty.screen, empty.characters, empty.palette);
  commitMoveBackgroundArchive(project, archive.fileId, archive.narc);
  recordGenericChange(project, "move_backgrounds", `Move background ${backgroundId} added.`, `Background ${backgroundId}`, {
    key: `move-background-add:${backgroundId}`,
  });
  return backgroundId;
}

export async function importMoveBackgroundImage(
  project: ProjectState,
  backgroundId: number,
  source: MoveBackgroundSourceImage,
  sourceFileName?: string,
): Promise<CompiledMoveBackground> {
  const archive = await loadMoveBackgroundArchive(project);
  if (!listBackgroundIds(archive.narc).includes(backgroundId)) throw new Error(`Move background ${backgroundId} does not exist.`);
  const compiled = compileMoveBackgroundImage(backgroundId, source, findBackgroundTemplates(archive.narc));
  archive.narc.files[backgroundId] = compiled.files.screen;
  archive.narc.files[backgroundId + 1] = compiled.files.characters;
  archive.narc.files[backgroundId + 2] = compiled.files.palette;
  commitMoveBackgroundArchive(project, archive.fileId, archive.narc);
  const sourceLabel = sourceFileName ? ` from ${sourceFileName}` : "";
  recordGenericChange(project, "move_backgrounds", `Move background ${backgroundId} imported${sourceLabel}.`, `Background ${backgroundId}`, {
    key: `move-background-import:${backgroundId}`,
  });
  return compiled;
}

export function getReferencedMoveBackgroundCatalog(project: ProjectState): MoveBackgroundCatalog {
  const byBackground = new Map<number, Map<string, MoveBackgroundReference>>();
  let scannedScriptCount = 0;
  let skippedScriptCount = 0;

  for (const storeName of ["move_animations", "battle_animations"] as const) {
    const store = project.narcs[storeName];
    if (!store) continue;
    store.rawFiles.forEach((bytes, scriptIndex) => {
      if (!bytes?.length) return;
      let scriptText: string;
      try {
        scriptText = decompileMoveAnimationBytes(bytes);
      } catch {
        skippedScriptCount += 1;
        return;
      }
      scannedScriptCount += 1;
      const moveId = storeName === "battle_animations" ? scriptIndex + BATTLE_ANIMATION_MOVE_ID_OFFSET : scriptIndex;
      const reference: MoveBackgroundReference = {
        storeName,
        scriptIndex,
        moveId,
        moveName: project.texts.banks.moves?.[moveId],
      };
      const referenceKey = `${storeName}:${scriptIndex}`;
      try {
        const parsed = parseMoveAnimationScript(scriptText);
        for (const commands of parsed.scripts.values()) {
          for (const command of commands) {
            if (command.name !== "LoadBackground") continue;
            const backgroundId = command.params[0];
            if (!Number.isInteger(backgroundId) || backgroundId < 0) continue;
            let references = byBackground.get(backgroundId);
            if (!references) {
              references = new Map();
              byBackground.set(backgroundId, references);
            }
            references.set(referenceKey, reference);
          }
        }
      } catch {
        skippedScriptCount += 1;
        scannedScriptCount -= 1;
      }
    });
  }

  return {
    backgrounds: [...byBackground.entries()]
      .sort(([left], [right]) => left - right)
      .map(([backgroundId, references]) => ({
        backgroundId,
        references: [...references.values()].sort(compareReferences),
      })),
    scannedScriptCount,
    skippedScriptCount,
  };
}

export function moveBackgroundReferenceLabel(reference: MoveBackgroundReference): string {
  const archive = reference.storeName === "move_animations" ? "Move animation" : "Battle animation";
  return reference.moveName
    ? `${reference.moveName} (#${reference.moveId})`
    : `${archive} ${reference.scriptIndex}${reference.moveId === reference.scriptIndex ? "" : ` / move #${reference.moveId}`}`;
}

function compareReferences(left: MoveBackgroundReference, right: MoveBackgroundReference): number {
  return left.moveId - right.moveId || left.storeName.localeCompare(right.storeName) || left.scriptIndex - right.scriptIndex;
}

async function loadMoveBackgroundArchive(project: ProjectState): Promise<{ fileId: number; narc: NARC }> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are unavailable. Reload the ROM to edit move backgrounds.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.fileId(MOVE_BACKGROUND_GRAPHICS_PATH);
  const bytes = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  if (!bytes) throw new Error(`Move-background archive ${MOVE_BACKGROUND_GRAPHICS_PATH} is missing.`);
  return { fileId, narc: new NARC(bytes) };
}

function listBackgroundIds(narc: NARC): number[] {
  const ids: number[] = [];
  for (let index = 0; index + 2 < narc.files.length; index += 1) {
    if (fileStamp(narc.files[index]!) !== "RCSN" || fileStamp(narc.files[index + 1]!) !== "RGCN" || fileStamp(narc.files[index + 2]!) !== "RLCN") continue;
    ids.push(index);
    index += 2;
  }
  return ids;
}

function findBackgroundTemplates(narc: NARC): MoveBackgroundFiles {
  const candidates = listBackgroundIds(narc)
    .map((backgroundId) => ({
      screen: narc.files[backgroundId]!,
      characters: narc.files[backgroundId + 1]!,
      palette: narc.files[backgroundId + 2]!,
    }))
    .map((files) => ({ files, paletteColorCount: paletteColorCount(files.palette) }))
    .sort((left, right) => Math.abs(left.paletteColorCount - 96) - Math.abs(right.paletteColorCount - 96));
  for (const candidate of candidates) {
    try {
      createEmptyMoveBackgroundFiles(candidate.files);
      return candidate.files;
    } catch {
      // Continue until a native 512x512, six-bank template is found.
    }
  }
  throw new Error("The move-background archive has no compatible 512×512 4bpp template.");
}

function commitMoveBackgroundArchive(project: ProjectState, fileId: number, narc: NARC): void {
  ensureFileSystemState(project).replacements[fileId] = narc.save();
}

function fileStamp(bytes: Uint8Array): string {
  return bytes.length >= 4 ? readAscii(bytes, 0, 4) : "";
}

function paletteColorCount(bytes: Uint8Array): number {
  try {
    return parseNitroPalette(bytes).length;
  } catch {
    return 0;
  }
}
