declare module "treeforge" {
  export const TreeStyles: Record<string, Record<string, unknown>>;

  export class TreeForge {
    data: unknown;
    constructor(config: Record<string, unknown>);
    refresh(): void;
  }
}

declare module "treeforge/styles/ui.css";
