export type Map3dSidebarTab = "map" | "collisions" | "buildings" | "camera";

/** The map editor's sidebar folder tabs: Map, Collisions, Buildings and (Gen 5) Camera, over panels already in the page. */
export function setupMap3dTabs(root: HTMLElement, changed: (tab: Map3dSidebarTab) => void) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-map-tab]"));
  const tabs = buttons.map((button) => button.dataset.mapTab as Map3dSidebarTab);
  const scroller = root.querySelector<HTMLElement>(".mx-side");
  let active: Map3dSidebarTab = "map";
  function select(id: Map3dSidebarTab) {
    if (!tabs.includes(id)) id = "map";
    const changedTab = active !== id;
    active = id;
    for (const button of buttons) {
      const selected = button.dataset.mapTab === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      const panel = root.querySelector<HTMLElement>(`#map3d-panel-${button.dataset.mapTab}`);
      if (panel) panel.hidden = !selected;
    }
    if (changedTab && scroller) scroller.scrollTop = 0;
    changed(id);
  }
  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => select(tabs[index]!));
    button.addEventListener("keydown", (event) => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : -1;
      if (next < 0) return;
      event.preventDefault();
      select(tabs[next]!);
      buttons[next]!.focus();
    });
  }
  select(active);
  return { select, get active() { return active; } };
}
