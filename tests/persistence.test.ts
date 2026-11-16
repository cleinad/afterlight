import { afterEach, expect, it, vi } from "vitest";
import { Persistence } from "../lib/persistence";
import { newChat } from "../lib/types";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it("coalesces drafts and serializes a terminal write after an active checkpoint", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const writer = new Persistence(() => {});
  const c = newChat();
  writer.stage({ store: { [c.id]: { ...c, draft: "one" } } });
  writer.stage({ store: { [c.id]: { ...c, draft: "two" } } });
  expect(invoke).not.toHaveBeenCalled();
  const flush = writer.flush();
  writer.stage({ store: { [c.id]: { ...c, draft: "terminal" } } });
  expect(invoke).toHaveBeenCalledTimes(1);
  finish(); await flush;
  expect(invoke).toHaveBeenCalledTimes(2);
  const revisions = invoke.mock.calls.map(([, args]) => args.snapshot.revision);
  expect(revisions).toEqual([2, 3]);
  expect(invoke.mock.calls[1][1].snapshot.store[c.id].draft).toBe("terminal");
  writer.dispose();
});
it("retains newer edits after a failed save and retries without stale rollback", async () => {
  vi.useFakeTimers();
  let fail!: (e: Error) => void;
  const report = vi.fn();
  invoke.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const writer = new Persistence(report);
  writer.stage({ model: "old" });
  const flush = writer.flush();
  const assertion = expect(flush).rejects.toThrow("disk full");
  writer.stage({ model: "new" });
  fail(new Error("disk full")); await assertion;
  expect(report).toHaveBeenCalledWith(expect.stringContaining("not saved"));
  await writer.flush();
  expect(invoke.mock.calls[1][1].snapshot.model).toBe("new");
  expect(report).toHaveBeenLastCalledWith("");
  writer.dispose();
});

it("bounds draft crash loss even during continuous typing", async () => {
  vi.useFakeTimers(); invoke.mockResolvedValue(undefined);
  const writer = new Persistence(() => {});
  for (let index = 0; index < 30; index++) {
    writer.stage({ model: String(index) });
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(9);
  await writer.flush();
  expect(invoke.mock.calls.at(-1)![1].snapshot.model).toBe("29");
  writer.dispose();
});
