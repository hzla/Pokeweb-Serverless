import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import type { NarcName } from "./constants";
import type { NarcStore, ProjectState, RawRecord, ReadableRecord } from "./projectStore";

export type EditTarget = { readonly name: NarcName; readonly id: number };
export type RecordEdit = EditTarget & {
  readonly raw?: Readonly<RawRecord>;
  readonly readable?: Readonly<ReadableRecord>;
  /** A display-only change can accompany a binary edit without dirtying its record. */
  readonly dirty?: boolean;
};
export type BinaryEdit = EditTarget & { readonly bytes: Uint8Array };
export type ChangelogEdit =
  | { readonly kind: "field"; readonly domain: string; readonly subject: string; readonly label: string; readonly before: unknown; readonly after: unknown; readonly key: string }
  | { readonly kind: "generic"; readonly domain: string; readonly subject: string; readonly text: string; readonly key: string };

/** Prepared data, not callbacks that can mutate the live project. */
export type PreparedEdit<T> = {
  readonly result: T;
  readonly records?: readonly RecordEdit[];
  readonly binaries?: readonly BinaryEdit[];
  readonly invalidate?: readonly EditTarget[];
  readonly changelog?: readonly ChangelogEdit[];
};
export type EditCommit = {
  readonly revision: number;
  readonly targets: readonly EditTarget[];
  readonly copiedBytes: number;
};

const sessions = new WeakMap<ProjectState, ProjectEditSession>();

export function projectEditSession(project: ProjectState): ProjectEditSession {
  let session = sessions.get(project);
  if (!session) { session = new ProjectEditSession(project); sessions.set(project, session); }
  return session;
}

export class ProjectEditSession {
  private currentRevision = 0;
  private readonly subscribers = new Set<(event: EditCommit) => void>();
  constructor(private readonly project: ProjectState) {}
  get revision(): number { return this.currentRevision; }
  subscribe(listener: (event: EditCommit) => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  commit<T>(edit: PreparedEdit<T>): T {
    const project = this.project;
    const resolve = (target: EditTarget): NarcStore => {
      const store = project.narcs[target.name];
      if (!store || !Number.isInteger(target.id) || target.id < 0 || !store.rawFiles[target.id])
        throw new Error(`Missing edit target: ${target.name} ${target.id}`);
      return store;
    };
    // Resolve every target and diff before publishing any authored state.
    const records = (edit.records ?? []).flatMap(change => {
      const store = resolve(change), record = store.records.get(change.id);
      if (!record?.raw || !record.readable) throw new Error(`Record is not decoded: ${change.name} ${change.id}`);
      const raw = changedFields(record.raw, change.raw), readable = changedFields(record.readable, change.readable);
      return Object.keys(raw).length || Object.keys(readable).length ? [{ change, store, record, raw, readable }] : [];
    });
    const binaries = (edit.binaries ?? []).flatMap(change => {
      const store = resolve(change);
      return equalBytes(store.rawFiles[change.id], change.bytes) ? [] : [{ change, store }];
    });
    const invalidations = (edit.invalidate ?? []).map(target => ({ target, store: resolve(target) }));
    if (records.length === 0 && binaries.length === 0) return edit.result;

    const touched = new Map<NarcStore, Set<number>>();
    const dirty = (store: NarcStore, id: number) => {
      let ids = touched.get(store);
      if (!ids) { ids = new Set(); touched.set(store, ids); }
      ids.add(id);
    };
    for (const { change, store, record, raw, readable } of records) {
      // Preserve live record identities used by the existing row-level UI.
      Object.assign(record.raw!, raw); Object.assign(record.readable!, readable);
      if (change.dirty !== false) dirty(store, change.id);
    }
    for (const { change, store } of binaries) {
      store.rawFiles[change.id] = change.bytes;
      store.records.delete(change.id);
      dirty(store, change.id);
    }
    for (const { target, store } of invalidations) store.records.delete(target.id);
    const targets: EditTarget[] = [];
    for (const [store, ids] of touched) {
      for (const id of ids) { store.dirty.add(id); targets.push({ name: store.name, id }); }
      store.revision = (store.revision ?? 0) + 1;
    }
    for (const change of edit.changelog ?? []) {
      if (change.kind === "field") recordFieldChange(project, change.domain, change.subject, change.label, change.before, change.after, { key: change.key });
      else recordGenericChange(project, change.domain, change.text, change.subject, { key: change.key });
    }
    const event: EditCommit = {
      revision: ++this.currentRevision, targets,
      copiedBytes: binaries.reduce((sum, { change }) => sum + change.bytes.byteLength, 0),
    };
    for (const subscriber of this.subscribers) {
      try { subscriber(event); } catch (error) { console.error("Edit commit subscriber failed", error); }
    }
    return edit.result;
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
}
function changedFields<T extends number | string>(current: Record<string, T>, next?: Readonly<Record<string, T>>): Record<string, T> {
  const changed: Record<string, T> = {};
  for (const [key, value] of Object.entries(next ?? {})) if (!Object.is(current[key], value)) changed[key] = value;
  return changed;
}
