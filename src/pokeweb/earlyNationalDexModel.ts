import { readU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { bw2ScriptBytesEqual, compileBw2Script, decompileBw2Script, type CompiledBw2Script } from "./bw2ScriptCompiler";
import { prepareBw2ScriptOverlayContext, resolveBw2ScriptOverlay } from "./bw2ScriptOverlayContext";
import { withProjectMutationLock } from "./codeInjectionInstall";
import { markDirty, type ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";

const ASPERTIA_SCRIPT = 854;
const ASPERTIA_ZONE = 427;
const ASPERTIA_OVERLAY = 66;
const GIVE_NATIONAL_DEX = 0x01c6;

// Bianca's Pokédex receipt message, follow-up dialogue, and end of the helper.
// The grant goes between the last message close and the story progress update.
const RECEIPT = Uint8Array.of(
  0x4c, 0, 0, 0x34, 0, 0x31, 0, 1, 0, 0xaa, 0, 0x4b, 0, 0x36, 0,
  0x3c, 0, 0, 0x04, 0x32, 0, 2, 0, 1, 0, 0, 0, 0x32, 0, 0x3f, 0,
);
const END = Uint8Array.of(0x28, 0, 0xa1, 0x40, 4, 0, 5, 0);

type DexStatus = { state: "unsupported" | "unavailable" | "ready" | "installed"; offset?: number; message?: string };

function findDexHandoff(bytes: Uint8Array): DexStatus {
  let match: DexStatus | undefined;
  for (let start = bytes.indexOf(RECEIPT[0]); start !== -1; start = bytes.indexOf(RECEIPT[0], start + 1)) {
    if (!RECEIPT.every((byte, index) => bytes[start + index] === byte)) continue;
    const offset = start + RECEIPT.length;
    if (offset + END.length > bytes.length) continue;
    const installed = readU16(bytes, offset) === GIVE_NATIONAL_DEX;
    const end = offset + (installed ? 2 : 0);
    if (!END.every((byte, index) => bytes[end + index] === byte)) continue;
    if (match) return { state: "unavailable", message: "Found more than one matching Pokédex handoff." };
    match = { state: installed ? "installed" : "ready", offset };
  }
  return match ?? { state: "unavailable", message: "Bianca’s Pokédex handoff differs from the supported script." };
}

export function getEarlyNationalDexStatus(project: ProjectState): DexStatus {
  const version = project.session.baseVersion;
  const gameCode = version === "B2" ? "IREO" : version === "W2" ? "IRDO" : undefined;
  if (project.session.baseRom !== "BW2" || !gameCode || project.romInfo.idCode !== gameCode
    || (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0)) {
    return { state: "unsupported", message: "Requires US Black 2 or White 2 revision 0." };
  }
  const bytes = project.narcs.scripts?.rawFiles[ASPERTIA_SCRIPT];
  if (!bytes) return { state: "unavailable", message: "Load the Field Scripts archive to apply this patch." };
  const status = findDexHandoff(bytes);
  const draft = project.bw2ScriptEditor?.drafts[ASPERTIA_SCRIPT];
  if (status.state === "ready" && draft && draft.source !== draft.appliedSource) {
    return { state: "unavailable", message: "Apply or discard the pending edit to Field Script 854 first." };
  }
  return status;
}

function insertDexGrant(source: string, compiled: CompiledBw2Script, offset: number): string {
  const instruction = compiled.instructions.find((item) => item.offset === offset && item.opcode === 0x28);
  if (!instruction) throw new Error("Could not verify the ending of Bianca’s Pokédex handoff.");
  const lines = source.split("\n");
  const index = instruction.line - 1;
  const indent = lines[index].match(/^\s*/)?.[0] ?? "";
  lines.splice(index, 0, `${indent}poke_dex_give_national`);
  return lines.join("\n");
}

function verifyDexInsertion(original: CompiledBw2Script, patched: CompiledBw2Script, offset: number): boolean {
  if (patched.bytes.length !== original.bytes.length + 2 || readU16(patched.bytes, offset) !== GIVE_NATIONAL_DEX
    || original.relocations.length !== patched.relocations.length) return false;
  const pointerBytes = new Set<number>();
  for (const [index, previous] of original.relocations.entries()) {
    const current = patched.relocations[index];
    if (current.kind !== previous.kind
      || current.operandOffset !== previous.operandOffset + (previous.operandOffset >= offset ? 2 : 0)
      || current.targetOffset !== previous.targetOffset + (previous.targetOffset > offset ? 2 : 0)) return false;
    for (let i = 0; i < 4; i++) pointerBytes.add(previous.operandOffset + i);
  }
  return original.bytes.every((byte, index) => pointerBytes.has(index)
    || byte === patched.bytes[index + (index >= offset ? 2 : 0)]);
}

export function applyEarlyNationalDex(project: ProjectState): Promise<RomPatchApplyResult> {
  return withProjectMutationLock(project, async () => {
    const patchId = "earlyNationalDex";
    await prepareBw2ScriptOverlayContext(project);
    const { state, message, offset } = getEarlyNationalDexStatus(project);
    if (state === "installed") return { patchId, status: "already-applied", offset };
    if (state !== "ready" || offset === undefined) throw new Error(message ?? "Early National Pokédex is unavailable.");
    const context = resolveBw2ScriptOverlay(project, ASPERTIA_SCRIPT);
    if (context.overlayId !== ASPERTIA_OVERLAY || !context.zones.includes(ASPERTIA_ZONE)) {
      throw new Error("Could not verify the Aspertia City script assignment.");
    }
    const scripts = project.narcs.scripts!;
    const bytes = scripts.rawFiles[ASPERTIA_SCRIPT];
    const original = decompileBw2Script(bytes, { overlayId: ASPERTIA_OVERLAY });
    if (!original.editable) throw new Error("Field Script 854 contains code that could not be verified.");
    const compiled = compileBw2Script(original.source);
    const patched = compileBw2Script(insertDexGrant(original.source, compiled, offset));
    if (!verifyDexInsertion(compiled, patched, offset)
      || !decompileBw2Script(patched.bytes, { overlayId: ASPERTIA_OVERLAY }).editable) {
      throw new Error("Could not verify the National Pokédex grant and script offsets.");
    }

    const draft = project.bw2ScriptEditor?.drafts[ASPERTIA_SCRIPT];
    if (draft) {
      const authored = compileBw2Script(draft.source);
      if (authored.overlayId !== ASPERTIA_OVERLAY || !bw2ScriptBytesEqual(authored.bytes, bytes)) {
        throw new Error("Reimport Field Script 854 before applying this patch.");
      }
      const source = insertDexGrant(draft.source, authored, offset);
      if (!bw2ScriptBytesEqual(compileBw2Script(source).bytes, patched.bytes)) {
        throw new Error("Could not add the grant to the saved source for Field Script 854.");
      }
      draft.source = source;
      draft.appliedSource = source;
      if (draft.imported) draft.imported.expectedCurrentBytes = patched.bytes.slice();
    }
    scripts.rawFiles[ASPERTIA_SCRIPT] = patched.bytes;
    scripts.records.delete(ASPERTIA_SCRIPT);
    markDirty(project, "scripts", ASPERTIA_SCRIPT);
    recordGenericChange(project, "scripts", "Bianca’s opening Pokédex handoff enables the National Pokédex and Habitat List.", "Early National Pokédex", {
      key: "patch:early-national-dex",
    });
    return { patchId, status: "applied", offset, summary: "National Pokédex grant staged. Export the ROM to apply it." };
  });
}
