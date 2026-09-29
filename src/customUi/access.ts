import { DEFAULT_PAINT, type Access, type Document, type DsKey } from "./document";

/** Old bundles retain their original assignments until the Access panel is saved. */
export function accessFor(doc: Document): Access {
  return structuredClone(doc.access ?? (doc.launchers.party ? { party: { screen: doc.launchers.party, label: "Custom UI" } } : {}));
}
export function defaultAccess(kind: keyof Access, screen: string): NonNullable<Access[keyof Access]> {
  if (kind === "hotkey") return { screen, keys: ["L", "Y"] };
  if (kind === "party") return { screen, label: "Custom UI" };
  return { screen, label: "Custom UI", x: 176, y: 152, width: 72, height: 32, whenOff: true, paint: { ...DEFAULT_PAINT } };
}
export function setAccess(doc: Document, access: Access): void {
  doc.access = structuredClone(access);
  // New authoring deliberately replaces the legacy field-menu choice.
  doc.launchers = access.party ? { party: access.party.screen } : {};
}
export function matchesChord(keys: DsKey[], held: DsKey[], previous: DsKey[], fieldReady: boolean): boolean {
  if (!fieldReady || !keys.length) return false;
  return keys.every(k => held.includes(k)) && keys.some(k => !previous.includes(k));
}
export function cgearHit(access: Access, x: number, y: number, fieldReady: boolean, cgearOn: boolean): string | undefined {
  const b = access.cgear;
  return b && fieldReady && (cgearOn || b.whenOff) && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height ? b.screen : undefined;
}
