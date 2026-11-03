import "../styles/runtimeReleaseTimestamp.css";

/** Fixed MM/DD/YY HH:MM, using the viewer's local time zone and a 24-hour clock. */
export function formatRuntimeReleaseTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getMonth() + 1)}/${two(date.getDate())}/${two(date.getFullYear() % 100)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function renderRuntimeReleaseTimestamp(runtime: "ability" | "move" | "music"): string {
  const timestamp = typeof __POKEWEB_RUNTIME_RELEASE_DATES__ === "undefined" ? null : __POKEWEB_RUNTIME_RELEASE_DATES__[runtime];
  const formatted = timestamp && formatRuntimeReleaseTimestamp(timestamp);
  return `<small class="runtime-release-timestamp" title="Latest committed runtime code change">Latest Version pushed at ${formatted ? `<time datetime="${new Date(timestamp!).toISOString()}">${formatted}</time>` : "unavailable"}</small>`;
}
