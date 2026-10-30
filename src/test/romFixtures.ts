import { existsSync, type PathLike } from "node:fs";

/** Retail ROMs and extracted local resources are opt-in: npm run test:rom. */
export function romFixtureExists(path: PathLike | undefined): boolean {
  return import.meta.env.MODE === "rom" && path !== undefined && existsSync(path);
}
