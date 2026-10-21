import { escapeHtml } from "./dom";

type ZoneChoice = { zone: number; label: string };

/** An explicit list keeps all same-name zones available in browsers whose
 * native datalist popup is absent or limits the number of suggestions. */
export function installFollowerZonePicker(input: HTMLInputElement, list: HTMLElement, choices: readonly ZoneChoice[]): void {
  let matches: readonly ZoneChoice[] = [], active = -1;
  const all = [{ zone: 0, label: "Any zone" }, ...choices];
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  function close(): void {
    list.hidden = true; active = -1;
    input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
  }
  function highlight(index: number): void {
    active = index;
    const options = list.querySelectorAll<HTMLElement>("[role=option]");
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
    const option = options[active];
    if (option) { input.setAttribute("aria-activedescendant", option.id); option.scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }
  function show(): void {
    const query = input.value.trim().toLocaleLowerCase();
    matches = all.filter(choice => !query || choice.label.toLocaleLowerCase().includes(query) || String(choice.zone).includes(query));
    list.innerHTML = matches.length ? matches.map((choice, index) => `<div role="option" id="${list.id}-${index}" aria-selected="false" data-fw-zone-choice="${index}">${escapeHtml(choice.label)}</div>`).join("") : `<div class="following-zone-empty">No matching areas. You can still enter a numeric Zone ID.</div>`;
    list.hidden = false; input.setAttribute("aria-expanded", "true"); highlight(-1);
  }
  function select(index: number): void {
    if (!matches[index]) return;
    input.value = matches[index].zone ? matches[index].label : "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }
  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("click", () => { if (list.hidden) show(); });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") { close(); event.preventDefault(); return; }
    if (event.key === "Tab") { close(); return; }
    if (event.key === "Enter" && !list.hidden && active >= 0) { event.preventDefault(); select(active); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (list.hidden) show();
    if (matches.length) highlight((active + (event.key === "ArrowDown" ? 1 : active < 0 ? 0 : -1) + matches.length) % matches.length);
  });
  list.addEventListener("mousedown", event => event.preventDefault()); // Keep the input focused until a choice is committed.
  list.addEventListener("click", event => {
    const option = (event.target as Element).closest<HTMLElement>("[data-fw-zone-choice]");
    if (option) select(Number(option.dataset.fwZoneChoice));
  });
}
