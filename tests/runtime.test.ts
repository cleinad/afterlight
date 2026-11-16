import { afterEach, expect, it, vi } from "vitest";
import { nativeStream } from "../lib/runtime";
import { listModels, streamReply } from "../lib/ollama";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    constructor(public onmessage: (event: unknown) => void) {}
  },
}));
const identity = { conversationId: "chat", messageId: "assistant", requestId: "request" };
type Channel = { onmessage: (event: object) => void };
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

it("buffers early events until acknowledgement and ignores all mismatched identities", async () => {
  const text: string[] = [];
  let channel!: Channel;
  invoke.mockImplementation(async (_command, args) => {
    channel = args.channel;
    channel.onmessage({ ...identity, kind: "text", text: "early" });
    expect(text).toEqual([]);
    for (const field of Object.keys(identity)) {
      channel.onmessage({ ...identity, [field]: "other", kind: "text", text: "wrong" });
    }
    channel.onmessage({ ...identity, kind: "done" });
    return identity;
  });
  await nativeStream("model", [], new AbortController().signal, (s) => text.push(s), identity);
  expect(text).toEqual(["early"]);
  channel.onmessage({ ...identity, kind: "text", text: "late" });
  expect(text).toEqual(["early"]);
});

it("cancels a request aborted before acknowledgement, suppressing queued text", async () => {
  const controller = new AbortController();
  const text = vi.fn();
  let channel!: Channel;
  invoke.mockImplementation(async (command, args) => {
    if (command === "start_reply") {
      channel = args.channel;
      controller.abort();
      channel.onmessage({ ...identity, kind: "text", text: "late" });
      return identity;
    }
    channel.onmessage({ ...identity, kind: "stopped" });
  });
  await expect(nativeStream("model", [], controller.signal, text, identity))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).toHaveBeenCalledWith("cancel_reply", { identity });
  expect(text).not.toHaveBeenCalled();
});

it("surfaces native failures and never falls back to browser HTTP", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.stubGlobal("fetch", vi.fn());
  invoke.mockRejectedValue("native initialization failed");
  await expect(listModels()).rejects.toBe("native initialization failed");
  await expect(streamReply("model", [], new AbortController().signal, () => {}, identity))
    .rejects.toThrow("native initialization failed");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not treat a native error event as success", async () => {
  invoke.mockImplementation(async (_command, args) => {
    args.channel.onmessage({ ...identity, kind: "error", text: "Incomplete stream" });
    return identity;
  });
  await expect(nativeStream("model", [], new AbortController().signal, () => {}, identity))
    .rejects.toThrow("Incomplete stream");
});

it("keeps a failed Stop pending until native termination and reports the failure", async () => {
  const controller = new AbortController();
  let channel!: Channel;
  let report!: () => void;
  const reported = new Promise<void>((resolve) => { report = resolve; });
  const onCancelError = vi.fn(() => report());
  invoke.mockImplementation(async (command, args) => {
    if (command === "start_reply") { channel = args.channel; return identity; }
    throw new Error("bridge unavailable");
  });
  let settled = false;
  const result = nativeStream("model", [], controller.signal, () => {}, identity, onCancelError);
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  void result.then(() => { settled = true; }, () => { settled = true; });
  // Let start_reply acknowledge before aborting.
  await vi.waitFor(() => expect(channel).toBeDefined());
  controller.abort();
  await reported;
  expect(onCancelError).toHaveBeenCalledWith(expect.stringContaining("Could not confirm Stop"));
  expect(settled).toBe(false);
  channel.onmessage({ ...identity, kind: "stopped" });
  await assertion;
});
