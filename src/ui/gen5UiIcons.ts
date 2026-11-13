import { typeNamesForProject } from "../pokeweb/constants";
import { categoryIconImage, ensureGen5RomBytes, gameTextImage, gen5UiImageUrl, hasGen5RomBytes, MOVE_CATEGORY_ICON_ORDER, tmDiscImage, typeIconImage } from "../pokeweb/gen5UiImages";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * Gen 5 theme (experimental branch): puts the ROM's own type and move category icons into the editor's type plates
 * (`.type-plate`, the TMs page's `.move-type` labels and type filter buttons, the type chart's headings) and
 * category labels (`.move-cat`, the category filter buttons), wherever pages render them, and a TM disc in the TMs
 * type's colour beside each TM and HM number. The text stays in the element for search, copying and screen readers;
 * the stylesheet shows the icon instead. Editable type pickers show their text again while focused. A ROM without an
 * icon keeps the plain plate. The homepage's menu options get their labels drawn in the game's own font.
 */

/** Elements that show a type, and the type name each shows. */
const TYPE_ELEMENTS: readonly { selector: string; label: (element: HTMLElement) => string }[] = [
  { selector: ".type-plate", label: (element) => element.textContent ?? "" },
  { selector: ".move-type > .btn", label: (element) => element.textContent ?? "" },
  { selector: ".type-filters .btn[data-ptype]", label: (element) => element.dataset.ptype ?? "" },
  { selector: ".type-chart-heading", label: (element) => element.title },
];

/** "TM-1", "HM-6": the TMs page's item column. */
const TM_LABEL = /^(?:tm|hm)-?\d+$/u;
export function attachGen5UiIcons(root: HTMLElement, currentProject: () => ProjectState | undefined): void {
  let scheduled = false;
  let typeIndex: { project: ProjectState; byName: Map<string, number> } | undefined;

  const indexFor = (project: ProjectState) => {
    if (typeIndex?.project !== project) {
      typeIndex = { project, byName: new Map(typeNamesForProject(project).map((name, index) => [name.trim().toLowerCase(), index])) };
    }
    return typeIndex.byName;
  };

  const apply = (element: HTMLElement, url: string | undefined, label: string) => {
    if (element.dataset.g5Icon !== label) return; // the text changed while the icon loaded
    if (url) {
      element.style.setProperty("--g5-icon", `url("${url}")`);
      element.classList.add("-g5-icon");
    } else {
      element.style.removeProperty("--g5-icon");
      element.classList.remove("-g5-icon");
    }
  };

  const applyDisc = (element: HTMLElement, url: string | undefined, label: string) => {
    if (element.dataset.g5Icon !== label) return;
    if (url) {
      element.style.setProperty("--g5-disc", `url("${url}")`);
      element.classList.add("-g5-disc");
    } else {
      element.style.removeProperty("--g5-disc");
      element.classList.remove("-g5-disc");
    }
  };

  const scan = () => {
    scheduled = false;
    const project = currentProject();
    if (!project) return;
    if (!hasGen5RomBytes(project)) {
      // Fetch the stored ROM once; scan again when it's there.
      void ensureGen5RomBytes(project).then((ok) => ok && schedule());
      return;
    }
    const types = indexFor(project);
    for (const { selector, label: labelOf } of TYPE_ELEMENTS) {
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const label = labelOf(element).trim().toLowerCase();
        if (element.dataset.g5Icon === label) continue;
        element.dataset.g5Icon = label;
        const type = types.get(label);
        if (type === undefined) {
          apply(element, undefined, label);
          continue;
        }
        void gen5UiImageUrl(project, `type:${type}`, () => typeIconImage(project, type)).then((url) => apply(element, url, label));
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>(".move-cat")) {
      const text = element.textContent?.trim().toLowerCase() ?? "";
      if (TM_LABEL.test(text)) {
        // The disc follows the row's type, so the key carries both.
        const typeName = element.closest(".expanded-field-main")?.querySelector(".move-type")?.textContent?.trim() ?? "";
        const label = `${text}|${typeName.toLowerCase()}`;
        if (element.dataset.g5Icon === label) continue;
        element.dataset.g5Icon = label;
        void gen5UiImageUrl(project, `tm:${typeName.toLowerCase()}`, () => tmDiscImage(project, typeName)).then((url) => applyDisc(element, url, label));
        continue;
      }
      applyCategory(project, element, text);
    }
    for (const element of root.querySelectorAll<HTMLElement>(".cat-filters .btn[data-mcat]")) {
      applyCategory(project, element, element.dataset.mcat?.trim().toLowerCase() ?? "");
    }
    // The main menu's options, in capitals as the game prints them.
    for (const element of root.querySelectorAll<HTMLElement>(".upload-page .home-tab")) {
      const label = element.textContent?.trim().toUpperCase() ?? "";
      if (element.dataset.g5Label === label) continue;
      element.dataset.g5Label = label;
      void gen5UiImageUrl(project, `text:${label}`, () => gameTextImage(project, label)).then((url) => applyLabel(element, url, label));
    }
  };

  const applyLabel = async (element: HTMLElement, url: string | undefined, label: string) => {
    if (!url) return;
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (element.dataset.g5Label !== label) return;
    element.style.setProperty("--g5-label", `url("${url}")`);
    element.style.setProperty("--g5-label-w", `${image.naturalWidth * 2}px`);
    element.style.setProperty("--g5-label-h", `${image.naturalHeight * 2}px`);
    element.classList.add("-g5-label");
  };

  const applyCategory = (project: ProjectState, element: HTMLElement, label: string) => {
    if (element.dataset.g5Icon === label) return;
    element.dataset.g5Icon = label;
    const category = MOVE_CATEGORY_ICON_ORDER.findIndex((name) => name.toLowerCase() === label);
    if (category < 0) {
      apply(element, undefined, label);
      return;
    }
    void gen5UiImageUrl(project, `category:${category}`, () => categoryIconImage(project, category)).then((url) => apply(element, url, label));
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  };

  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
  root.addEventListener("focusout", schedule);
  schedule();
}
