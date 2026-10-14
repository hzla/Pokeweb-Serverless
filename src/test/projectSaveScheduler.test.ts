import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSaveScheduler, ProjectSaveQueue } from "../pokeweb/projectSaveScheduler";

afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("project save coordination", () => {
  it("debounces rapid requests into one latest-state save", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {}), scheduler = createProjectSaveScheduler(save), project = {};
    scheduler(project); scheduler(project); scheduler(project);
    await vi.advanceTimersByTimeAsync(349); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce();
  });

  it("keeps at most one write in flight and one latest-state follow-up", async () => {
    const gate = deferred(), project = { value: 1 }, writes: number[] = [];
    const queue = new ProjectSaveQueue<typeof project>(async current => { writes.push(current.value); if (writes.length === 1) await gate.promise; });
    const first = queue.save(project); await Promise.resolve();
    project.value = 2; const second = queue.save(project);
    project.value = 3; const third = queue.save(project);
    expect(writes).toEqual([1]); gate.resolve();
    await Promise.all([first, second, third]); expect(writes).toEqual([1, 3]);
  });

  it("coalesces synchronous direct-save requests before taking a snapshot", async () => {
    const save = vi.fn(async () => {}), project = {}, queue = new ProjectSaveQueue(save);
    await Promise.all([queue.save(project), queue.save(project), queue.save(project)]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("flush cancels the timer and waits for all writes needed for latest state", async () => {
    vi.useFakeTimers();
    const gate = deferred(), project = { value: 1 }, writes: number[] = [];
    const queue = new ProjectSaveQueue<typeof project>(async current => { writes.push(current.value); if (writes.length === 1) await gate.promise; });
    const scheduler = createProjectSaveScheduler<typeof project>(current => queue.save(current));
    const first = queue.save(project); await Promise.resolve();
    project.value = 2; scheduler(project);
    let complete = false; const flushed = scheduler.flush(project).then(() => { complete = true; });
    await Promise.resolve(); expect(complete).toBe(false);
    gate.resolve(); await Promise.all([first, flushed]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toEqual([1, 2]); expect(complete).toBe(true);
  });

  it("cancel removes only the selected project's timer", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {}), scheduler = createProjectSaveScheduler(save), a = {}, b = {};
    scheduler(a); scheduler(b); scheduler.cancel(a);
    await vi.advanceTimersByTimeAsync(350);
    expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith(b);
  });

  it("reports autosave failure without modifying edits and permits retry", async () => {
    vi.useFakeTimers();
    const error = new Error("Storage full"), save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn(), onSaved = vi.fn(), project = { value: 90 };
    const scheduler = createProjectSaveScheduler(save, { onError, onSaved });
    scheduler(project); await vi.advanceTimersByTimeAsync(350);
    expect(onError).toHaveBeenCalledWith(error, project);
    expect(project.value).toBe(90); expect(onSaved).not.toHaveBeenCalled();
    await scheduler.flush(project); expect(onSaved).toHaveBeenCalledWith(project);
  });

  it("a failed queue can subsequently save the latest project", async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error("Abort")).mockResolvedValue(undefined);
    const queue = new ProjectSaveQueue(persist), project = {};
    await expect(queue.save(project)).rejects.toThrow("Abort");
    await queue.save(project); expect(persist).toHaveBeenCalledTimes(2);
  });
});
