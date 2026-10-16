/** Dropdown labels activate the first item; hover and keyboard focus expose the menu. */
export function attachNavigationDropdowns(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".header-more").forEach(menu => {
    const trigger = menu.querySelector<HTMLButtonElement>(".header-more-trigger");
    if (!trigger) return;
    let hovered = false, focused = false;
    const update = () => trigger.setAttribute("aria-expanded", String(hovered || focused));
    trigger.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      const first = menu.querySelector<HTMLAnchorElement>(".header-more-menu > .header-item");
      if (first && !first.classList.contains("disabled") && first.getAttribute("aria-disabled") !== "true") first.click();
    });
    trigger.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      const first = menu.querySelector<HTMLAnchorElement>('.header-more-menu > .header-item:not(.disabled):not([aria-disabled="true"])');
      menu.classList.add("-open"); trigger.setAttribute("aria-expanded", "true"); first?.focus();
    });
    menu.addEventListener("pointerenter", () => { hovered = true; update(); });
    menu.addEventListener("pointerleave", () => { hovered = false; if (!focused) menu.classList.remove("-open"); update(); });
    menu.addEventListener("focusin", () => { focused = true; update(); });
    menu.addEventListener("focusout", event => {
      if (menu.contains(event.relatedTarget as Node | null)) return;
      focused = false; if (!hovered) menu.classList.remove("-open"); update();
    });
  });
}
