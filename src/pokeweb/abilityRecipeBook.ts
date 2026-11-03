import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";

const MAX_BYTES = 1024 * 1024;

/** Editor-only metadata; the battle interpreter still reads its binary records. */
export function encodeAbilityRecipeBook(entries: unknown): string {
  const bytes = strToU8(JSON.stringify(entries));
  if (bytes.length > MAX_BYTES) throw Error("Ability recipe metadata exceeds its bound.");
  let binary = "";
  for (const byte of zlibSync(bytes, { level: 9 })) binary += String.fromCharCode(byte);
  return `z1:${btoa(binary)}`;
}

/** Accept legacy JSON as well as the current bounded compressed representation. */
export function decodeAbilityRecipeBook(text: string): unknown {
  if (text.startsWith("z1:")) {
    if (text.length > 65535) throw Error("Ability recipe metadata exceeds its bound.");
    try {
      const binary = atob(text.slice(3));
      const bytes = unzlibSync(Uint8Array.from(binary, c => c.charCodeAt(0)), { out: new Uint8Array(MAX_BYTES + 1) });
      if (bytes.length > MAX_BYTES) throw Error("Ability recipe metadata exceeds its bound.");
      text = strFromU8(bytes);
    } catch { throw Error("Invalid compressed ability recipe metadata."); }
  }
  if (text.length > MAX_BYTES) throw Error("Ability recipe metadata exceeds its bound.");
  return JSON.parse(text);
}
