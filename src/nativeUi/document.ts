import type { Image } from "../customUi/assets";

export const COMMANDS = ["Pokémon", "Pokédex", "Bag", "Trainer Card", "Save", "Options"] as const;
export const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type Direction = typeof DIRECTIONS[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Button = {
  id: number; x: number; y: number; iconX: number; iconY: number; labelX: number; labelY: number;
  label?: string; touch: Rect; neighbors: Partial<Record<Direction, number>>;
};
export type Design = {
  version: 1; screen: "mainMenu"; buttons: Button[];
  images: Record<string, Image>;
  colors: Record<string, string>;
};
export type Project = { version: 1; draft: Design; applied: Design; baseline: Design; source: Uint8Array };
export function defaults(): Design {
  return { version: 1, screen: "mainMenu", images: {}, colors: {}, buttons: COMMANDS.map((_, i) => {
    const x = i % 2 * 128, y = 24 + Math.floor(i / 2) * 48;
    return { id: i + 1, x, y, iconX: x + 32, iconY: y + 20, labelX: x + 48, labelY: y + 8,
      touch: { x: x + 8, y, width: 112, height: 40 }, neighbors: {} };
  }) };
}
export function moveButton(button: Button, dx: number, dy: number): void {
  dx = Math.max(-button.x, Math.min(dx, 128 - button.x));
  dy = Math.max(24 - button.y, Math.min(dy, 120 - button.y));
  for (const key of ["x", "iconX", "labelX"] as const) button[key] += dx;
  for (const key of ["y", "iconY", "labelY"] as const) button[key] += dy;
  button.touch.x += dx; button.touch.y += dy;
}
export function swapButtons(a: Button, b: Button): void {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  moveButton(a, bx - ax, by - ay); moveButton(b, ax - bx, ay - by);
}
export function validate(design: Design): string[] {
  const errors: string[] = [], integer = (n: number, a: number, b: number) => Number.isInteger(n) && n >= a && n <= b;
  if (design.version !== 1 || design.screen !== "mainMenu" || !Array.isArray(design.buttons) || design.buttons.length !== 6) return ["Keep the six native menu buttons."];
  if (new Set(design.buttons.map(b => b.id)).size !== 6) errors.push("Each native command must appear once.");
  for (const b of design.buttons) {
    const prefix = COMMANDS[b.id - 1] ?? "Button";
    if (!integer(b.id, 1, 6) || !integer(b.x, 0, 128) || !integer(b.y, 24, 120) || b.x % 8 || b.y % 8) errors.push(`${prefix}: artwork must fit the button area on the 8-pixel grid.`);
    if (!integer(b.iconX, 28, 252) || !integer(b.iconY, 42, 140)) errors.push(`${prefix}: the animated icon must stay within the button area.`);
    if (!integer(b.labelX, 0, 192) || !integer(b.labelY, 24, 144) || b.labelX % 8 || b.labelY % 8) errors.push(`${prefix}: label position must use whole tiles within the button area.`);
    const r = b.touch;
    if (!r || !integer(r.x, 0, 254) || !integer(r.y, 24, 159) || !integer(r.width, 1, 255 - r.x) || !integer(r.height, 1, 160 - r.y)) errors.push(`${prefix}: touch area must fit between the status bar and footer.`);
    if (b.label !== undefined && (typeof b.label !== "string" || b.label.length > 24 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(b.label))) errors.push(`${prefix}: use up to 24 native-font characters.`);
    for (const [direction, target] of Object.entries(b.neighbors)) if (!DIRECTIONS.includes(direction as Direction) || !integer(target!, 1, 7)) errors.push(`${prefix}: invalid navigation target.`);
  }
  for (let i = 0; i < design.buttons.length; i++) for (let j = i + 1; j < design.buttons.length; j++) {
    const a = design.buttons[i].touch, b = design.buttons[j].touch;
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) errors.push(`${COMMANDS[i]} and ${COMMANDS[j]} have overlapping touch areas.`);
  }
  for (const [key, image] of Object.entries(design.images)) {
    if (!/^(body:[1-6]|icon:[1-6]:(male|female):(normal|selected))$/.test(key)) { errors.push("Unknown artwork target."); continue; }
    const body = key.startsWith("body:"), width = body ? 128 : 32, height = body ? 40 : 32;
    if (image.width !== width || image.height !== height || image.pixels.length !== width * height * 4) errors.push(`${key}: import an exact ${width}×${height} PNG.`);
  }
  for (const [key, color] of Object.entries(design.colors)) {
    const index = Number(key.split(":")[1]);
    if (!/^2:[0-9]+$/.test(key) || !integer(index, 1, 159) || index % 16 === 0 || !/^#[0-9a-f]{6}$/i.test(color)) errors.push("Only button icon palette colors can change.");
  }

  return [...new Set(errors)];
}
export function neighbor(design: Design, source: number, direction: Direction, available = [1, 2, 3, 4, 5, 6, 7]): number {
  const b = design.buttons.find(b => b.id === source), override = b?.neighbors[direction];
  if (override && available.includes(override)) return override;
  const x = b ? b.x + 64 : 128, y = b ? b.y + 20 : 180;
  let best = source, score = Infinity;
  for (const id of available) {
    if (id === source) continue;
    const target = design.buttons.find(b => b.id === id), dx = (target ? target.x + 64 : 128) - x, dy = (target ? target.y + 20 : 180) - y;
    const along = direction === "up" ? -dy : direction === "down" ? dy : direction === "left" ? -dx : dx;
    const across = direction === "up" || direction === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along > 0 && along + across * 4 < score) { score = along + across * 4; best = id; }
  }
  return best;
}
