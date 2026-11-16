import type { ModelMessage } from "./types";

export type RunIdentity = { conversationId: string; messageId: string; requestId: string };
type StreamEvent = RunIdentity & { kind: "text" | "done" | "error" | "stopped"; text?: string };

export function desktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// No fetch fallback: a broken native bridge must remain a visible desktop error.
export async function nativeStream(
  model: string, messages: ModelMessage[], signal: AbortSignal,
  onText: (text: string) => void, identity: RunIdentity,
  onCancelError?: (error: string) => void,
) {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  let acknowledged = false;
  let retired = false;
  let pending: StreamEvent[] = [];
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // Install a handler before invoking; a short reply may arrive before acknowledgement.
  const accept = (event: StreamEvent) => {
    if (retired || event.requestId !== identity.requestId ||
        event.conversationId !== identity.conversationId || event.messageId !== identity.messageId) return;
    if (!acknowledged) { pending.push(event); return; }
    if (event.kind === "text") {
      if (!signal.aborted) onText(event.text || "");
    } else {
      retired = true;
      if (event.kind === "done" && !signal.aborted) resolve();
      else reject(event.kind === "stopped" || signal.aborted
        ? new DOMException("Aborted", "AbortError")
        : new Error(event.text || "The native stream failed. Please retry."));
    }
  };
  const channel = new Channel<StreamEvent>(accept);
  const cancel = () => {
    if (acknowledged && !retired) {
      // Keep the run busy until native termination, including when cancellation fails.
      void invoke("cancel_reply", { identity }).catch((error) => {
        if (retired) return;
        onCancelError?.(`Could not confirm Stop: ${String(error)}. Retrying cancellation…`);
        cancelTimer = setTimeout(cancel, 1000);
      });
    }
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const ack = await invoke<RunIdentity>("start_reply", { identity, model, messages, channel });
    if (ack.requestId !== identity.requestId || ack.messageId !== identity.messageId ||
        ack.conversationId !== identity.conversationId) throw new Error("Native request acknowledgement did not match.");
    acknowledged = true;
    for (const event of pending) accept(event);
    pending = [];
    if (signal.aborted) cancel();
    await finished;
  } catch (error) {
    throw error instanceof Error || error instanceof DOMException ? error : new Error(String(error));
  } finally {
    retired = true;
    clearTimeout(cancelTimer);
    pending = [];
    channel.onmessage = () => {};
    signal.removeEventListener("abort", cancel);
    // Dropping the Rust channel unregisters its JS callback on termination.
  }
}
