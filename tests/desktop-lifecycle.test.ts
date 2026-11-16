import { afterEach, expect, it, vi } from "vitest";
import { createQuitHandler } from "../lib/desktop-lifecycle";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => vi.resetAllMocks());
it("awaits an explicit decision and keeps the app open on Cancel after save failure", async () => {
  let decide!: (leave: boolean) => void;
  invoke.mockImplementation(() => new Promise<boolean>((resolve) => { decide = resolve; }));
  const handler = createQuitHandler(async () => { throw new Error("disk full"); }, vi.fn());
  const pending = handler();
  await vi.waitFor(() => expect(decide).toBeDefined());
  expect(invoke).not.toHaveBeenCalledWith("finish_quit");
  decide(false); await pending;
  expect(invoke).not.toHaveBeenCalledWith("finish_quit");
});
it("only exits after successful flush or explicit exit without saving", async () => {
  invoke.mockResolvedValue(true);
  await createQuitHandler(async () => { throw new Error("disk full"); }, vi.fn())();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["confirm_exit_without_saving", "finish_quit"]);
  invoke.mockClear();
  await createQuitHandler(async () => {}, vi.fn())();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["finish_quit"]);
});
