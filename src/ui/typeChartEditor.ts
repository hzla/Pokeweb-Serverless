import {
  TYPE_EFFECTIVENESS_VALUES,
  getTypeChartTypes,
  getTypeChartValue,
  updateTypeChartValue,
  type TypeEffectivenessValue,
} from "../pokeweb/typeChartModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export function renderTypeChartEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const types = getTypeChartTypes(project);
  root.innerHTML = `
    <div class="type-chart-page">
      <div class="type-chart-toolbar">
        <div>
          <h2>Type Chart</h2>
          <span>Attack type rows against defending type columns</span>
        </div>
      </div>
      <div class="type-chart-wrap">
        <div class="type-chart-grid" style="--type-count: ${types.length};">
          <div class="type-chart-corner"></div>
          ${types.map((type) => renderTypeHeading(type)).join("")}
          ${types.map((attackType, attackIndex) => renderTypeRow(project, types, attackType, attackIndex)).join("")}
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

function renderTypeRow(project: ProjectState, types: string[], attackType: string, attackIndex: number): string {
  return `
    ${renderTypeHeading(attackType, true)}
    ${types.map((defendType, defendIndex) => renderTypeCell(project, attackIndex, defendIndex, `${attackType} vs ${defendType}`)).join("")}
  `;
}

function renderTypeCell(project: ProjectState, attackIndex: number, defendIndex: number, title: string): string {
  const value = getTypeChartValue(project, attackIndex, defendIndex);
  return `
    <label class="type-chart-cell" title="${escapeHtml(title)}">
      <select data-type-chart-cell data-attack-index="${attackIndex}" data-defend-index="${defendIndex}" data-value="${value}">
        ${TYPE_EFFECTIVENESS_VALUES.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${shortEffectivenessLabel(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderTypeHeading(type: string, row = false): string {
  return `<div class="type-chart-heading ${row ? "-row " : ""}-${typeClass(type)}" title="${escapeHtml(type)}">${escapeHtml(typeAbbreviation(type))}</div>`;
}

function shortEffectivenessLabel(value: TypeEffectivenessValue): string {
  if (value === 0) return "0";
  if (value === 2) return ".5";
  if (value === 8) return "2";
  return "1";
}

function typeAbbreviation(type: string): string {
  return (
    {
      Normal: "Nor",
      Fighting: "Fgt",
      Flying: "Fly",
      Poison: "Psn",
      Ground: "Gnd",
      Rock: "Rck",
      Bug: "Bug",
      Ghost: "Gho",
      Steel: "Stl",
      Fire: "Fir",
      Water: "Wat",
      Grass: "Grs",
      Electric: "Ele",
      Psychic: "Psy",
      Ice: "Ice",
      Dragon: "Drg",
      Dark: "Drk",
      Fairy: "Fai",
    }[type] ?? type
  );
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}
