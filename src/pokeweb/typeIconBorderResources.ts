import borderManifest from "../assets/codeinjection/typeIconBorderManifest.json";
import { transformBattleTypeHudPanel } from "./battleTypeHudResources";

export function typeIconBorderChange(member: string, redux: boolean) {
  const changes = borderManifest.resources[redux ? "redux" : "retail"];
  return changes[member as keyof typeof changes];
}
export function stripTypeIconBorder(raw: Uint8Array, member: string, redux: boolean): Uint8Array {
  const change = typeIconBorderChange(member, redux);
  if (!change) return raw;
  // Structural recognition is followed by the installer's full native hash
  // checks. An altered image or appended sprite is never accepted on its own.
  try { return transformBattleTypeHudPanel(raw, member as "438", true, { ...change, previous: [] }); }
  catch { return raw; }
}
export function addTypeIconBorder(raw: Uint8Array, member: string, redux: boolean): Uint8Array {
  const change = typeIconBorderChange(member, redux);
  return change ? transformBattleTypeHudPanel(raw, member as "438", false, { ...change, previous: [] }) : raw;
}
