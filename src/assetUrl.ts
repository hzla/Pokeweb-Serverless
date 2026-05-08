const viteBase = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";

export function publicAsset(path: string): string {
  const cleanPath = path.replace(/^\/+/u, "");
  if (viteBase === "./" || viteBase === "") return `./${cleanPath}`;
  return `${viteBase.replace(/\/?$/u, "/")}${cleanPath}`;
}
