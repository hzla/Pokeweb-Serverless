import letters from "../../runtime/battle-type-hud/assets.json";
import circular from "../../runtime/battle-type-hud/assets-circular.json";

export const DEFAULT_TYPE_ICON_BORDER = "#101010";
export const DEFAULT_BW1_TYPE_ICON_BORDER = "#212121";
export function typeIconBorderRgb555(color: string): number {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("Choose a valid six-digit border color.");
  const rgb = Number.parseInt(color.slice(1), 16);
  return ((rgb >>> 19) & 31) | (((rgb >>> 11) & 31) << 5) | (((rgb >>> 3) & 31) << 10);
}
export function typeIconBorderHex(value: number): string {
  return "#" + [0, 5, 10].map(shift => { const c = (value >>> shift) & 31; return ((c << 3) | (c >>> 2)).toString(16).padStart(2, "0"); }).join("");
}
/** The same masks and RGB555 colors used by the native renderer. */
export function typeIconPreview(variant: "letters" | "circular", borderColor: string): string {
  const asset = variant === "letters" ? letters : circular;
  const border = typeIconBorderHex(typeIconBorderRgb555(borderColor));
  const pixels: string[] = [];
  for (let type = 0; type < 18; ++type) for (let y = 0; y < 11; ++y) for (let x = 0; x < 12; ++x) {
    const mask = 2048 >>> x;
    if (!(asset.outline[y]! & mask)) continue;
    const color = !(asset.fill[y]! & mask) ? border : asset.symbols[type]![y]! & mask ? "#f7f7f7" : typeIconBorderHex(asset.rgb555[type]!);
    pixels.push(`<rect x="${(type % 6) * 16 + x + 2}" y="${Math.floor(type / 6) * 15 + y + 2}" width="1" height="1" fill="${color}"/>`);
  }
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="360" viewBox="0 0 96 45" shape-rendering="crispEdges"><rect width="96" height="45" fill="#303030"/>${pixels.join("")}</svg>`);
}
