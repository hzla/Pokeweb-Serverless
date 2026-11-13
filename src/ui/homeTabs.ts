export const HOME_TABS = ["upload", "repair", "translation", "changelog", "about", "ai-use-disclaimer"] as const;
export type HomeTab = typeof HOME_TABS[number];

export function homeTabOrDefault(value: unknown): HomeTab {
  return HOME_TABS.includes(value as HomeTab) ? value as HomeTab : "upload";
}

export function homeTabUrl(tab: HomeTab): string {
  return tab === "upload" ? "#upload" : `#upload/${tab}`;
}

export function homeTabFromHash(hash: string): HomeTab | undefined {
  const [route, tab] = hash.replace(/^#/u, "").split("/");
  return route === "upload" ? homeTabOrDefault(tab) : undefined;
}

export function attachHomeTabs(root: HTMLElement, options: {
  initialTab?: HomeTab;
  onSelect?: (tab: HomeTab) => void;
} = {}): { select: (name: HomeTab) => void } {
  const tabs = [...root.querySelectorAll<HTMLAnchorElement>("[data-home-tab]")];
  let selected: HomeTab | undefined;
  const select = (name: HomeTab) => {
    const tab = tabs.find(candidate => candidate.dataset.homeTab === name);
    if (!tab) return;
    selected = name;
    tabs.forEach((candidate) => {
      const active = candidate === tab;
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll<HTMLElement>("[data-home-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.homePanel !== tab.dataset.homeTab;
    });
  };
  const activate = (tab: HTMLAnchorElement) => {
    const name = homeTabOrDefault(tab.dataset.homeTab);
    if (name === selected) return;
    select(name);
    options.onSelect?.(name);
  };
  select(options.initialTab ?? "upload");
  tabs.forEach((tab, index) => {
    tab.href = homeTabUrl(homeTabOrDefault(tab.dataset.homeTab));
    tab.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      activate(tab);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        activate(tab);
        return;
      }
      // Left/right for a row of tabs, up/down for the main menu's column.
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
  return { select };
}
