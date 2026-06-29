import {
  canOfferW2uLocalSync,
  getW2uSyncStatus,
  pickW2uRepoFolder,
  readStoredW2uRepoPath,
  rememberW2uRepoPath,
  syncW2uDomains,
  type W2uSyncDomain,
} from "../pokeweb/w2uLocalSync";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function renderW2uSyncButton(project: ProjectState, domains: readonly W2uSyncDomain[]): string {
  if (!canOfferW2uLocalSync(project)) return "";
  return `
    <div class="w2u-sync-panel">
      <div class="filter-title">W2U Repo</div>
      <div class="w2u-sync-path-row">
        <input
          class="filter-input w2u-sync-path-input"
          placeholder="/path/to/White2Upgrade"
          spellcheck="false"
          autocomplete="off"
        />
        <button class="btn -default w2u-sync-pick-button" type="button" title="Select White2Upgrade repo folder">Browse...</button>
      </div>
      <button
        class="btn -default w2u-sync-button"
        data-w2u-domains="${escapeHtml(domains.join(","))}"
        title="Sync dirty edits from this page to local White2Upgrade TOML"
        type="button"
      >
        Sync W2U TOML
      </button>
    </div>
  `;
}

export function attachW2uSyncButton(root: HTMLElement, project: ProjectState): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(".w2u-sync-path-input")) {
    hydrateW2uRepoPathInput(input);
    input.addEventListener("change", () => rememberW2uRepoPath(input.value));
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>(".w2u-sync-pick-button")) {
    button.addEventListener("click", async () => {
      const panel = button.closest<HTMLElement>(".w2u-sync-panel");
      const pathInput = panel?.querySelector<HTMLInputElement>(".w2u-sync-path-input");
      const previousText = button.textContent ?? "Browse...";
      button.disabled = true;
      button.textContent = "Opening...";
      try {
        const result = await pickW2uRepoFolder(pathInput?.value);
        if (result.cancelled) return;
        if (!result.ok || !result.repoPath) throw new Error(result.message ?? "Selected folder is not a valid W2U repo.");
        if (pathInput) pathInput.value = result.repoPath;
        rememberW2uRepoPath(result.repoPath);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
        button.textContent = previousText;
      }
    });
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>(".w2u-sync-button")) {
    button.addEventListener("click", async () => {
      const domains = (button.dataset.w2uDomains ?? "")
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean) as W2uSyncDomain[];
      const panel = button.closest<HTMLElement>(".w2u-sync-panel");
      const pathInput = panel?.querySelector<HTMLInputElement>(".w2u-sync-path-input");
      const repoPath = pathInput?.value.trim() ?? "";
      const previousText = button.textContent ?? "Sync W2U TOML";
      button.disabled = true;
      button.textContent = "Syncing...";
      try {
        const result = await syncW2uDomains(project, domains, { repoPath });
        if (result?.repoPath && pathInput) {
          pathInput.value = result.repoPath;
          rememberW2uRepoPath(result.repoPath);
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
        button.textContent = previousText;
      }
    });
  }
}

function hydrateW2uRepoPathInput(input: HTMLInputElement): void {
  const stored = readStoredW2uRepoPath();
  if (stored) {
    input.value = stored;
    return;
  }
  getW2uSyncStatus()
    .then((status) => {
      if (status.ok && status.repoPath && !input.value) input.value = status.repoPath;
    })
    .catch(() => {
      // The sync button will surface bridge errors when the user tries to sync.
    });
}
