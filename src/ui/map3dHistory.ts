/*
 * One undo history for the map editor. Every edit (grass, collisions, buildings, camera regions, map settings, walking
 * heights, imports) is saved to the project as it happens and pushes an entry here; Undo and Redo replay them in order,
 * whatever kind they are. An entry without redo drops out once undone.
 */

export type MapEdit = {
  /** Short description for the buttons' tooltips: "Undo paint grass". */
  label: string;
  undo: () => void | Promise<void>;
  redo?: () => void | Promise<void>;
};

const LIMIT = 100;

export class MapEditHistory {
  private done: MapEdit[] = [];
  private undone: MapEdit[] = [];
  private running = false;

  constructor(private changed: () => void) {}

  get busy(): boolean { return this.running; }
  get undoLabel(): string | undefined { return this.done.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.undone.at(-1)?.label; }

  /** Whether this edit is the newest one and nothing has been undone since, so it can still be extended. */
  isLatest(edit: MapEdit): boolean {
    return this.done.at(-1) === edit && this.undone.length === 0;
  }

  /** Forget every step, for when the editor moves to another map. */
  clear(): void {
    if (this.running) return;
    this.done = [];
    this.undone = [];
    this.changed();
  }

  push(edit: MapEdit): void {
    this.done.push(edit);
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    this.changed();
  }

  async undo(): Promise<string | undefined> {
    const edit = this.done.at(-1);
    if (!edit || this.running) return undefined;
    return this.run(async () => {
      await edit.undo();
      this.done.pop();
      if (edit.redo) this.undone.push(edit);
      return `Undid ${edit.label.toLowerCase()}.`;
    });
  }

  async redo(): Promise<string | undefined> {
    const edit = this.undone.at(-1);
    if (!edit?.redo || this.running) return undefined;
    return this.run(async () => {
      await edit.redo!();
      this.undone.pop();
      this.done.push(edit);
      return `Redid ${edit.label.toLowerCase()}.`;
    });
  }

  private async run(action: () => Promise<string>): Promise<string> {
    this.running = true;
    this.changed();
    try {
      return await action();
    } finally {
      this.running = false;
      this.changed();
    }
  }
}
