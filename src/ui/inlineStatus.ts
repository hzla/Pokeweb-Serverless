import { escapeHtml } from "./dom";

export type InlineStatusTone = "neutral" | "success" | "warning" | "error" | "busy";

const successLabels = new Set(["installed", "applied", "migrated", "enabled", "assignable"]);
const warningLabels = new Set([
  "update available", "upgrade", "combined patch present", "migration available",
  "routing only", "incomplete", "dependency missing", "signature unknown",
  "missing", "unknown", "range limit", "needs sync", "helper slots", "fallback",
]);

const displayLabels: Record<string, string> = {
  "not installed": "Not installed",
  "update available": "Update available",
  "combined patch present": "Combined patch present",
  "migration available": "Migration available",
  "routing only": "Routing only",
  "dependency missing": "Dependency missing",
  "range limit": "Range limit",
  "needs sync": "Needs sync",
  "helper slots": "Helper slots",
};

export function inlineStatusTone(label: string): InlineStatusTone {
  const normalized = label.trim().toLowerCase();
  if (successLabels.has(normalized)) return "success";
  if (warningLabels.has(normalized)) return "warning";
  if (normalized === "incompatible" || normalized === "unsupported / incompatible") return "error";
  return "neutral";
}

/** Keep the readable state independent of the decorative, color-coded marker. */
export function renderInlineStatus(label: string, options: {
  className?: string;
  tone?: InlineStatusTone;
  title?: string;
} = {}): string {
  const tone = options.tone ?? inlineStatusTone(label);
  const displayLabel = displayLabels[label.trim().toLowerCase()] ?? label;
  const marker = { neutral: "·", success: "✓", warning: "!", error: "!", busy: "…" }[tone];
  const className = options.className ? ` ${escapeHtml(options.className)}` : "";
  const title = options.title ? ` title="${escapeHtml(options.title)}"` : "";
  return `<span class="inline-status${className}" data-tone="${tone}"${title}><span class="inline-status__marker" aria-hidden="true">${marker}</span><span class="inline-status__label">${escapeHtml(displayLabel)}</span></span>`;
}
