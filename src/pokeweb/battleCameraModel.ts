import { writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";

export type BattleCameraVector = { x: number; y: number; z: number };
export type BattleCameraPose = { position: BattleCameraVector; target: BattleCameraVector };
export type BattleCameraPreset = BattleCameraPose & { id: string; label: string };
export type BattleCameraDocument = { baseAddress: number; presets: BattleCameraPreset[]; overlay: Uint8Array };

const OVERLAY = 168;
const BASE = 0x021ddaa0;
const DEFAULT_TARGET = 0x021f2fb4;
const DEFAULT_RESET = 0x021deac0;
const ORIGINAL_RESET = "054a02604260054a8260002204480a6048608a607047c046336b0000cd1401009a290000";
const DEFAULT_PATCH = [0x4a07, 0x68d3, 0x6003, 0x6913, 0x6043, 0x6953, 0x6083,
  0x6813, 0x600b, 0x6853, 0x604b, 0x6893, 0x608b, 0x4770, 0x46c0, 0x46c0];
const DEFINITIONS = [
  { id: "default", label: "Default / reset", position: 0x021f2fc0, target: DEFAULT_TARGET },
  { id: "single-player", label: "Singles / rotation · Player", position: 0x021f4034, target: 0x021f404c },
  { id: "single-opponent", label: "Singles / rotation · Opponent", position: 0x021f4040, target: 0x021f4058 },
  ...Array.from({ length: 4 }, (_, i) => ({ id: `double-${i}`, label: `Doubles · ${i % 2 ? "Opponent" : "Player"} ${Math.floor(i / 2) + 1}`, position: 0x021f40c4 + i * 12, target: 0x021f40f4 + i * 12 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `triple-${i}`, label: `Triples · ${i % 2 ? "Opponent" : "Player"} ${Math.floor(i / 2) + 1}`, position: 0x021f4124 + i * 12, target: 0x021f416c + i * 12 })),
  { id: "wide-double", label: "Wide · Doubles", position: 0x021f3fec, target: 0x021f401c },
  { id: "wide-triple", label: "Wide · Triples", position: 0x021f4004, target: 0x021f4010 },
  { id: "offset", label: "Offset view", position: 0x021f3ff8, target: 0x021f4028 },
] as const;

const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
const hash = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function battleCameraResetPatch(): Uint8Array {
  // Fit the existing 36-byte leaf function. Only r2/r3 are scratch registers.
  // Load all six coordinates from the same vectors used by camera creation.
  const bytes = new Uint8Array(36);
  DEFAULT_PATCH.forEach((instruction, i) => writeU16(bytes, i * 2, instruction));
  writeU32(bytes, 32, DEFAULT_TARGET);
  return bytes;
}

export async function decodeBattleCameraOverlay(overlay: Uint8Array, baseAddress: number): Promise<BattleCameraDocument> {
  if (baseAddress !== BASE || overlay.length < 0x021f41b4 - BASE) throw new Error("Unsupported battle-camera overlay layout.");
  const region = (address: number, length: number) => overlay.subarray(address - BASE, address - BASE + length);
  // Check the actual readers, rather than trusting coordinates that an editor can change.
  if (await hash(region(0x021de6f4, 0x84)) !== "feb666e011f983bb545401d5ea19d1454e587bc9610c1ea2a769a0e09da2899d"
    || await hash(region(0x021e14e8, 0x444)) !== "f7452daa7add3ab501de63f9eb0aef2498f3b5defa5a19a1012730ac482cdeb3") {
    throw new Error("The battle-camera readers have been modified or relocated.");
  }
  const reset = hex(region(DEFAULT_RESET, 36));
  if (reset !== ORIGINAL_RESET && reset !== hex(battleCameraResetPatch())) throw new Error("The battle-camera reset routine is incompatible.");
  const readVector = (address: number): BattleCameraVector => {
    const v = view(region(address, 12));
    return { x: v.getInt32(0, true) / 4096, y: v.getInt32(4, true) / 4096, z: v.getInt32(8, true) / 4096 };
  };
  return { baseAddress, overlay: overlay.slice(), presets: DEFINITIONS.map(d => ({ id: d.id, label: d.label, position: readVector(d.position), target: readVector(d.target) })) };
}

export async function loadBattleCamera(project: ProjectState): Promise<BattleCameraDocument> {
  if (project.session.baseRom !== "BW2" || project.romInfo.idCode !== "IRDO") throw new Error("Camera editing currently supports US White 2.");
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's ROM to edit battle cameras.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reload the ROM to edit battle cameras.");
  const rom = new NintendoDSRom(source, { fileData: "view" });
  if (rom.data[0x1e] !== 0) throw new Error("Camera editing requires US White 2 revision 0.");
  const overlay = rom.loadArm9Overlays([OVERLAY]).get(OVERLAY);
  if (!overlay) throw new Error("The battle-camera overlay is missing.");
  return decodeBattleCameraOverlay(project.overlays[OVERLAY] ?? overlay.data, overlay.ramAddress);
}

export function validateBattleCameraPose(pose: BattleCameraPose): void {
  for (const vector of [pose.position, pose.target]) for (const value of Object.values(vector)) {
    if (!Number.isFinite(value) || Math.round(value * 4096) < -0x80000000 || Math.round(value * 4096) > 0x7fffffff) {
      throw new Error("Camera coordinates must be finite signed 20.12 values.");
    }
  }
  // The native look-at up vector is (0,1,0); a vertical sightline is singular.
  if (Math.round(pose.position.x * 4096) === Math.round(pose.target.x * 4096)
    && Math.round(pose.position.z * 4096) === Math.round(pose.target.z * 4096)) throw new Error("Camera position and target need different X or Z coordinates.");
}

export function updateBattleCamera(project: ProjectState, document: BattleCameraDocument, presetId: string, pose: BattleCameraPose): BattleCameraPreset {
  validateBattleCameraPose(pose);
  const definition = DEFINITIONS.find(d => d.id === presetId);
  if (!definition) throw new Error("Unknown battle camera preset.");
  const current = project.overlays[OVERLAY] ?? document.overlay;
  // Reject a stale document if another editor changed this overlay meanwhile.
  if (current.length !== document.overlay.length || current.some((byte, i) => byte !== document.overlay[i])) throw new Error("Battle-camera data changed. Reopen the editor before saving.");
  const bytes = current.slice(), v = view(bytes);
  for (const key of ["position", "target"] as const) for (const [i, axis] of ["x", "y", "z"].entries()) {
    v.setInt32(definition[key] - document.baseAddress + i * 4, Math.round(pose[key][axis as keyof BattleCameraVector] * 4096), true);
  }
  if (presetId === "default") bytes.set(battleCameraResetPatch(), DEFAULT_RESET - document.baseAddress);
  project.overlays[OVERLAY] = bytes;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(OVERLAY)) project.patches.dirtyOverlayIds.push(OVERLAY);
  document.overlay = bytes.slice();
  const saved = document.presets.find(p => p.id === presetId)!;
  for (const key of ["position", "target"] as const) saved[key] = Object.fromEntries(Object.entries(pose[key]).map(([axis, n]) => [axis, Math.round(n * 4096) / 4096])) as BattleCameraVector;
  recordGenericChange(project, "battle_backgrounds", `${saved.label} camera placement changed.`, "Battle cameras", { key: `battle-camera:${presetId}` });
  return structuredClone(saved);
}
