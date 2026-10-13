import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BW2_OVERLAY_LAYOUTS } from "./bw2ScriptCompiler/commandLayouts";
import type { ProjectState } from "./projectStore";

type Segment = { ramAddress: number; data: Uint8Array };
type SegmentBounds = { ramAddress: number; byteLength: number };
export type Bw2ScriptRuntimeContext = { fieldRamAddress: number; fieldBytes: Uint8Array; overlays: Record<number, SegmentBounds>; headers?: Uint8Array };
export type Bw2ScriptOverlayContext = { kind: "detected" | "base" | "ambiguous" | "unavailable"; overlayId?: number; zones: number[]; description: string; unassigned?: true };
const OVERLAY_ORDER = [50, 51, 52, 53, 54, 55, 55, 58, 61, 62, 63, 64, 65, 66, 67, 68];
const SUB_OVERLAYS = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 56, 57, 59, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];

/** Locate the native zone dispatcher by its complete structure, not a regional
 * RAM/file address or the script's ability to round-trip under a candidate. */
export function findBw2ScriptOverlayDispatch(field: Segment, overlays: ReadonlyMap<number, Segment | SegmentBounds>): Map<number, number> | undefined {
  let found: Map<number, number> | undefined;
  for (let start = 20; start + OVERLAY_ORDER.length * 20 <= field.data.length; start += 4) {
    if (readU32(field.data, start + 12) !== 50) continue;
    if (readU32(field.data, start - 20) || readU32(field.data, start - 16) || readU32(field.data, start - 12) || readU32(field.data, start - 8) !== 0xffffffff) continue;
    const zones = new Map<number, number>();
    let valid = true;
    for (const [index, overlayId] of OVERLAY_ORDER.entries()) {
      const p = start + index * 20, segment = overlays.get(overlayId);
      const zoneOffset = readU32(field.data, p + 4) - field.ramAddress, count = readU32(field.data, p + 8);
      const table = segment ? readU32(field.data, p) - segment.ramAddress : -1;
      const commandCount = Math.max(...Object.keys(BW2_OVERLAY_LAYOUTS[overlayId]).map(Number)) - 999;
      if (!segment || readU32(field.data, p + 12) !== overlayId || readU32(field.data, p + 16) !== SUB_OVERLAYS[index] ||
          !count || count > 100 || zoneOffset < 0 || zoneOffset % 2 || zoneOffset + count * 2 > field.data.length ||
          table < 0 || table % 4 || table + commandCount * 4 > ("data" in segment ? segment.data.length : segment.byteLength)) { valid = false; break; }
      for (let i = 0; i < count; i++) {
        const zone = readU16(field.data, zoneOffset + i * 2);
        if (zone >= 4096 || zones.has(zone)) { valid = false; break; }
        zones.set(zone, overlayId);
      }
      if (!valid) break;
    }
    if (valid) { if (found) return; found = zones; }
  }
  return found;
}

export function bw2ScriptOverlayContextForZones(dispatch: ReadonlyMap<number, number>, zones: number[]): Bw2ScriptOverlayContext {
  if (!zones.length) return { kind: "unavailable", zones, unassigned: true, description: "No map assignment was found. Shared/global scripts may need explicit command context." };
  const ids = new Set(zones.map((zone) => dispatch.get(zone)));
  if (ids.size > 1) return { kind: "ambiguous", zones, description: "Assigned maps use different command overlays. Select the overlay for the map being edited." };
  const overlayId = [...ids][0];
  return overlayId === undefined
    ? { kind: "base", zones, description: "The native map dispatcher uses base commands for these maps." }
    : { kind: "detected", overlayId, zones, description: `Overlay ${overlayId}, read from the loaded ROM's native map dispatcher.` };
}

export function cacheBw2ScriptRuntimeContext(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseRom !== "BW2") return;
  try {
    const overlays = rom.loadArm9Overlays([12, ...new Set(OVERLAY_ORDER)]), field = overlays.get(12);
    if (!field || !findBw2ScriptOverlayDispatch(field, overlays)) return;
    project.bw2ScriptRuntimeContext = { fieldRamAddress: field.ramAddress, fieldBytes: field.data.slice(),
      overlays: Object.fromEntries([...overlays].map(([id, overlay]) => [id, { ramAddress: overlay.ramAddress, byteLength: overlay.data.length }])),
      headers: project.narcs.headers ? undefined : new NARC(rom.getFileByName("a/0/1/2")).files[0].slice(),
    };
  } catch { /* Unknown native layouts keep explicit/read-only context. */ }
}

/** Older saved projects acquire the small snapshot from their matched ROM. */
export async function prepareBw2ScriptOverlayContext(project: ProjectState): Promise<void> {
  if (project.session.baseRom !== "BW2" || project.bw2ScriptRuntimeContext) return;
  let bytes = project.originalRomBytes;
  if (!bytes) {
    const { activeRomMatchesProject, loadActiveRomBytes } = await import("./persistence");
    if (!await activeRomMatchesProject(project)) return;
    bytes = await loadActiveRomBytes();
  }
  if (bytes) cacheBw2ScriptRuntimeContext(project, new NintendoDSRom(bytes, { fileData: "view" }));
}

export function resolveBw2ScriptOverlay(project: ProjectState, fileId: number): Bw2ScriptOverlayContext {
  const unavailable = (description: string): Bw2ScriptOverlayContext => ({ kind: "unavailable", zones: [], description });
  if (project.session.baseRom !== "BW2" || (!project.originalRomBytes && !project.bw2ScriptRuntimeContext)) return unavailable("Load the source BW2 ROM to detect map command overlays.");
  try {
    const cached = project.bw2ScriptRuntimeContext;
    const rom = !cached && project.originalRomBytes ? new NintendoDSRom(project.originalRomBytes, { fileData: "view" }) : undefined;
    const overlays: Map<number, Segment | SegmentBounds> = cached
      ? new Map(Object.entries(cached.overlays).map(([id, segment]) => [Number(id), segment]))
      : rom!.loadArm9Overlays([12, ...new Set(OVERLAY_ORDER)]);
    const originalField = cached ? { ramAddress: cached.fieldRamAddress, data: cached.fieldBytes } : overlays.get(12) as Segment;
    for (const [id, overlay] of overlays) if (project.overlays[id]) overlays.set(id, { ramAddress: overlay.ramAddress, data: project.overlays[id]! });
    const field = originalField && { ...originalField, data: project.overlays[12] ?? originalField.data };
    const dispatch = field && findBw2ScriptOverlayDispatch(field, overlays);
    if (!dispatch) return unavailable("The loaded ROM's map dispatcher could not be verified. Select an overlay explicitly.");
    let zones: number[];
    if (project.headers) zones = Object.values(project.headers.rows).filter((row) => Number(row.script_id) === fileId).map((row) => row.index);
    else {
      const headers = project.narcs.headers?.rawFiles[0] ?? cached?.headers ?? (rom && new NARC(rom.getFileByName("a/0/1/2")).files[0]);
      if (!headers) return unavailable("Load map headers to detect the script's map assignment.");
      if (headers.length % 48) return unavailable("Map header layout could not be verified.");
      zones = [];
      for (let p = 0; p < headers.length; p += 48) if (readU16(headers, p + 6) === fileId) zones.push(p / 48);
    }
    return bw2ScriptOverlayContextForZones(dispatch, zones);
  } catch { return unavailable("The loaded ROM's map dispatcher could not be read. Select an overlay explicitly."); }
}
