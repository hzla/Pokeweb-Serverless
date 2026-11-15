/*
 * Names for Gen 5 collision tile classes (the "attribute" half of a permission tile), grouped for a picker. The game
 * names none of them; these come from how the retail maps use each class, so some are a family rather than one
 * behaviour. Classes not listed here can still be entered as numbers.
 */

export type TileClassGroup = { label: string; classes: Array<[number, string]> };

const range = (from: number, to: number, label: (value: number) => string): Array<[number, string]> =>
  Array.from({ length: to - from + 1 }, (_, index) => [from + index, label(from + index)]);

export const GEN5_TILE_CLASS_GROUPS: TileClassGroup[] = [
  { label: "Ground", classes: [[0, "Ground"], [17, "Ground"], [19, "Ground"], [2, "Seasonal ground"], [3, "Seasonal ground"], [30, "Seasonal ground"]] },
  { label: "Blocked", classes: [[1, "Blocked"], [18, "Blocked"], ...range(81, 88, () => "One-way wall")] },
  {
    label: "Encounters",
    classes: [[4, "Grass"], [5, "Grass"], [6, "Dark grass (double battles)"], ...range(7, 10, () => "Encounter terrain"), [13, "Encounter terrain"], [22, "Encounter terrain"], [33, "Encounter terrain"], [34, "Encounter terrain"]],
  },
  { label: "Sand", classes: [[11, "Sand (encounters)"], [12, "Desert (encounters)"], [25, "Sand"], [35, "Desert (encounters)"], [124, "Drift sand"]] },
  { label: "Snow and ice", classes: [[14, "Snow"], [15, "Snow"], [16, "Ice"], [24, "Snow"], ...range(160, 168, () => "Slippery ice")] },
  { label: "Water", classes: [[20, "Puddle"], [21, "Shoal"], [23, "Marsh"], [28, "Deep marsh"], ...range(61, 68, (value) => value === 66 ? "Deep marsh" : "Water"), ...range(148, 156, () => "Current"), [176, "Dive spot"]] },
  { label: "Movement", classes: [...range(114, 121, () => "Jump or forced move"), [48, "Electric floor"], [49, "Floating floor"], [50, "Electric rock"], [51, "Up/down floor"]] },
  { label: "Special", classes: [[27, "Mirror floor"], [29, "Boulder hole"], [31, "Lawn"], [32, "Bridge"], [190, "Ooze"], [191, "Ooze stairs"]] },
  { label: "Indoors", classes: range(212, 226, () => "Counter, PC, TV, shelf or machine") },
  { label: "None", classes: [[255, "No attribute"]] },
];

const names = new Map(GEN5_TILE_CLASS_GROUPS.flatMap((group) => group.classes));

/** The class's name, or undefined for a class no retail map is known to use. */
export function gen5TileClassName(tileClass: number): string | undefined {
  return names.get(tileClass);
}
