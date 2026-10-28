/** Keep experimental authoring off hosted deployments, including direct links. */
export function canOpenMapStudio(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}
