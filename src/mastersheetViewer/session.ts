import { buildMastersheetDocument, createMastersheetBuildCache, type MastersheetDocument } from "../pokeweb/mastersheetDocument";
import type { SourceChange, SourceRange } from "../pokeweb/mastersheetEdits";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * One editing session of a mastersheet: its source (the master copy), undo and redo, and the document the viewer
 * shows, rebuilt after every change. Builds share one cache, so a rebuild only re-reads what changed (a few ms on
 * Cascade White, against about 230 ms from scratch).
 */

export type SessionChangeReason = "edit" | "undo" | "redo" | "replace";
export type SessionListener = (session: MastersheetSession, reason: SessionChangeReason, range?: SourceRange) => void;

/** Typing in one field within this long counts as one step for Undo. */
const COALESCE_MS = 1500;
const HISTORY_LIMIT = 300;

export class MastersheetSession {
  source: string;
  document: MastersheetDocument;
  /** The source as last saved (to the project or the ROM). */
  savedSource: string;
  private readonly cache = createMastersheetBuildCache();
  private past: Array<{ source: string; range?: SourceRange }> = [];
  private future: Array<{ source: string; range?: SourceRange }> = [];
  private lastCoalesce?: { key: string; at: number };
  private listeners = new Set<SessionListener>();

  constructor(readonly project: ProjectState, source: string, savedSource = source) {
    this.source = source;
    this.savedSource = savedSource;
    this.document = this.build();
  }

  get dirty(): boolean {
    return this.source !== this.savedSource;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** How many separate changes are unsaved, for the toolbar. Steps back to the saved source count down. */
  unsavedSteps(): number {
    if (!this.dirty) return 0;
    const savedAt = this.past.map((entry) => entry.source).lastIndexOf(this.savedSource);
    return savedAt >= 0 ? this.past.length - savedAt : this.past.length || 1;
  }

  onChange(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Applies an edit to the source. `coalesce` names the field being typed in: edits to the same field in quick
   * succession are one Undo step.
   */
  apply(edit: (source: string) => SourceChange, options: { coalesce?: string } = {}): SourceChange {
    const change = edit(this.source);
    if (change.source === this.source) return change;
    const now = Date.now();
    const merge = options.coalesce !== undefined && this.lastCoalesce?.key === options.coalesce && now - this.lastCoalesce.at < COALESCE_MS && this.past.length > 0;
    if (!merge) {
      this.past.push({ source: this.source, range: change.range });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCoalesce = options.coalesce === undefined ? undefined : { key: options.coalesce, at: now };
    this.future = [];
    this.source = change.source;
    this.document = this.build();
    this.emit("edit", change.range);
    return change;
  }

  /** The whole source replaced, as the template pane does while you type. */
  setSource(source: string, options: { coalesce?: string } = {}): void {
    this.apply(() => ({ source, range: { start: 0, end: 0 } }), options);
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ source: this.source, range: entry.range });
    this.source = entry.source;
    this.lastCoalesce = undefined;
    this.document = this.build();
    this.emit("undo", entry.range);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ source: this.source, range: entry.range });
    this.source = entry.source;
    this.lastCoalesce = undefined;
    this.document = this.build();
    this.emit("redo", entry.range);
  }

  /**
   * The source changed elsewhere (the editor tab saved another version). With nothing unsaved here it is taken as
   * the new saved state; Undo can still step back to what was here.
   */
  replaceSaved(source: string): void {
    if (source === this.source) {
      this.savedSource = source;
      this.emit("replace");
      return;
    }
    this.past.push({ source: this.source });
    this.future = [];
    this.source = source;
    this.savedSource = source;
    this.document = this.build();
    this.emit("replace");
  }

  markSaved(source = this.source): void {
    this.savedSource = source;
    this.emit("replace");
  }

  private build(): MastersheetDocument {
    return buildMastersheetDocument(this.project, this.source, this.cache);
  }

  private emit(reason: SessionChangeReason, range?: SourceRange): void {
    for (const listener of this.listeners) listener(this, reason, range);
  }
}
