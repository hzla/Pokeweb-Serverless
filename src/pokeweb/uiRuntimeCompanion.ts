import { sha256Hex } from "../nds/sha256";
import type { RpmModule } from "./rpm";

export type UiFieldCompanion = {
  fileName: string; sha256: string; codeFingerprint: string; bssSize: number; exports: string[];
};
type Profile = { signatures: { module: string; address: number; label: string; patchSize: number }[] };
export function uiFieldCompanion(profile: unknown): UiFieldCompanion | undefined {
  return (profile as { field?: UiFieldCompanion }).field;
}
export function uiSymbolHash(name: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) hash = Math.imul(hash ^ byte, 0x1000193) >>> 0;
  return hash;
}
export function matchesUiFieldCompanion(rpm: RpmModule, profile: Profile, game: string, version: string): boolean {
  const field = uiFieldCompanion(profile);
  if (!field || rpm.baseAddress || rpm.bssSize !== field.bssSize || rpm.metadata.PMCGameID !== game
    || rpm.metadata.PMCVersion !== version || rpm.metadata.PMCModulePriority !== 3
    || rpm.metadata.PokewebUiPart !== "field" || rpm.symbols.some(s => s.attributes & 2)) return false;
  let hash = 0x811c9dc5;
  for (const byte of rpm.code) hash = Math.imul(hash ^ byte, 0x1000193) >>> 0;
  if (hash.toString(16).padStart(8, "0") !== field.codeFingerprint) return false;
  const expected = profile.signatures.filter(s => s.patchSize && s.module === "12").map(s =>
    `${s.module}:${s.address}:${s.label.endsWith("Return") || s.label.startsWith("QaShop") ? "FULL_COPY" : "THUMB_BRANCH_LINK"}`).sort();
  const actual = rpm.relocations.filter(r => r.target.module !== "base").map(r => `${r.target.module}:${r.target.address}:${r.target.type}`).sort();
  return actual.join("|") === expected.join("|");
}
export async function loadUiFieldCompanion(profile: unknown, url: URL): Promise<Uint8Array> {
  const field = uiFieldCompanion(profile);
  const response = await fetch(url);
  if (!field || !response.ok) throw new Error("Could not load the field callback companion.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256Hex(bytes) !== field.sha256) throw new Error("Field callback companion failed its integrity check.");
  return bytes;
}
