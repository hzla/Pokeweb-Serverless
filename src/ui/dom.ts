export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

export function selectText(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function scrollRowBelowStickyHeader(row: HTMLElement): void {
  const header = document.querySelector<HTMLElement>(".spreadsheet > .expanded-field.field-header");
  const headerBottom = (header?.getBoundingClientRect().bottom ?? 0) + 8;
  const rowTop = row.getBoundingClientRect().top;
  const delta = rowTop - headerBottom;
  const container = row.closest<HTMLElement>("#content-container");

  if (container) {
    container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "smooth" });
}
