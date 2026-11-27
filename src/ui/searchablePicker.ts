import { escapeHtml } from "./dom";

type PickerOptions<T> = {
  matches: (choice: T, query: string) => boolean;
  select: (choice: T) => void;
  emptyMessage: string;
  onDismiss?: () => void;
};

export function installSearchablePicker<T extends { label: string }>(
  input: HTMLInputElement,
  list: HTMLElement,
  choices: readonly T[],
  options: PickerOptions<T>,
): void {
  let matches: readonly T[] = [];
  let active = -1;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  function close(): void {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function dismiss(): void {
    if (list.hidden) return;
    close();
    options.onDismiss?.();
  }

  function highlight(index: number): void {
    active = index;
    const entries = list.querySelectorAll<HTMLElement>("[role=option]");
    entries.forEach((entry, i) => entry.setAttribute("aria-selected", String(i === active)));
    const entry = entries[active];
    if (entry) {
      input.setAttribute("aria-activedescendant", entry.id);
      entry.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function show(): void {
    const query = input.value.trim().toLocaleLowerCase();
    matches = choices.filter((choice) => options.matches(choice, query));
    list.innerHTML = matches.length
      ? matches.map((choice, index) => `<div role="option" id="${list.id}-${index}" aria-selected="false" data-picker-choice="${index}">${escapeHtml(choice.label)}</div>`).join("")
      : `<div data-picker-empty>${escapeHtml(options.emptyMessage)}</div>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(-1);
    list.scrollTop = 0;
  }

  function select(index: number): void {
    const choice = matches[index];
    if (!choice) return;
    options.select(choice);
    close();
  }

  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("click", () => { if (list.hidden) show(); });
  input.addEventListener("blur", dismiss);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape" && !list.hidden) {
      dismiss();
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === "Tab") dismiss();
    if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault();
      select(active);
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (list.hidden) show();
    if (matches.length) {
      const next = event.key === "ArrowDown" ? active + 1 : active < 0 ? matches.length - 1 : active - 1;
      highlight((next + matches.length) % matches.length);
    }
  });
  // Keep the input focused until a choice is committed.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const entry = (event.target as Element).closest<HTMLElement>("[data-picker-choice]");
    if (entry) select(Number(entry.dataset.pickerChoice));
  });
}
