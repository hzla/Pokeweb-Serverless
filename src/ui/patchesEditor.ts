import {
  detectDustCloudGemPatch,
  detectDustCloudItemPatch,
  removeDustCloudGemRewards,
  removeDustCloudItemRewards,
  type RomPatchApplyResult,
} from "../pokeweb/romPatchModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type PatchStatus = {
  text: string;
  kind?: "ok" | "warn" | "error";
};

let status: PatchStatus | undefined;

export function renderPatchesEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const gemStatus = detectDustCloudGemPatch(project);
  const itemStatus = detectDustCloudItemPatch(project);
  root.innerHTML = `
    <div class="patches-page">
      <header class="patches-header">
        <div>
          <h1>Patches</h1>
          <p>Apply focused ROM-level fixes that do not fit cleanly in a data editor.</p>
        </div>
      </header>
      <main class="patches-main">
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Remove Gems from Cave Dust Clouds</h2>
              <p>Cave dust-cloud item rewards will skip the gem reward branch. Evolution stones and Everstone remain available.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${gemStatus === "patched" ? "-ok" : gemStatus === "unknown" ? "-warn" : ""}">
                ${dustStatusLabel(gemStatus)}
              </span>
              <span>${project.session.baseRom === "BW2" ? "BW2" : "BW"}</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <button class="btn -default" id="remove-dust-cloud-gems-btn" type="button">Remove Gems from Dust Clouds</button>
          </div>
        </section>
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Remove Items from Cave Dust Clouds</h2>
              <p>Cave dust clouds will always attempt a wild encounter instead of rolling for an item reward.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${itemStatus === "patched" ? "-ok" : itemStatus === "unknown" ? "-warn" : ""}">
                ${dustStatusLabel(itemStatus)}
              </span>
              <span>${project.session.baseRom === "BW2" ? "BW2" : "BW"}</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <button class="btn -default" id="remove-dust-cloud-items-btn" type="button">Remove Items from Dust Clouds</button>
          </div>
        </section>
        <div class="patch-status ${status?.kind ? `-${status.kind}` : ""}" id="patch-status">${escapeHtml(status?.text ?? "")}</div>
      </main>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#remove-dust-cloud-gems-btn")?.addEventListener("click", async (event) => {
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: "Apply this ROM patch to remove gem rewards from cave dust clouds?",
      loadingText: "Looking for the dust-cloud reward branch...",
      successText: "Removed gem rewards",
      apply: removeDustCloudGemRewards,
    });
  });

  root.querySelector<HTMLButtonElement>("#remove-dust-cloud-items-btn")?.addEventListener("click", async (event) => {
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: "Apply this ROM patch to remove all item rewards from cave dust clouds?",
      loadingText: "Looking for the dust-cloud item/encounter branch...",
      successText: "Removed item rewards",
      apply: removeDustCloudItemRewards,
    });
  });
}

function dustStatusLabel(value: ReturnType<typeof detectDustCloudGemPatch>): string {
  if (value === "patched") return "Applied";
  if (value === "unpatched") return "Ready";
  return "Signature unknown";
}

function setStatus(root: HTMLElement, next: PatchStatus): void {
  status = next;
  const element = root.querySelector<HTMLElement>("#patch-status");
  if (!element) return;
  element.className = `patch-status ${next.kind ? `-${next.kind}` : ""}`;
  element.textContent = next.text;
}

async function applyPatchFromButton(
  button: HTMLButtonElement,
  root: HTMLElement,
  project: ProjectState,
  onDirty: (() => void) | undefined,
  options: {
    confirmText: string;
    loadingText: string;
    successText: string;
    apply: (project: ProjectState) => Promise<RomPatchApplyResult>;
  },
): Promise<void> {
  if (!window.confirm(`${options.confirmText}\n\nExport the ROM after applying to keep this change.`)) return;

  const previousText = button.textContent ?? "Apply Patch";
  button.disabled = true;
  button.textContent = "Applying...";
  setStatus(root, { text: options.loadingText, kind: "warn" });
  try {
    const result = await options.apply(project);
    if (result.status === "already-applied") {
      status = {
        text: `Patch already present in overlay ${result.overlayId} at 0x${result.offset.toString(16)}.`,
        kind: "ok",
      };
    } else {
      status = {
        text: `${options.successText} in overlay ${result.overlayId} at 0x${result.offset.toString(16)}. Export the ROM to save the patch.`,
        kind: "ok",
      };
      onDirty?.();
    }
    renderPatchesEditor(project, root, onDirty);
  } catch (error) {
    setStatus(root, { text: error instanceof Error ? error.message : String(error), kind: "error" });
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}
