import { escapeHtml } from "./dom";

export type WeatherResourceFootprintItem = {
  access: "read" | "write" | "patch" | "runtime";
  target: string;
  description: string;
};

export function renderWeatherResourceFootprint(items: readonly WeatherResourceFootprintItem[], transplantSummary: string): string {
  return `<section class="weather-resource-footprint" aria-label="Resource footprint">
    <div class="weather-resource-footprint-title">Transplant / resource footprint</div>
    <p class="weather-transplant-summary">${escapeHtml(transplantSummary)}</p>
    <div class="weather-resource-footprint-list">
      ${items.map((item) => `<div class="weather-resource-footprint-row">
        <span class="weather-resource-access -${item.access}">${item.access}</span>
        <div><code>${escapeHtml(item.target)}</code><small>${escapeHtml(item.description)}</small></div>
      </div>`).join("")}
    </div>
  </section>`;
}
