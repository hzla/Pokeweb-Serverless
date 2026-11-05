import { selectText } from "./dom";
import { installPicker } from "./trainerInteractions";

/**
 * Shared field behaviour for list + detail editors: contenteditable fields
 * select on focus, open a picker when they have options, commit on blur or
 * Enter, and revert on Escape or a rejected value.
 */
export function installDetailFields(
  container: HTMLElement,
  options: {
    autofills: Record<string, string[]>;
    /** Return false to reject the value; the field then reverts. */
    commit: (field: HTMLElement, value: string) => boolean;
  },
): void {
  container.querySelectorAll<HTMLElement>("[contenteditable='true'][data-field-name]").forEach((field) => {
    if (field.dataset.detailInstalled === "true") return;
    field.dataset.detailInstalled = "true";
    let initial = field.textContent?.trim() ?? "";
    const picker = field.dataset.autofill ? installPicker(field, options.autofills[field.dataset.autofill] ?? []) : undefined;
    field.addEventListener("focus", () => {
      initial = field.textContent?.trim() ?? "";
      window.setTimeout(() => {
        if (document.activeElement === field) selectText(field);
      }, 0);
      picker?.open();
    });
    field.addEventListener("input", () => {
      field.classList.remove("invalid");
      delete field.dataset.commitValue;
      delete field.dataset.commitLabel;
    });
    field.addEventListener("keydown", (event) => {
      if (picker?.handleKey(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      } else if (event.key === "Escape") {
        field.textContent = initial;
        field.blur();
      }
    });
    field.addEventListener("blur", () => {
      picker?.close();
      let value = field.textContent?.trim() ?? "";
      if (field.dataset.commitValue !== undefined && field.dataset.commitLabel === value) value = field.dataset.commitValue;
      else if (value === initial) {
        field.textContent = initial;
        return;
      }
      if (options.commit(field, value)) {
        field.classList.remove("invalid");
        field.removeAttribute("title");
        initial = field.textContent?.trim() ?? "";
      } else {
        field.textContent = initial;
        field.classList.add("invalid");
      }
    });
  });
}

/**
 * Apply freshly rendered detail HTML. When the same fields exist, values and
 * `[data-derived]` blocks are copied in place so focus and pending clicks
 * survive; otherwise the detail is replaced and `install` runs again.
 */
export function patchDetail(detail: HTMLElement, html: string, install: (root: HTMLElement) => void): void {
  const next = document.createElement("template");
  next.innerHTML = html;
  const signature = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>("[data-field-name], [data-structure]")]
    .map((element) => `${element.tagName}:${element.dataset.fieldName ?? element.dataset.structure ?? ""}`)
    .join(",");
  if (signature(next.content) !== signature(detail)) {
    const scrollTop = detail.scrollTop;
    detail.innerHTML = next.innerHTML;
    install(detail);
    detail.scrollTop = scrollTop;
    return;
  }
  next.content.querySelectorAll<HTMLElement>("[data-derived]").forEach((source) => {
    const target = detail.querySelector<HTMLElement>(`[data-derived="${source.dataset.derived}"]`);
    if (target) target.innerHTML = source.innerHTML;
  });
  next.content.querySelectorAll<HTMLElement>("[data-field-name]").forEach((source) => {
    const target = detail.querySelector<HTMLElement>(`${source.tagName.toLowerCase()}[data-field-name="${source.dataset.fieldName}"]`);
    if (!target || target === document.activeElement) return;
    if (target instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
      target.innerHTML = source.innerHTML;
      target.value = source.value;
    } else if (target instanceof HTMLInputElement && source instanceof HTMLInputElement) {
      target.checked = source.checked;
    } else {
      target.textContent = source.textContent;
      if (source.dataset.placeholder) target.dataset.placeholder = source.dataset.placeholder;
    }
  });
}

/** Toggle `.is-edited` on `[data-mark-fields]` ("a|b|c") from changed field suffixes. */
export function refreshEditMarks(scope: HTMLElement, edited: Set<string>): void {
  scope.querySelectorAll<HTMLElement>("[data-mark-fields]").forEach((element) => {
    element.classList.toggle("is-edited", (element.dataset.markFields ?? "").split("|").some((field) => edited.has(field)));
  });
}

/** Up/down arrow navigation over the visible rows of a list. */
export function attachListArrows(list: HTMLElement, rowSelector: string, select: (row: HTMLElement) => void): void {
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>(rowSelector)].filter((row) => row.style.display !== "none");
    const index = rows.findIndex((row) => row.classList.contains("is-selected"));
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(next);
  });
}

export function markSelectedRow(list: HTMLElement, rowSelector: string, isSelected: (row: HTMLElement) => boolean, scroll: boolean): void {
  list.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
    const active = isSelected(row);
    row.classList.toggle("is-selected", active);
    row.setAttribute("aria-selected", String(active));
    if (active && scroll) row.scrollIntoView({ block: "nearest" });
  });
}

export function changedKeys(entries: Array<{ key: string }> | undefined, prefix: string): Set<string> {
  return new Set((entries ?? []).filter((entry) => entry.key.startsWith(prefix)).map((entry) => entry.key.slice(prefix.length)));
}
