import { balancePlayerLevel, balanceReportBlocker, balanceTableLabel, buildBalanceReport, suggestedBalanceTables, type BalanceReport } from "../pokeweb/balanceReportModel";
import { canUseAiFeatures } from "../pokeweb/aiFeatureAccess";
import { getEncounterRollAreas } from "../pokeweb/encounterRollModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { getEvolutionItems } from "../pokeweb/testTeamEvolution";
import type { TrainerRecord } from "../pokeweb/trainerModel";
import { escapeHtml } from "./dom";
import "../styles/balanceReport.css";

type ReportInputs = { cutoff?: string; tables: Set<string>; evolutionItems: Set<number>; allowTrading: boolean };
const plans = new WeakMap<ProjectState, Map<number, ReportInputs>>();

export function openBalanceReport(project: ProjectState, trainer: TrainerRecord, opener: HTMLElement): void {
  if (!canUseAiFeatures()) return;
  const dialog = document.createElement("dialog");
  dialog.className = "balance-report";
  dialog.setAttribute("aria-labelledby", "balance-report-title");
  const name = String(trainer.readable.name || `Trainer ${trainer.id}`);
  const blocker = balanceReportBlocker(project, trainer);
  const areas = blocker ? [] : getEncounterRollAreas(project);
  const evolutionItems = blocker ? [] : getEvolutionItems(project);
  const tables = areas.flatMap(({ label, tables }) => tables.map((table) => ({ table, area: label, label: balanceTableLabel(table) })));
  const playerLevel = balancePlayerLevel(trainer);
  const projectPlans = plans.get(project) ?? new Map<number, ReportInputs>();
  plans.set(project, projectPlans);
  const plan: ReportInputs = projectPlans.get(trainer.id) ?? { tables: new Set<string>(), evolutionItems: new Set<number>(), allowTrading: false };
  plan.tables = new Set(tables.map(({ table }) => table.key).filter((key) => plan.tables.has(key)));
  plan.evolutionItems = new Set(evolutionItems.map(({ itemId }) => itemId).filter((id) => plan.evolutionItems.has(id)));
  projectPlans.set(trainer.id, plan);

  dialog.innerHTML = `
    <header class="balance-report-head">
      <div><h2 id="balance-report-title">Balance report</h2><span>${escapeHtml(name)} · #${trainer.id}</span></div>
      <button type="button" class="btn -ghost" data-close aria-label="Close balance report">×</button>
    </header>
    ${blocker || !tables.length ? `<p role="status">${escapeHtml(blocker ?? "No encounter tables with mapped locations are loaded.")}</p>` : `
      <form class="balance-report-form" novalidate>
        <div class="balance-report-controls">
          <div>Player level <strong>${playerLevel}</strong></div>
          <div class="balance-report-suggest">
            <label>Wild level cutoff <input data-cutoff type="number" min="1" max="100" value="${escapeHtml(plan.cutoff ?? String(playerLevel))}" autofocus></label>
            <button type="button" class="btn" data-suggest title="Replace the selection with tables whose highest wild level is at or below the cutoff">Select through cutoff</button>
          </div>
        </div>
        <fieldset class="balance-report-tables">
          <legend>Available encounter tables</legend>
          <div class="balance-report-table-tools">
            <input type="search" data-filter placeholder="Filter by area, method or season" aria-label="Filter encounter tables">
            <span data-table-count role="status"></span>
            <label><input type="checkbox" data-selected-only> Selected only</label>
            <button type="button" class="btn -ghost" data-clear>Clear selection</button>
          </div>
          <div class="balance-report-table-list">
            ${tables.map(({ table, area, label }) => `
              <label data-table-row>
                <input type="checkbox" value="${escapeHtml(table.key)}"${plan.tables.has(table.key) ? " checked" : ""}>
                <span><strong>${escapeHtml(area)}</strong><small>${escapeHtml(label)}</small></span>
              </label>
            `).join("")}
          </div>
          <p data-empty-filter hidden>No tables match.</p>
        </fieldset>
        <details class="balance-report-evolution">
          <summary data-evolution-summary>Evolution options</summary>
          <label><input type="checkbox" data-allow-trading${plan.allowTrading ? " checked" : ""}> Trading available</label>
          ${evolutionItems.length ? `<fieldset>
            <legend>Available evolution items</legend>
            <div class="balance-report-evolution-items">
              ${evolutionItems.map(({ itemId, itemName }) => `
                <label><input type="checkbox" data-evolution-item value="${itemId}"${plan.evolutionItems.has(itemId) ? " checked" : ""}> ${escapeHtml(itemName)}</label>
              `).join("")}
            </div>
          </fieldset>` : ""}
        </details>
        <details class="balance-report-assumptions">
          <summary>Battle assumptions</summary>
          <p>Full HP, up to 12 turns. The player repeats one attack with low rolls. The boss can mix attacks, gets high rolls and wins speed ties. Setup, secondary effects, random critical hits, bag items and switching are outside this comparison.</p>
          <p>Player Pokémon evolve and learn moves through the boss’s highest level. They use a normal ability, neutral nature, 15 IVs, zero EVs and no held item in battle. Catches above the player level are excluded. Slot weights are per encounter, within the listed table.</p>
          <p>Evolution assumes high friendship and access to day and night. Move requirements use moves known at capture or learned while training. Party, location and battle-count requirements are outside this comparison. The field starts clear unless the trainer has preset weather or an opening ability sets it.</p>
        </details>
        <footer class="balance-report-actions">
          <span data-status role="status"></span>
          <button class="btn -primary" type="submit" data-run>Run report</button>
        </footer>
      </form>
      <section class="balance-report-results" aria-label="Matchup results" data-results hidden></section>
    `}
  `;
  document.body.append(dialog);
  dialog.showModal();

  const session = new AbortController();
  dialog.addEventListener("close", () => {
    session.abort();
    dialog.remove();
    if (opener.isConnected) opener.focus();
  }, { once: true });
  dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());

  const form = dialog.querySelector("form");
  if (!form) return;
  const cutoff = form.querySelector<HTMLInputElement>("[data-cutoff]")!;
  const filter = form.querySelector<HTMLInputElement>("[data-filter]")!;
  const selectedOnly = form.querySelector<HTMLInputElement>("[data-selected-only]")!;
  const list = [...form.querySelectorAll<HTMLElement>("[data-table-row]")];
  const checks = list.map((row) => row.querySelector<HTMLInputElement>("input")!);
  const count = form.querySelector<HTMLElement>("[data-table-count]")!;
  const emptyFilter = form.querySelector<HTMLElement>("[data-empty-filter]")!;
  const status = form.querySelector<HTMLElement>("[data-status]")!;
  const run = form.querySelector<HTMLButtonElement>("[data-run]")!;
  const results = dialog.querySelector<HTMLElement>("[data-results]")!;
  const evolutionSummary = form.querySelector<HTMLElement>("[data-evolution-summary]")!;
  let running = false;

  function refresh() {
    for (const checkbox of checks) checkbox.checked = plan.tables.has(checkbox.value);
    count.textContent = `${plan.tables.size} selected`;
    evolutionSummary.textContent = plan.evolutionItems.size ? `Evolution options · ${plan.evolutionItems.size} items selected` : "Evolution options";
    run.disabled = running || !plan.tables.size;
    filterRows();
  }

  function filterRows() {
    const query = filter.value.trim().toLowerCase();
    for (const [index, row] of list.entries()) {
      const table = tables[index];
      row.hidden = (selectedOnly.checked && !plan.tables.has(table.table.key))
        || !`${table.area} ${table.label}`.toLowerCase().includes(query);
    }
    emptyFilter.hidden = list.some((row) => !row.hidden);
  }

  function resetResults() {
    results.hidden = true;
    status.textContent = "";
  }

  cutoff.addEventListener("input", () => { plan.cutoff = cutoff.value; });
  filter.addEventListener("input", filterRows);
  selectedOnly.addEventListener("change", filterRows);
  form.querySelector<HTMLInputElement>("[data-allow-trading]")!.addEventListener("change", (event) => {
    plan.allowTrading = (event.currentTarget as HTMLInputElement).checked;
    resetResults();
  });
  for (const input of form.querySelectorAll<HTMLInputElement>("[data-evolution-item]")) {
    input.addEventListener("change", () => {
      const id = Number(input.value);
      if (input.checked) plan.evolutionItems.add(id);
      else plan.evolutionItems.delete(id);
      resetResults();
      refresh();
    });
  }
  for (const checkbox of checks) {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) plan.tables.add(checkbox.value);
      else plan.tables.delete(checkbox.value);
      resetResults();
      refresh();
    });
  }
  form.querySelector("[data-clear]")!.addEventListener("click", () => {
    plan.tables.clear();
    resetResults();
    refresh();
  });
  form.querySelector("[data-suggest]")!.addEventListener("click", () => {
    if (!cutoff.value || !cutoff.reportValidity()) {
      cutoff.focus();
      return;
    }
    plan.tables = new Set(suggestedBalanceTables(areas, cutoff.valueAsNumber));
    resetResults();
    refresh();
  });
  cutoff.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    form.querySelector<HTMLButtonElement>("[data-suggest]")!.click();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (running || !plan.tables.size) return;
    running = true;
    resetResults();
    status.textContent = "Checking matchups…";
    const inputs = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")];
    for (const input of inputs) input.disabled = true;
    try {
      const report = await buildBalanceReport(project, trainer.id, [...plan.tables], {
        itemIds: [...plan.evolutionItems],
        allowTrading: plan.allowTrading,
      }, session.signal);
      if (session.signal.aborted || !dialog.open) return;
      results.innerHTML = renderResults(report);
      results.hidden = false;
      status.textContent = "Report ready.";
      const heading = results.querySelector<HTMLElement>("h3")!;
      heading.focus();
      heading.scrollIntoView({ block: "start" });
    } catch (error) {
      if (!session.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
      for (const input of inputs) input.disabled = false;
      refresh();
    }
  });
  refresh();
}

function renderResults(report: BalanceReport): string {
  return `
    <h3 tabindex="-1">1v1 answers at Lv ${report.playerLevel}</h3>
    <p>${report.candidates} available species / forms${report.skipped ? ` · ${report.skipped} partly or fully outside the damage model` : ""}</p>
    ${report.slots.map((slot, index) => `
      <details class="balance-report-slot"${index === 0 ? " open" : ""}>
        <summary><strong>${index + 1}. ${escapeHtml(slot.species)} · Lv ${slot.level}</strong><span>${slot.issue ? "Unavailable" : `${new Set(slot.answers.map(({ species }) => species)).size} answers`}</span></summary>
        ${slot.ignoredMoves.length ? `<p class="balance-report-omitted">Setup and status moves omitted · ${escapeHtml(slot.ignoredMoves.join(", "))}</p>` : ""}
        ${slot.issue ? `<p>${escapeHtml(slot.issue)}</p>` : slot.answers.length === 0 ? "<p>No reliable direct-attack answers in these tables.</p>" : `
          <ul class="balance-report-answers">
            ${slot.answers.map((answer) => `
              <li>
                <div><strong>${escapeHtml(answer.species)}</strong>${answer.ability ? ` <span>· ${escapeHtml(answer.ability)}</span>` : ""}</div>
                <div>${escapeHtml(answer.move)} · ≤${answer.turns} turns · ≥${answer.hpPercent}% HP</div>
                <ul class="balance-report-catches">
                  ${answer.catches.map((source) => `<li>${source.caughtAs ? `Catch ${escapeHtml(source.caughtAs)} · ` : ""}${escapeHtml(source.area)} · ${escapeHtml(source.table)} · Lv ${escapeHtml(source.levels.join(", "))} · ${source.weight}% slot weight</li>`).join("")}
                </ul>
              </li>
            `).join("")}
          </ul>
        `}
      </details>
    `).join("")}
  `;
}
