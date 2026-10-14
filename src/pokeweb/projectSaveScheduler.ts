export type ProjectSaveScheduler<P> = {
  (project: P): void;
  flush(project: P): Promise<void>;
  cancel(project: P): void;
};

/** Serialize saves, coalescing requests received during a write into the latest state. */
export class ProjectSaveQueue<P extends object> {
  private readonly states = new WeakMap<P, { requested: number; completed: number; inFlight?: Promise<void> }>();
  constructor(private readonly persist: (project: P) => Promise<void>) {}
  save(project: P): Promise<void> {
    let state = this.states.get(project);
    if (!state) { state = { requested: 0, completed: 0 }; this.states.set(project, state); }
    state.requested++;
    if (state.inFlight) return state.inFlight;
    const current = state;
    // Start on a microtask so synchronous requests share the first snapshot.
    current.inFlight = Promise.resolve().then(async () => {
      try {
        while (current.completed < current.requested) {
          const requested = current.requested;
          await this.persist(project);
          current.completed = requested;
        }
      } finally { current.inFlight = undefined; }
    });
    return current.inFlight;
  }
}

export function createProjectSaveScheduler<P extends object>(
  save: (project: P) => Promise<void>,
  options: { delayMs?: number; onError?: (error: unknown, project: P) => void; onSaved?: (project: P) => void } = {},
): ProjectSaveScheduler<P> {
  const timers = new WeakMap<P, ReturnType<typeof setTimeout>>();
  const cancel = (project: P) => {
    const timer = timers.get(project);
    if (timer !== undefined) { clearTimeout(timer); timers.delete(project); }
  };
  const flush = async (project: P) => {
    cancel(project);
    await save(project);
    options.onSaved?.(project);
  };
  const schedule = (project: P) => {
    cancel(project);
    timers.set(project, setTimeout(() => {
      timers.delete(project);
      void flush(project).catch(error => {
        if (options.onError) options.onError(error, project);
        else console.error("Project autosave failed", error);
      });
    }, options.delayMs ?? 350));
  };
  return Object.assign(schedule, { flush, cancel });
}
