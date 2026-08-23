import {
  addFairyTypeSupport,
  addMoveExpansion,
  detectDustCloudGemPatch,
  detectDustCloudItemPatch,
  detectForgettableHmPatch,
  detectMoveExpansionPatch,
  detectFairyTypePatch,
  detectSpecifyTrainerNaturesPatch,
  makeHmsForgettable,
  removeDustCloudGemRewards,
  removeDustCloudItemRewards,
  specifyTrainerNatures,
  type RomPatchApplyResult,
} from "../pokeweb/romPatchModel";
import {
  applyPlatinumItemStandardization,
  detectPlatinumItemStandardization,
} from "../pokeweb/gen4ItemStandardizationModel";
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
  const hmStatus = detectForgettableHmPatch(project);
  const fairyStatus = detectFairyTypePatch(project);
  const trainerNatureStatus = detectSpecifyTrainerNaturesPatch(project);
  const moveExpansionStatus = detectMoveExpansionPatch(project);
  const itemStandardizationStatus = detectPlatinumItemStandardization(project);
  const hmPatchCard =
    hmStatus === "unsupported"
      ? ""
      : `
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Make HM Moves Forgettable</h2>
              <p>Lets the move deleter and move replacement screens forget HM moves in Black / White.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${hmStatus === "patched" ? "-ok" : hmStatus === "unknown" ? "-warn" : ""}">
                ${hmStatusLabel(hmStatus)}
              </span>
              <span>BW</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <button class="btn -default" id="make-hms-forgettable-btn" type="button">Make HMs Forgettable</button>
          </div>
        </section>
      `;
  const fairyPatchCard =
    fairyStatus === "unsupported"
      ? ""
      : `
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Add Fairy Type Support</h2>
              <p>Adds Fairy as a battle type and updates the supporting battle, move, Pokémon, and text data used by the ROM.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${fairyStatus === "patched" ? "-ok" : ""}">
                ${fairyStatusLabel(fairyStatus)}
              </span>
              <span>${project.session.baseVersion}</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <label class="patch-option">
              <input id="fairy-modern-typings-checkbox" type="checkbox" checked />
              <span>Update Pokémon and move typings</span>
            </label>
            <button class="btn -default" id="add-fairy-type-btn" type="button">Add Fairy Type Support</button>
          </div>
        </section>
      `;
  const trainerNaturePatchCard =
    trainerNatureStatus === "unsupported"
      ? ""
      : `
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Specify Trainer Pokémon Natures</h2>
              <p>Lets trainer Pokémon use the Nature field from the trainer editor while preserving vanilla behavior when set to Auto.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${trainerNatureStatus === "patched" ? "-ok" : trainerNatureStatus === "unknown" ? "-warn" : ""}">
                ${trainerNatureStatusLabel(trainerNatureStatus)}
              </span>
              <span>${project.session.baseVersion}</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <button class="btn -default" id="specify-trainer-natures-btn" type="button">Specify Natures</button>
          </div>
        </section>
      `;
  const itemStandardizationPatchCard =
    itemStandardizationStatus === "unsupported"
      ? ""
      : `
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Standardize Ground Item IDs</h2>
              <p>Reorders Platinum ground-item scripts so script 7000 + the in-game item ID selects that item, while preserving existing pickups.</p>
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${itemStandardizationStatus === "patched" ? "-ok" : itemStandardizationStatus === "unknown" ? "-warn" : ""}">
                ${itemStandardizationStatusLabel(itemStandardizationStatus)}
              </span>
              <span>Pt</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <button class="btn -default" id="standardize-ground-items-btn" type="button" ${itemStandardizationStatus !== "unpatched" ? "disabled" : ""}>Standardize Ground Items</button>
          </div>
        </section>
      `;
  const moveExpansionPatchCard =
    moveExpansionStatus === "unsupported"
      ? ""
      : `
        <section class="patch-card">
          <div class="patch-card__body">
            <div>
              <h2>Move Expansion</h2>
              <p>Expands the ROM to 1,000 move slots, installs Frost-compatible animation routing, and seeds 305 selectable moves from White2Upgrade with safe vanilla animations and no custom effect handlers.</p>
              <p>The optional Gen 6-7 animation bundle includes White2Upgrade's scripts and prerequisite move particle files, with particle references relocated automatically when their original IDs are occupied.</p>
              ${project.session.fairy ? "" : "<p>Fairy-type definitions are installed as Normal unless Fairy Type Support is already active.</p>"}
            </div>
            <div class="patch-card__meta">
              <span class="patch-badge ${moveExpansionStatus === "patched" ? "-ok" : moveExpansionStatus === "unknown" ? "-warn" : ""}">
                ${moveExpansionStatusLabel(moveExpansionStatus)}
              </span>
              <span>${project.session.baseRom === "BW2" ? "BW2" : "BW"}</span>
            </div>
          </div>
          <div class="patch-card__actions">
            <label class="patch-option">
              <input id="move-expansion-animations-checkbox" type="checkbox" ${project.patches?.applied?.moveExpansionBundledAnimations || project.patches?.applied?.moveExpansionGen6Animations ? "checked" : ""} />
              <span>Include Gen 6-7 Animations</span>
            </label>
            <button class="btn -default" id="add-move-expansion-btn" type="button">Install Move Expansion</button>
          </div>
        </section>
      `;
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
        ${fairyPatchCard}
        ${moveExpansionPatchCard}
        ${trainerNaturePatchCard}
        ${hmPatchCard}
        ${itemStandardizationPatchCard}
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

  root.querySelector<HTMLButtonElement>("#add-fairy-type-btn")?.addEventListener("click", async (event) => {
    const updateModernFairyTypings = root.querySelector<HTMLInputElement>("#fairy-modern-typings-checkbox")?.checked ?? true;
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: "Apply this ROM patch to add Fairy Type Support?",
      loadingText: "Applying Fairy Type Support...",
      successText: "Added Fairy Type Support",
      apply: (nextProject) => addFairyTypeSupport(nextProject, { updateModernFairyTypings }),
    });
  });

  root.querySelector<HTMLButtonElement>("#make-hms-forgettable-btn")?.addEventListener("click", async (event) => {
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: "Apply this ARM9 patch to make HM moves forgettable?",
      loadingText: "Looking for the Black / White HM protection check...",
      successText: "Made HM moves forgettable",
      apply: makeHmsForgettable,
    });
  });

  root.querySelector<HTMLButtonElement>("#add-move-expansion-btn")?.addEventListener("click", async (event) => {
    const includeBundledAnimations = root.querySelector<HTMLInputElement>("#move-expansion-animations-checkbox")?.checked ?? false;
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: `Expand this ROM to 1,000 move slots and install the animation-routing hook${includeBundledAnimations ? ", Gen 6-7 animation scripts, and prerequisite particle files" : ""}?`,
      loadingText: includeBundledAnimations
        ? "Expanding move data and installing Gen 6-7 animations with relocated particle dependencies..."
        : "Expanding move data, text, animations, and routing...",
      successText: "Installed Move Expansion",
      apply: (nextProject) => addMoveExpansion(nextProject, { includeBundledAnimations }),
    });
  });

  root.querySelector<HTMLButtonElement>("#specify-trainer-natures-btn")?.addEventListener("click", async (event) => {
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText: "Apply this ARM9 patch to enable explicit trainer Pokémon natures?",
      loadingText: "Looking for the Black 2 / White 2 trainer Pokémon setup code...",
      successText: "Enabled explicit trainer Pokémon natures",
      apply: specifyTrainerNatures,
    });
  });

  root.querySelector<HTMLButtonElement>("#standardize-ground-items-btn")?.addEventListener("click", async (event) => {
    applyPatchFromButton(event.currentTarget as HTMLButtonElement, root, project, onDirty, {
      confirmText:
        "Standardize Platinum ground-item IDs? This rewrites the global item script file, affected event files, and overlay 9 while preserving currently placed items.",
      loadingText: "Validating and rebuilding Platinum ground-item scripts...",
      successText: "Standardized Platinum ground-item IDs",
      apply: applyPlatinumItemStandardization,
    });
  });
}

function dustStatusLabel(value: ReturnType<typeof detectDustCloudGemPatch>): string {
  if (value === "patched") return "Applied";
  if (value === "unpatched") return "Ready";
  return "Signature unknown";
}

function fairyStatusLabel(value: ReturnType<typeof detectFairyTypePatch>): string {
  if (value === "patched") return "Applied";
  if (value === "unsupported") return "Unsupported";
  return "Ready";
}

function hmStatusLabel(value: ReturnType<typeof detectForgettableHmPatch>): string {
  if (value === "patched") return "Applied";
  if (value === "unsupported") return "Unsupported";
  if (value === "unknown") return "Signature unknown";
  return "Ready";
}

function trainerNatureStatusLabel(value: ReturnType<typeof detectSpecifyTrainerNaturesPatch>): string {
  if (value === "patched") return "Applied";
  if (value === "unsupported") return "Unsupported";
  if (value === "unknown") return "Signature unknown";
  return "Ready";
}

function moveExpansionStatusLabel(value: ReturnType<typeof detectMoveExpansionPatch>): string {
  if (value === "patched") return "Applied";
  if (value === "routing-only") return "Routing only";
  if (value === "unsupported") return "Unsupported";
  if (value === "unknown") return "Signature unknown";
  return "Ready";
}

function itemStandardizationStatusLabel(value: ReturnType<typeof detectPlatinumItemStandardization>): string {
  if (value === "patched") return "Applied";
  if (value === "unknown") return "Signature unknown";
  if (value === "unsupported") return "Unsupported";
  return "Ready";
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
        text:
          result.overlayId !== undefined && result.offset !== undefined
            ? `Patch already present in overlay ${result.overlayId} at 0x${result.offset.toString(16)}.`
            : (result.summary ?? "Patch already present."),
        kind: "ok",
      };
    } else {
      status = {
        text:
          result.summary
            ? `${result.summary} Export the ROM to save the patch.`
            : result.overlayId !== undefined && result.offset !== undefined
            ? `${options.successText} in overlay ${result.overlayId} at 0x${result.offset.toString(16)}. Export the ROM to save the patch.`
            : `${options.successText} Export the ROM to save the patch.`,
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
