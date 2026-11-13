/**
 * Gen 5 theme (experimental branch): marks what a button does by its label, so the stylesheet can colour it the way
 * the game colours its commands, without touching the pages that render the buttons:
 * - "Add …" and "+ …" buttons get `-g5-add` (green), and a leading "+" (`-g5-add-mark`) unless the label has one. A bare
 *   "+" (zoom, steppers) adds nothing, so it stays plain
 * - "Delete …", "Remove …", "Uninstall …" and "Disable …" buttons get `-g5-remove` (red), like the pages' own `-danger` buttons
 */
const ADD = /^(?:\+\s*\S|add\b)/iu;
const REMOVE = /^(?:delete|remove|uninstall|disable)\b/iu;

export function attachGen5ButtonRoles(root: HTMLElement): void {
  let scheduled = false;

  const scan = () => {
    scheduled = false;
    for (const button of root.querySelectorAll<HTMLElement>(".btn")) {
      const label = button.textContent?.trim() ?? "";
      if (button.dataset.g5Role === label) continue;
      button.dataset.g5Role = label;
      const add = ADD.test(label);
      button.classList.toggle("-g5-add", add);
      button.classList.toggle("-g5-add-mark", add && !label.startsWith("+"));
      button.classList.toggle("-g5-remove", REMOVE.test(label));
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  };

  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
  schedule();
}
