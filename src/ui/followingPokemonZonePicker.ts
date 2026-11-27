import { installSearchablePicker } from "./searchablePicker";

type ZoneChoice = { zone: number; label: string };

/** An explicit list keeps all same-name zones available when a native datalist limits suggestions. */
export function installFollowerZonePicker(input: HTMLInputElement, list: HTMLElement, choices: readonly ZoneChoice[]): void {
  installSearchablePicker(input, list, [{ zone: 0, label: "Any zone" }, ...choices], {
    matches: (choice, query) => choice.label.toLocaleLowerCase().includes(query) || String(choice.zone).includes(query),
    select: (choice) => {
      input.value = choice.zone ? choice.label : "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    emptyMessage: "No matching areas. You can still enter a numeric Zone ID.",
  });
}
