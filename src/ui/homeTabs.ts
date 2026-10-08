export function attachHomeTabs(root: HTMLElement): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-home-tab]")];
  const select = (tab: HTMLButtonElement) => {
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll<HTMLElement>("[data-home-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.homePanel !== tab.dataset.homeTab;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      select(tabs[next]);
      tabs[next].focus();
    });
  });
}
