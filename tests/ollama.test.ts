import { afterEach, describe, expect, it, vi } from "vitest";
import { streamReply } from "../lib/ollama";

afterEach(() => vi.unstubAllGlobals());

function mockStream(parts: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              parts.forEach((part) =>
                controller.enqueue(new TextEncoder().encode(part)),
              );
              controller.close();
            },
          }),
        ),
    ),
  );
}

describe("Ollama streaming transport", () => {
  it("handles split NDJSON and a final line without a newline", async () => {
    mockStream([
      '{"message":{"content":"Hi ',
      '🙂"}}\n{"message":{"content":" there"}}\n',
      '{"done":true}',
    ]);
    let text = "";
    const controller = new AbortController();
    await streamReply(
      "qwen3:8b",
      [{ role: "user", content: "Hello" }],
      controller.signal,
      (delta) => (text += delta),
    );
    expect(text).toBe("Hi 🙂 there");
    expect(fetch).toHaveBeenCalledWith(
      "/ollama/chat",
      expect.objectContaining({ signal: controller.signal }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      think: false,
      stream: true,
      keep_alive: "10m",
    });
  });

  it("does not report a truncated stream as a successful answer", async () => {
    mockStream(['{"message":{"content":"partial"}}\n']);
    await expect(
      streamReply("model", [], new AbortController().signal, () => {}),
    ).rejects.toThrow("before the reply finished");
  });

  it("surfaces model failures delivered inside a successful HTTP stream", async () => {
    mockStream(['{"error":"model needs more memory"}\n']);
    await expect(
      streamReply("model", [], new AbortController().signal, () => {}),
    ).rejects.toThrow("model needs more memory");
  });

  it("gives an actionable error when Ollama is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 502 })),
    );
    await expect(
      streamReply("model", [], new AbortController().signal, () => {}),
    ).rejects.toThrow("ollama serve");
  });

  it("propagates cancellation while waiting for tokens", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                controller.signal.addEventListener("abort", () =>
                  stream.error(new DOMException("Aborted", "AbortError")),
                );
              },
            }),
          ),
      ),
    );
    const promise = streamReply("model", [], controller.signal, () => {});
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
