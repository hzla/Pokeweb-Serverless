import type { DialogueVariables } from "../pokeweb/bw2DialoguePreview";
import { escapeHtml } from "./dom";

/**
 * Game text with its control codes coloured. The highlighted copy sits under a
 * transparent textarea holding the raw text, so editing, the caret, selection
 * and find-next all work on exactly what is stored.
 */
const TOKEN = /(\\r)|(\\n)|(\\f)|(VAR\([^)\n]*\))|(\\x[0-9a-fA-F]{4})/gu;

export function highlightGameText(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    html += escapeHtml(text.slice(last, at));
    const kind = match[1] ? "page" : match[2] ? "line" : match[3] ? "scroll" : match[4] ? "var" : "code";
    html += `<span class="tx-tok -${kind}">${escapeHtml(match[0])}</span>`;
    last = at + match[0].length;
  }
  // A trailing space keeps the last line's height when the text ends in a break.
  return `${html}${escapeHtml(text.slice(last))} `;
}

export function renderGameTextEditor(value: string, attributes: string, placeholder = ""): string {
  return `
    <div class="tx-edit">
      <pre class="tx-hl" aria-hidden="true">${highlightGameText(value)}</pre>
      <textarea class="tx-input" rows="1" spellcheck="false" autocomplete="off" ${attributes}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}>${escapeHtml(value)}</textarea>
    </div>
  `;
}

/** Keep the highlight in step with typing. Shift+Enter types a \n code; Enter alone is left to the caller. */
export function installGameTextEditor(textarea: HTMLTextAreaElement): void {
  if (textarea.dataset.gameTextInstalled === "true") return;
  textarea.dataset.gameTextInstalled = "true";
  const highlight = textarea.previousElementSibling as HTMLElement | null;
  const sync = () => {
    if (highlight) highlight.innerHTML = highlightGameText(textarea.value);
  };
  textarea.addEventListener("input", sync);
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.shiftKey) return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = textarea;
    textarea.value = `${value.slice(0, selectionStart)}\\n${value.slice(selectionEnd)}`;
    textarea.setSelectionRange(selectionStart + 2, selectionStart + 2);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Word buffers (player name, Pokémon, items) have no fixed length in the
 * text itself; previews and overflow checks assume this many wide letters.
 */
export const ASSUMED_VARIABLE_LENGTH = 7;

export function assumedDialogueVariables(): DialogueVariables {
  return Object.fromEntries(Array.from({ length: 16 }, (_unused, slot) => [slot, { length: ASSUMED_VARIABLE_LENGTH, label: `assumed ${ASSUMED_VARIABLE_LENGTH} wide letters` }]));
}
