import { dsiRepairedRomFilename, repairDsiRom } from "../pokeweb/dsiRomRepairModel";

export function renderDsiRomRepairCard(): string {
  return `<section class="upload-panel repair-tool dsi-repair-tool" aria-labelledby="dsi-repair-title">
    <h2 id="dsi-repair-title">DSi ROM Repair</h2>
    <p class="dsi-repair-description">Restore DSi data damaged by older Pokeweb exports, including missing headers, integrity tables, and DSi programs.</p>
    <label class="changelog-file">
      <span>Damaged or edited ROM</span>
      <input id="dsi-repair-source" type="file" accept=".nds" />
    </label>
    <label class="changelog-file">
      <span>Matching clean Black / White / Black 2 / White 2 ROM</span>
      <input id="dsi-repair-donor" type="file" accept=".nds" />
    </label>
    <div class="changelog-actions repair-actions">
      <button class="btn -default" id="dsi-repair-download" type="button" disabled>Download DSi-Repaired ROM</button>
    </div>
    <div class="upload-status" id="dsi-repair-status" role="status" aria-live="polite"></div>
  </section>`;
}

export function attachDsiRomRepairCard(root: HTMLElement, download: (bytes: Uint8Array, filename: string) => void): void {
  const source = root.querySelector<HTMLInputElement>("#dsi-repair-source");
  const donor = root.querySelector<HTMLInputElement>("#dsi-repair-donor");
  const button = root.querySelector<HTMLButtonElement>("#dsi-repair-download");
  const status = root.querySelector<HTMLElement>("#dsi-repair-status");
  if (!source || !donor || !button || !status) return;
  let busy = false;
  const sync = () => {
    button.disabled = busy || !source.files?.[0] || !donor.files?.[0];
    source.disabled = donor.disabled = busy;
    button.textContent = busy ? "Repairing…" : "Download DSi-Repaired ROM";
    status.setAttribute("aria-busy", String(busy));
  };
  const progress = async (message: string) => {
    status.textContent = message;
    // Allow the progress message to paint before CPU-intensive validation.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  };
  for (const input of [source, donor]) input.addEventListener("change", () => {
    status.textContent = "";
    status.classList.remove("dsi-repair-error");
    sync();
  });
  button.addEventListener("click", async () => {
    const sourceFile = source.files?.[0], donorFile = donor.files?.[0];
    if (busy || !sourceFile || !donorFile) return;
    busy = true;
    sync();
    status.classList.remove("dsi-repair-error");
    try {
      if (![sourceFile, donorFile].every((file) => /\.nds$/iu.test(file.name))) throw new Error("Choose two .nds ROM files.");
      await progress("Reading the edited ROM and clean donor…");
      const bytes = new Uint8Array(await sourceFile.arrayBuffer());
      const clean = new Uint8Array(await donorFile.arrayBuffer());
      const result = await repairDsiRom(bytes, clean, progress);
      const filename = dsiRepairedRomFilename(sourceFile.name);
      download(result.bytes, filename);
      status.textContent = `Downloaded ${filename}. ${result.game} DSi data restored; edited DS code and assets preserved. Your original files are unchanged.`;
    } catch (error) {
      status.classList.add("dsi-repair-error");
      status.textContent = `Repair failed. No ROM was downloaded. ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      sync();
    }
  });
  sync();
}
