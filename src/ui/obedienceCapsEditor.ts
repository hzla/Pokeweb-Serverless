import { NintendoDSRom } from "../nds/rom";
import { getObedienceCaps, updateObedienceCap } from "../pokeweb/obedienceCapsModel";
import { activeRomMatchesProject, loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import "../styles/obedienceCaps.css";

export async function renderObedienceCapsEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): Promise<void> {
  const page = document.createElement("section");
  page.className = "obedience-caps";
  page.innerHTML = '<h1>Obedience Caps</h1><p role="status">Loading caps…</p>';
  root.replaceChildren(page);
  try {
    const source = project.originalRomBytes ?? (await activeRomMatchesProject(project) ? await loadActiveRomBytes() : undefined);
    if (!root.contains(page)) return;
    if (!source) throw new Error("Reconnect the source ROM to edit obedience caps.");
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const caps = getObedienceCaps(project, rom);
    page.innerHTML = `
      <h1>Obedience Caps</h1>
      <p>Traded Pokémon can disobey above these levels.</p>
      <table>
        <thead><tr><th scope="col">Badges held</th><th scope="col">Obeys through level</th></tr></thead>
        <tbody>${caps.map((cap, badges) => `
          <tr>
            <th scope="row">${badges}</th>
            <td><input type="number" min="1" max="100" step="1" value="${cap}" data-obedience-badges="${badges}"
              aria-label="Obedience cap with ${badges} ${badges === 1 ? "badge" : "badges"}"></td>
          </tr>`).join("")}
        </tbody>
      </table>
      <p class="obedience-caps-error" role="status"></p>
    `;
    const status = page.querySelector<HTMLElement>(".obedience-caps-error")!;
    page.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
      const badges = Number(input.dataset.obedienceBadges);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") input.blur();
      });
      input.addEventListener("change", () => {
        try {
          const next = input.valueAsNumber;
          if (updateObedienceCap(project, rom, badges, next)) onDirty();
          caps[badges] = next;
          status.textContent = "";
        } catch (error) {
          input.value = String(caps[badges]);
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      });
    });
  } catch (error) {
    const status = page.querySelector<HTMLElement>("[role=status]");
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}
