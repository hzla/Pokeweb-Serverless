/**
 * Notices drawn in Black 2 and White 2's own text boxes: the signpost (a/0/0/5 member 6, palettes in member 1) and the
 * light system message (member 8, palette member 3, bank 0). Each frame is kept as a compact nine-slice of palette
 * indices, read from the game's tiles as the game lays them out; a notice's colour picks the palette, so any colour
 * gives a frame in the game's own shading. The slice is drawn as an SVG `border-image` at 2× (one game pixel is two
 * CSS pixels).
 */

export type NoticeFrame = "sign" | "system";

type FrameShape = {
  /** Palette indices as hex digits, "." for clear. Rows and columns between the slices repeat. */
  rows: string[];
  slice: { top: number; right: number; bottom: number; left: number };
};

/** The signpost: a board between two posts that stand a little above and below it. */
const SIGN: FrameShape = {
  rows: [
    ".ee...............ee.",
    "eaae.............eaae",
    "eaaeeeeeeeeeeeeeeeaae",
    "eccdaaaaaaaaaaaaadcce",
    "ebbdcccccccccccccdbbe",
    "ebbdbbbbbbbbbbbbbdbbe",
    "ebbdbbbbbbbbbbbbbdbbe",
    "ebbdbba8888888abbdbbe",
    "ebbdbb8888f8888bbdbbe",
    "ebbdbba8888888abbdbbe",
    "ebbdbbbbbbbbbbbbbdbbe",
    "ebbdbbbbbbbbbbbbbdbbe",
    "ebbdcccccccccccccdbbe",
    "ebbeeeeeeeeeeeeeeebbe",
    "ecce.............ecce",
    ".ee...............ee.",
  ],
  slice: { top: 8, right: 10, bottom: 7, left: 10 },
};

/** The light system message: a black edge, a dark band above and below, a light line inside. */
const SYSTEM: FrameShape = {
  rows: ["44444", "43334", "43334", "42224", "42124", "42224", "43334", "43334", "44444"],
  slice: { top: 4, right: 2, bottom: 4, left: 2 },
};

/** Text on a frame: palette index 1 with index 2 as its shadow on a sign; the system box's own greys. */
type Palette = Record<string, string> & { text: string; shadow: string; title: string };

/** The game's four signposts, by the colour of their boards (index 11), which is what a notice's colour names. */
const SIGN_PALETTES: Record<string, { name: string; palette: Palette }> = {
  "#7b6b6b": { name: "Rose gray", palette: sign(["#decece", "#ad9c9c", "#7b6b6b", "#5a4a4a", "#4a3939", "#decece", "#847b7b"]) },
  "#9c7342": { name: "Tan", palette: sign(["#ffdebd", "#bd9c63", "#9c7342", "#845a21", "#734208", "#ffdead", "#94846b"]) },
  "#427b9c": { name: "Blue", palette: sign(["#addeff", "#7badd6", "#427b9c", "#215a84", "#084a73", "#addeff", "#6b8494"]) },
  "#529442": { name: "Green", palette: sign(["#bdffad", "#84ce73", "#529442", "#318421", "#216308", "#bdffad", "#73946b"]) },
};

/** The signposts' colours, for choosing one: tan first, as most signs are. */
export const SIGN_COLOURS: Array<{ colour: string; name: string }> = ["#9c7342", "#7b6b6b", "#427b9c", "#529442"].map((colour) => ({ colour, name: SIGN_PALETTES[colour]!.name }));

const SYSTEM_PALETTE: Palette = { "1": "#ffffff", "2": "#c6c6c6", "3": "#525252", "4": "#000000", text: "#292929", shadow: "#c6c6c6", title: "#3a3a3a" };

function sign([light, frameLight, frame, frameDark, frameDarkest, fill, shadow]: string[]): Palette {
  return { "8": light!, a: frameLight!, b: frame!, c: frameDark!, d: frameDarkest!, e: "#181818", f: fill!, text: "#292929", shadow: shadow!, title: frameDarkest! };
}

/**
 * A palette in the game's shading for any colour. The game's signs share their lightness index by index and differ in
 * hue and saturation, so the colour gives the hue, and its saturation against the board's (0.40) scales each index's
 * saturation: a grey gives the rose-grey sign's muted tones, a strong colour the blue or green sign's.
 */
function shaded(colour: string, frame: NoticeFrame): Palette | undefined {
  const hsl = toHsl(colour);
  if (!hsl) return undefined;
  const scale = Math.min(2.5, hsl.s / 0.4);
  const tone = (saturation: number, lightness: number) => fromHsl(hsl.h, Math.min(1, saturation * scale), lightness);
  if (frame === "system") {
    return { "1": "#ffffff", "2": tone(0.55, 0.76), "3": tone(0.6, 0.32), "4": "#000000", text: "#292929", shadow: tone(0.3, 0.8), title: tone(0.86, 0.23) };
  }
  return sign([tone(1, 0.86), tone(0.47, 0.62), tone(0.4, 0.43), tone(0.6, 0.32), tone(0.86, 0.23), tone(1, 0.84), tone(0.16, 0.5)]);
}

function palette(frame: NoticeFrame, colour: string | undefined): Palette {
  const key = colour ? normalizeColour(colour) : undefined;
  if (frame === "sign") return (key && SIGN_PALETTES[key]?.palette) || (key && shaded(key, frame)) || SIGN_PALETTES["#9c7342"]!.palette;
  return (key && shaded(key, frame)) || SYSTEM_PALETTE;
}

/** The SVG of a frame's slice: one path per colour, a run of pixels per segment. */
function frameSvg(shape: FrameShape, colours: Palette): string {
  const runs = new Map<string, string[]>();
  shape.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const index = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === index) end += 1;
      if (index !== ".") runs.set(index, [...(runs.get(index) ?? []), `M${x} ${y}h${end - x}v1h-${end - x}z`]);
      x = end;
    }
  });
  const width = shape.rows[0]!.length, height = shape.rows.length;
  const paths = [...runs].map(([index, segments]) => `<path fill="${colours[index]}" d="${segments.join("")}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${paths}</svg>`;
}

const cache = new Map<string, Record<string, string>>();

/** The custom properties that draw a notice: its frame image and slices, and its text colours. */
export function noticeFrameVars(frame: NoticeFrame, colour?: string): Record<string, string> {
  const key = `${frame}|${colour ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const shape = frame === "sign" ? SIGN : SYSTEM;
  const colours = palette(frame, colour);
  const { top, right, bottom, left } = shape.slice;
  const vars = {
    "--notice-frame": `url("data:image/svg+xml,${encodeURIComponent(frameSvg(shape, colours))}")`,
    "--notice-slice": `${top} ${right} ${bottom} ${left}`,
    "--notice-width": `${top * 2}px ${right * 2}px ${bottom * 2}px ${left * 2}px`,
    "--notice-text": colours.text,
    "--notice-shadow": colours.shadow,
    "--notice-title": colours.title,
  };
  cache.set(key, vars);
  return vars;
}

/** The same, for a `style` attribute. */
export function noticeFrameStyle(frame: NoticeFrame, colour?: string): string {
  return Object.entries(noticeFrameVars(frame, colour)).map(([name, value]) => `${name}:${value}`).join(";");
}

// ---------- Colours ----------

/** #rgb, #rrggbb or a colour's name, as #rrggbb; undefined for anything else. */
function normalizeColour(colour: string): string | undefined {
  const text = colour.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/u.test(text)) return text;
  if (!/^[a-z]+$/u.test(text) || typeof document === "undefined") return undefined;
  // A colour's name: the browser knows it.
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return undefined;
  probe.fillStyle = "#010203";
  probe.fillStyle = text;
  return probe.fillStyle === "#010203" ? undefined : probe.fillStyle.toLowerCase();
}

function toHsl(colour: string): { h: number; s: number; l: number } | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(colour);
  if (!match) return undefined;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part!, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((part) => Math.round((part + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
