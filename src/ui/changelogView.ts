import { clearActionChangelog, domainTitle, ensureActionChangelog, renderActionChangelogText } from "../pokeweb/actionChangelog";
import type { ActionChangelogEntry } from "../pokeweb/actionChangelog";
import type { ChangelogEntry } from "../pokeweb/changelogModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type RenderableChangelogEntry = Pick<ChangelogEntry, "domain" | "subject" | "text" | "parts"> | ActionChangelogEntry;

export function renderActionChangelogPage(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const state = ensureActionChangelog(project);
  const text = renderActionChangelogText(project);
  root.innerHTML = `
    <section class="changelog-page">
      <div class="changelog-page__header">
        <div>
          <h1>Changelog</h1>
          <p>${escapeHtml(state.romName)} · ${escapeHtml(state.baseVersion)} · ${state.entries.length} change${state.entries.length === 1 ? "" : "s"}</p>
        </div>
        <div class="changelog-actions">
          <button class="btn -default" id="copy-action-changelog-btn" type="button" ${text.length ? "" : "disabled"}>Copy</button>
          <button class="btn -default" id="download-action-changelog-btn" type="button" ${text.length ? "" : "disabled"}>Download TXT</button>
          <button class="btn -default" id="clear-action-changelog-btn" type="button" ${state.entries.length ? "" : "disabled"}>Clear Changelog</button>
        </div>
      </div>
      <textarea id="action-changelog-output" class="changelog-output" readonly>${escapeHtml(text)}</textarea>
      <div id="action-changelog-tabs" class="changelog-tabs"></div>
    </section>
  `;
  renderChangelogTabs(root, state.entries, "#action-changelog-tabs", "No changes recorded since this ROM was loaded.");

  root.querySelector<HTMLButtonElement>("#copy-action-changelog-btn")?.addEventListener("click", async () => {
    await copyText(text, root.querySelector<HTMLTextAreaElement>("#action-changelog-output"));
  });

  root.querySelector<HTMLButtonElement>("#download-action-changelog-btn")?.addEventListener("click", () => {
    downloadTextFile("pokeweb-changelog.txt", text);
  });

  root.querySelector<HTMLButtonElement>("#clear-action-changelog-btn")?.addEventListener("click", () => {
    if (!window.confirm("Clear the changelog for this editing session? ROM edits will not be changed.")) return;
    clearActionChangelog(project);
    onDirty();
    renderActionChangelogPage(project, root, onDirty);
  });
}

export function renderChangelogTabs(
  root: HTMLElement,
  entries: RenderableChangelogEntry[],
  selector = "#changelog-tabs",
  emptyText = "No changes detected in the selected Pokeweb data.",
): void {
  const container = root.querySelector<HTMLElement>(selector);
  if (!container) return;
  const groups = groupChangelogEntries(entries);
  if (groups.length === 0) {
    container.innerHTML = `<div class="changelog-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = `
    <div class="changelog-tab-list" role="tablist">
      ${groups
        .map(
          (group, index) =>
            `<button class="changelog-tab ${index === 0 ? "-active" : ""}" type="button" role="tab" data-changelog-tab="${escapeHtml(group.key)}">${escapeHtml(group.label)} <span>${group.entries.length}</span></button>`,
        )
        .join("")}
    </div>
    <div class="changelog-tab-panels">
      ${groups
        .map(
          (group, index) =>
            `<section class="changelog-tab-panel ${index === 0 ? "-active" : ""}" data-changelog-panel="${escapeHtml(group.key)}">
              ${renderChangelogSubjectGroups(group.entries)}
            </section>`,
        )
        .join("")}
    </div>
  `;
  container.querySelectorAll<HTMLButtonElement>("[data-changelog-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.changelogTab ?? "";
      container.querySelectorAll<HTMLElement>(".changelog-tab").forEach((tab) => tab.classList.toggle("-active", tab === button));
      container.querySelectorAll<HTMLElement>(".changelog-tab-panel").forEach((panel) => {
        panel.classList.toggle("-active", panel.dataset.changelogPanel === key);
      });
    });
  });
}

export function clearChangelogTabs(root: HTMLElement, selector = "#changelog-tabs"): void {
  const container = root.querySelector<HTMLElement>(selector);
  if (container) container.innerHTML = "";
}

export function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string, fallback?: HTMLTextAreaElement | null): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallback?.select();
    document.execCommand("copy");
  }
}

function groupChangelogEntries(entries: RenderableChangelogEntry[]): Array<{ key: string; label: string; entries: RenderableChangelogEntry[] }> {
  const keyFor = (domain: string): string => {
    if (domain === "learnsets" || domain === "evolutions" || domain === "egg_moves") return "personal";
    if (domain === "trdata" || domain === "trpok" || domain === "trainer_text") return "trainers";
    if (domain === "grotto_odds") return "grottos";
    if (domain === "matrix" || domain === "overworlds" || domain === "maps3d") return "maps";
    if (domain === "move_animations" || domain === "battle_animations" || domain === "move_spas") return "animations";
    if (domain === "pokemon_sprites" || domain === "pokemon_icons" || domain === "starter_sprites") return "sprites";
    if (domain.startsWith("pwt_") || domain.startsWith("subway_") || domain.startsWith("wbt_") || domain === "facilities") return "facilities";
    return domain;
  };
  const labels: Record<string, string> = {
    personal: "Pokemon",
    trainers: "Trainers",
    grottos: "Grottoes",
    maps: "Maps",
    animations: "Animations",
    sprites: "Sprites",
    facilities: "Facilities",
  };
  const grouped = new Map<string, RenderableChangelogEntry[]>();
  for (const entry of entries) {
    const key = keyFor(entry.domain);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return [...grouped.entries()].map(([key, groupEntries]) => ({ key, label: labels[key] ?? domainTitle(key), entries: groupEntries }));
}

function renderChangelogSubjectGroups(entries: RenderableChangelogEntry[]): string {
  const grouped = new Map<string, RenderableChangelogEntry[]>();
  for (const entry of entries) {
    const key = entry.subject ?? "Changes";
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return [...grouped.entries()]
    .map(
      ([subject, subjectEntries]) => `
        <article class="changelog-subject">
          <h3>${escapeHtml(subject)}</h3>
          <ul>
            ${subjectEntries.map((entry) => `<li>${renderChangelogEntry(entry)}</li>`).join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

function renderChangelogEntry(entry: RenderableChangelogEntry): string {
  if (!entry.parts) return escapeHtml(entry.text);
  return entry.parts
    .map((part) => `${part.breakBefore ? "<br>" : ""}<span class="${part.changed ? "changelog-changed" : ""}">${escapeHtml(part.text)}</span>`)
    .join("");
}
