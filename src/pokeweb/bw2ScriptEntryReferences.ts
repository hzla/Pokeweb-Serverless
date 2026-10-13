import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { OVERWORLD_GROUP_FORMATS } from "./overworldModel";
import { materializeProjectEdits } from "./projectMaterialize";
import { createNarcStore, type ProjectState } from "./projectStore";
import type { CompiledBw2Script } from "./bw2ScriptCompiler";
import { BW2_SCRIPT_MACROS } from "./bw2ScriptCompiler/macros";

export type Bw2EntryReferencePlan = { references: NonNullable<CompiledBw2Script["entryChanges"]>["references"]; patches: { archive: "scripts" | "overworlds"; id: number; bytes: Uint8Array }[] };
type MapRow = { script_id: number; level_script_id: number; overworlds_id?: number; map_id?: number; location_name?: string; index: number };

/** These numeric assignments can persist across maps. A relative code label
 * cannot establish which map's entry table their runtime actor will use. */
export function verifyBw2EmbeddedEntryReferences(compiled: CompiledBw2Script, mapping: number[]): void {
  if (mapping.every((entry, index) => entry === index + 1)) return;
  const affected = (entry: number) => entry > 0 && entry <= mapping.length && mapping[entry - 1] !== entry;
  const actorAssignment = (entry: number, name: string) => {
    if (entry >= 0x4000 || affected(entry)) throw new Error(`${name} assigns an affected or runtime-selected actor script. Keep the entry slots and clear the body; its destination map cannot be inferred safely.`);
  };
  for (const [index, instruction] of compiled.instructions.entries()) {
    if (instruction.opcode === 0x21 && affected(instruction.operands[0])) throw new Error("rt_reserve_script selects an affected numeric entry and may run after a warp. Keep the entry slots and clear the body; its destination map cannot be inferred safely.");
    if (instruction.opcode === 0x250) actorAssignment(instruction.operands[4], "actor_pair_set");
    if (instruction.opcode === 0x251) actorAssignment(instruction.operands[0], "actor_pair_end");
    if (instruction.opcode === 0x1c && instruction.operands[0] === 10536) {
      const macro = BW2_SCRIPT_MACROS.stop_companion_following, start = index - 4;
      const recognized = macro.sequence.every((step, offset) => {
        const command = compiled.instructions[start + offset];
        return command?.opcode === step.opcode && step.args.every((value, arg) => typeof value === "string" || command.operands[arg] === value);
      });
      if (!recognized) throw new Error("Global script 10536 receives an interaction entry through shared work slots. Keep the entry slots and clear the body; its argument cannot be inferred safely.");
      actorAssignment(compiled.instructions[start + 2].operands[1], "stop_companion_following");
    }
  }
}

export async function prepareBw2ScriptEntryResources(project: ProjectState): Promise<void> {
  if (project.session.baseRom !== "BW2") throw new Error("Entry editing currently supports BW2 projects only.");
  if (project.narcs.overworlds && (project.headers || project.narcs.headers || project.bw2ScriptRuntimeContext?.headers)) return;
  const { activeRomMatchesProject, loadActiveRomBytes } = await import("./persistence");
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect the source ROM to inspect map entry assignments.");
  const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("The source ROM is unavailable.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  if (rom.idCode !== project.romInfo.idCode || bytes.length !== project.romInfo.size) throw new Error("The source ROM does not match this project.");
  for (const [name, path] of [["headers", "a/0/1/2"], ["overworlds", "a/1/2/6"]] as const) if (!project.narcs[name]) project.narcs[name] = createNarcStore(name, path, rom.fileId(path), new NARC(rom.getFileByName(path)));
}

function mapRows(project: ProjectState): MapRow[] {
  if (project.headers) return Object.values(project.headers.rows) as MapRow[];
  const bytes = project.narcs.headers?.rawFiles[0] ?? project.bw2ScriptRuntimeContext?.headers;
  if (!bytes || bytes.length % 48) throw new Error("Load map headers before removing or renumbering entries.");
  return Array.from({ length: bytes.length / 48 }, (_, index) => ({ index, script_id: readU16(bytes, index * 48 + 6), level_script_id: readU16(bytes, index * 48 + 8), map_id: readU16(bytes, index * 48 + 22) }));
}

/** Patch recognized event and static/conditional map-init entry references in
 * staged bytes. The six-byte level records follow Frost's event data layout. */
export function planBw2ScriptEntryReferences(project: ProjectState, fileId: number, mapping: number[]): Bw2EntryReferencePlan {
  const references: Bw2EntryReferencePlan["references"] = [], patches: Bw2EntryReferencePlan["patches"] = [];
  if (mapping.every((entry, index) => entry === index + 1)) return { references, patches };
  const rows = mapRows(project), assigned = rows.filter((row) => row.script_id === fileId);
  if (!assigned.length) throw new Error("This file has no map assignment. Numeric callers of shared/global scripts cannot be remapped automatically; preserve their slots or clear the entry body.");
  const store = project.narcs.overworlds;
  if (!store) throw new Error("Load overworld events before removing or renumbering entries.");
  const stagedStore = { ...store, rawFiles: store.rawFiles.slice(), records: structuredClone(store.records), dirty: new Set(store.dirty) };
  materializeProjectEdits({ ...project, headers: undefined, narcs: { overworlds: stagedStore } });
  const destination = (entry: number) => entry > 0 && entry <= mapping.length ? mapping[entry - 1] : entry;
  const change = (bytes: Uint8Array, offset: number, width: 2 | 4, location: string, initialization = false): void => {
    const before = width === 2 ? readU16(bytes, offset) : readU32(bytes, offset), after = destination(before);
    if (before === after) return;
    if (initialization && after === 0) throw new Error(`${location} uses removed entry ${before}. Choose a replacement entry for map initialization, or clear its body while keeping the slot.`);
    references.push({ location, before, after });
    if (width === 2) writeU16(bytes, offset, after); else writeU32(bytes, offset, after);
  };
  const levelTable = (bytes: Uint8Array, start: number, location: string): void => {
    if (start === bytes.length) return;
    const covered = new Uint8Array(bytes.length - start), dynamic: number[] = [];
    const cover = (p: number, length: number) => { if (p < start || p + length > bytes.length) throw new Error(`${location}: truncated level-script table.`); covered.fill(1, p - start, p - start + length); };
    let p = start, terminated = false;
    for (; p + 2 <= bytes.length; p += 6) {
      const type = readU16(bytes, p);
      if (type === 0) { cover(p, 2); terminated = true; break; }
      if (type > 255) throw new Error(`${location}: unrecognized level-script type.`);
      cover(p, 6);
      if (type === 1) dynamic.push(p + 6 + (readU32(bytes, p + 2) | 0));
      else change(bytes, p + 2, 4, `${location} · initialization type ${type}`, true);
    }
    if (!terminated || dynamic.length > 1) throw new Error(`${location}: unrecognized level-script table.`);
    for (const target of dynamic) {
      if (target < p + 2 || target % 2) throw new Error(`${location}: invalid conditional-table pointer.`);
      terminated = false;
      for (let q = target; q + 2 <= bytes.length; q += 6) {
        if (readU16(bytes, q) === 0) { cover(q, 2); terminated = true; break; }
        cover(q, 6); change(bytes, q + 4, 2, `${location} · conditional initialization`, true);
      }
      if (!terminated) throw new Error(`${location}: unterminated conditional table.`);
    }
    if (bytes.subarray(start).some((byte, index) => byte !== 0 && !covered[index])) throw new Error(`${location}: unrecognized bytes may contain entry references.`);
  };
  const eventIds = new Set(assigned.map((row) => Number(row.overworlds_id ?? row.map_id)));
  for (const id of eventIds) {
    const original = stagedStore.rawFiles[id];
    if (!original || original.length < 8) throw new Error(`Events ${id} are unavailable or truncated.`);
    const bytes = Uint8Array.from(original), beforeReferences = references.length;
    let p = 8;
    for (const [group, count] of [["furniture", bytes[4]], ["npc", bytes[5]], ["warp", bytes[6]], ["trigger", bytes[7]]] as const) {
      const format = OVERWORLD_GROUP_FORMATS[group], stride = format.reduce((sum, [size]) => sum + size, 0);
      if (p + stride * count > bytes.length) throw new Error(`Events ${id} are truncated.`);
      const field = group === "trigger" ? "entity_id" : "script_id";
      let fieldOffset = 0;
      for (const [size, name] of format) { if (name === field) break; fieldOffset += size; }
      if (group !== "warp") for (let index = 0; index < count; index++) change(bytes, p + index * stride + fieldOffset, 2, `Events ${id} · ${group} ${index}`);
      p += stride * count;
    }
    levelTable(bytes, p, `Events ${id} footer`);
    if (references.length > beforeReferences) {
      if (rows.some((row) => Number(row.overworlds_id ?? row.map_id) === id && row.script_id !== fileId)) throw new Error(`Events ${id} are shared with another script file. Separate the map event data before remapping entries.`);
      patches.push({ archive: "overworlds", id, bytes });
    }
  }
  for (const id of new Set(assigned.map((row) => row.level_script_id).filter((id) => Number.isInteger(id) && id !== 0xffff))) {
    if (id === fileId) throw new Error("A map's special-script table overlaps this field script file.");
    const original = project.narcs.scripts?.rawFiles[id];
    if (!original) throw new Error(`Special script table ${id} is not loaded.`);
    const bytes = Uint8Array.from(original), beforeReferences = references.length;
    levelTable(bytes, 0, `Special script table ${id}`);
    if (references.length > beforeReferences) {
      if (rows.some((row) => row.level_script_id === id && row.script_id !== fileId)) throw new Error(`Special script table ${id} is shared with another script file.`);
      patches.push({ archive: "scripts", id, bytes });
    }
  }
  return { references, patches };
}
