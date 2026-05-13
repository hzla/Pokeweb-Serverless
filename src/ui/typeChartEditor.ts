import {
  TYPE_CHART_TYPES,
  TYPE_EFFECTIVENESS_VALUES,
  effectivenessLabel,
  getTypeChartValue,
  updateTypeChartValue,
  type TypeEffectivenessValue,
} from "../pokeweb/typeChartModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function renderTypeChartEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  root.innerHTML = `
    <div class="type-chart-page">
      <div class="type-chart-toolbar">
        <div>
          <h2>Type Chart</h2>
          <span>Attack type rows against defending type columns</span>
        </div>
      </div>
      <div class="type-chart-wrap">
        <div class="type-chart-grid" style="--type-count: ${TYPE_CHART_TYPES.length};">
          <div class="type-chart-corner"></div>
          ${TYPE_CHART_TYPES.map((type) => `<div class="type-chart-heading -${typeClass(type)}">${escapeHtml(type)}</div>`).join("")}
          ${TYPE_CHART_TYPES.map((attackType, attackIndex) => renderTypeRow(project, attackType, attackIndex)).join("")}
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLSelectElement>("[data-type-chart-cell]").forEach((select) => {
    select.addEventListener("change", () => {
      const attackIndex = Number(select.dataset.attackIndex);
      const defendIndex = Number(select.dataset.defendIndex);
      const value = Number(select.value) as TypeEffectivenessValue;
      try {
        updateTypeChartValue(project, attackIndex, defendIndex, value);
        select.classList.remove("invalid");
        select.dataset.value = String(value);
        onDirty?.();
      } catch {
        select.classList.add("invalid");
      }
    });
  });
}

function renderTypeRow(project: ProjectState, attackType: string, attackIndex: number): string {
  return `
    <div class="type-chart-heading -row -${typeClass(attackType)}">${escapeHtml(attackType)}</div>
    ${TYPE_CHART_TYPES.map((defendType, defendIndex) => renderTypeCell(project, attackIndex, defendIndex, `${attackType} vs ${defendType}`)).join("")}
  `;
}

function renderTypeCell(project: ProjectState, attackIndex: number, defendIndex: number, title: string): string {
  const value = getTypeChartValue(project, attackIndex, defendIndex);
  return `
    <label class="type-chart-cell" title="${escapeHtml(title)}">
      <select data-type-chart-cell data-attack-index="${attackIndex}" data-defend-index="${defendIndex}" data-value="${value}">
        ${TYPE_EFFECTIVENESS_VALUES.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${effectivenessLabel(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
