import { newElement, newProject, type PhysicalScreen, type Project, type Rect } from "./document";

export const NATIVE_REGIONS: (Rect & { id: string; name: string; screen: PhysicalScreen; mask: number; required?: boolean; description: string })[] = [
  { id: "learnset.background", name: "Learnset background", screen: "top", x: 0, y: 0, width: 256, height: 192, mask: 32, required: true, description: "Native tutor artwork and the current learnset viewer's panels." },
  { id: "learnset.header", name: "Species header", screen: "top", x: 0, y: 0, width: 256, height: 40, mask: 1, description: "Native species title, type badges, and party position." },
  { id: "learnset.stats", name: "Base stats", screen: "top", x: 0, y: 40, width: 112, height: 92, mask: 2, description: "Six live base stats and their native bars." },
  { id: "learnset.family", name: "Evolution family", screen: "top", x: 112, y: 40, width: 144, height: 42, mask: 4, description: "Native forms, family navigation, and animated icons." },
  { id: "learnset.abilities", name: "Abilities", screen: "top", x: 112, y: 82, width: 144, height: 50, mask: 8, description: "Normal and hidden abilities using the native font and palette." },
  { id: "learnset.evolution", name: "Evolution requirements", screen: "top", x: 0, y: 132, width: 256, height: 60, mask: 16, description: "Native requirement text, wrapping, branches, and A-button paging." },
  { id: "learnset.moves", name: "Move tutor list and details", screen: "bottom", x: 0, y: 0, width: 256, height: 192, mask: 0, required: true, description: "The read-only native move list, scrolling, descriptions, and Exit control." },
];

/** A native screen is imported as named live regions, not a screenshot. */
export function nativeLearnsetPreset(): Project {
  const project = newProject(), screen = project.document.screens[0];
  project.document.name = "Native Learnset viewer"; screen.id = "learnset"; screen.name = "Learnset viewer";
  project.document.launchers = { party: screen.id };
  screen.shortcuts = { a: { type: "nextEvolution" }, left: { type: "cycleParty", delta: -1 }, right: { type: "cycleParty", delta: 1 }, l: { type: "family", delta: -1 }, r: { type: "family", delta: 1 } };
  screen.elements = NATIVE_REGIONS.map(r => { const e = newElement("native", r.id.replaceAll(".", "-"), r.screen); Object.assign(e, { name: r.name, native: r.id, x: r.x, y: r.y, width: r.width, height: r.height }); return e; });
  return project;
}
