export function showExportFailureDialog(message: string, downloadReport: () => Promise<void>): Promise<void> {
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "export-changelog-dialog__panel export-error-dialog";
    dialog.setAttribute("aria-labelledby", "export-error-title");
    dialog.innerHTML = `<h2 id="export-error-title">Export failed</h2>
      <p data-export-error></p>
      <p>Report includes file structure and edit sizes. No ROM contents are included or uploaded.</p>
      <p data-report-status role="status" hidden></p>
      <div class="export-changelog-dialog__actions">
        <button class="btn -default" type="button" data-report>Download export report</button>
        <button class="btn -default" type="button" data-close>Close</button>
      </div>`;
    dialog.querySelector<HTMLElement>("[data-export-error]")!.textContent = message;
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => dialog.close());
    const download = dialog.querySelector<HTMLButtonElement>("[data-report]")!;
    download.addEventListener("click", async () => {
      const status = dialog.querySelector<HTMLElement>("[data-report-status]")!;
      download.disabled = true;
      status.hidden = true;
      try { await downloadReport(); }
      catch (error) {
        status.textContent = `Could not create report: ${error instanceof Error ? error.message : String(error)}`;
        status.hidden = false;
      } finally { download.disabled = false; }
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
