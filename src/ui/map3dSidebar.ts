export type Map3dSidebarTab = "view" | "camera" | "buildings" | "settings" | "collisions";
const tabs: Array<{ id: Map3dSidebarTab; label: string }> = [
  { id: "view", label: "View" }, { id: "camera", label: "Camera" }, { id: "buildings", label: "Buildings" },
  { id: "settings", label: "Map settings" }, { id: "collisions", label: "Collisions" },
];

/** Move existing controls into panels so their values and listeners stay intact. */
export function organizeMap3dSidebar(root: HTMLElement, changed: (tab: Map3dSidebarTab) => void) {
  const sidebar = root.querySelector<HTMLElement>(".map3d-sidebar")!;
  sidebar.classList.add("map3d-tabbed-sidebar");
  const picker = document.createElement("div"); picker.className = "map3d-map-picker";
  const season = sidebar.querySelector("#map3d-season-picker")!;
  for (const child of Array.from(sidebar.children)) { if (child.id !== "map3d-import-review") picker.append(child); if (child === season) break; }
  const nav = document.createElement("div"); nav.className = "map3d-sidebar-tabs"; nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Map editor tools");
  const content = document.createElement("div"); content.className = "map3d-tab-panels";
  const panels = new Map<Map3dSidebarTab, HTMLElement>();
  for (const tab of tabs) {
    const button = document.createElement("button"); button.type = "button"; button.id = `map3d-tab-${tab.id}`;
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `map3d-panel-${tab.id}`); button.textContent = tab.label;
    const panel = document.createElement("section"); panel.id = `map3d-panel-${tab.id}`; panel.className = "map3d-tab-panel";
    panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", button.id); panels.set(tab.id, panel);
    nav.append(button); content.append(panel);
    button.addEventListener("click", () => select(tab.id));
    button.addEventListener("keydown", event => {
      const index = tabs.findIndex(t => t.id === tab.id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
      if (next < 0) return; event.preventDefault(); select(tabs[next].id); (nav.children[next] as HTMLButtonElement).focus();
    });
  }
  const move = (tab: Map3dSidebarTab, selector: string) => { const node = sidebar.querySelector(selector); if (node) panels.get(tab)!.append(node); };
  const neighborLabel = sidebar.querySelector("#map3d-show-neighbors")?.closest("label");
  if (neighborLabel) { const note = neighborLabel.nextElementSibling; panels.get("view")!.append(neighborLabel); if (note) panels.get("view")!.append(note); }
  move("view", '[aria-label="Texture animation preview"]'); move("view", ".map3d-layer-grid");
  move("camera", "#map3d-camera-inspector"); move("buildings", "#map3d-building-inspector");
  move("settings", ".map3d-metadata-editor"); move("collisions", ".map3d-permission-editor");
  const review = sidebar.querySelector("#map3d-import-review"); if (review) content.prepend(review);
  sidebar.append(picker, nav, content);
  let active: Map3dSidebarTab = "view";
  function select(id: Map3dSidebarTab) {
    active = id;
    for (const tab of tabs) {
      const selected = tab.id === id, button = nav.querySelector<HTMLButtonElement>(`#map3d-tab-${tab.id}`)!;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; panels.get(tab.id)!.hidden = !selected;
    }
    content.scrollTop = 0; changed(id);
  }
  select(active);
  return { select, get active() { return active; } };
}
