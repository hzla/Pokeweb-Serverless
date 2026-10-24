/** Reuse the visible, crawlable HTML from index.html when the app renders home. */
export function renderHomepage(root: HTMLElement, homepageMarkup: string, toolsMarkup: string): void {
  root.classList.add("homepage-content");
  root.innerHTML = homepageMarkup;
  const tools = root.querySelector<HTMLElement>("[data-home-tools]");
  if (!tools) throw new Error("Missing homepage tools mount");
  tools.innerHTML = toolsMarkup;

  // The editor owns URL hashes. Scroll these page links without changing routes.
  root.querySelectorAll<HTMLAnchorElement>("[data-home-scroll]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const id = link.getAttribute("href")?.slice(1);
      const target = id ? root.querySelector<HTMLElement>(`#${id}`) : undefined;
      if (!target) return;
      event.preventDefault();
      if (link.hasAttribute("data-home-open-rom")) {
        root.querySelector<HTMLButtonElement>("#home-tab-upload")?.click();
      }
      target.scrollIntoView({ block: "start" });
      const focusTarget = link.hasAttribute("data-home-open-rom")
        ? root.querySelector<HTMLInputElement>("#rom-input") ?? target
        : target;
      focusTarget.focus({ preventScroll: true });
    });
  });
}
