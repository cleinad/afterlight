"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamReply, systemPrompt, toModelMessages } from "@/lib/ollama";
import {
  newChat,
  type Conversation,
  type ConversationStore,
  type Message,
  type Workspace,
} from "@/lib/types";

import { desktop } from "@/lib/runtime";
import { Persistence } from "@/lib/persistence";

type Run = { controller: AbortController; messageId: string };
export function useConversations() {
  const [store, setStore] = useState<ConversationStore>({});
  const current = useRef(store);
  const [ready, setReady] = useState(!desktop());
  const [saveError, setSaveError] = useState("");
  const [restored, setRestored] = useState<{ workspace: Workspace | null; model: string } | null>(null);
  const persistence = useRef<Persistence | null>(null);
  const durable = useRef<ConversationStore>({});
  useEffect(() => {
    if (!desktop()) return;
    const writer = new Persistence(setSaveError);
    persistence.current = writer;
    let disposed = false;
    void writer.load().then((saved) => {
      if (disposed) return;
      current.current = saved.store;
      durable.current = saved.store;
      setStore(saved.store);
      setRestored({ workspace: saved.workspace, model: saved.model });
      setReady(true);
    }).catch((error) => setSaveError(`Could not open saved chats: ${String(error)}. Restart after resolving storage recovery.`));
    return () => { disposed = true; writer.dispose(); };
  }, []);
  const runs = useRef(new Map<string, Run>());
  const committing = useRef(new Set<string>());
  const [busy, setBusy] = useState(new Set<string>());
  const put = useCallback((c: Conversation, mode: "metadata" | "checkpoint" | "transient" = "metadata") => {
    current.current = { ...current.current, [c.id]: c };
    setStore(current.current);
    if (mode !== "transient") {
      const saved = committing.current.has(c.id) ? { ...durable.current[c.id], draft: c.draft } : mode === "checkpoint" ? c : { ...c, messages: c.messages.map((m) =>
        m.status === "streaming" ? { ...m, content: durable.current[c.id]?.messages.find((old) => old.id === m.id)?.content || "" } : m) };
      durable.current = { ...durable.current, [c.id]: saved };
      persistence.current?.stage({ store: durable.current });
    }
  }, []);
  const patch = useCallback(
    (id: string, update: (c: Conversation) => Conversation) => {
      const c = current.current[id];
      if (c) put(update(c));
    },
    [put],
  );
  useEffect(
    () => () => {
      for (const run of runs.current.values()) run.controller.abort();
    },
    [],
  );
  const root = useCallback(() => {
    if (!ready) return "";
    const c =
      Object.values(current.current).find(
        (c) => !c.source && !c.messages.length,
      ) || newChat();
    put(c);
    return c.id;
  }, [put, ready]);
  const flush = useCallback(() => persistence.current?.flush() || Promise.resolve(), []);
  const saveWorkspace = useCallback((workspace: Workspace, model: string) => persistence.current?.stage({ workspace, model }), []);
  async function send(id: string, model: string, retry = false) {
    const c = current.current[id];
    if (!ready || saveError || !c || runs.current.has(id)) return;
    if (
      c.source &&
      (c.source.messageSnapshot.status ||
        c.source.messageSnapshot.role !== "assistant")
    )
      return;
    const draft = c.draft.trim();
    if (retry ? c.messages.at(-1)?.role !== "assistant" : !draft) return;
    const history: Message[] = retry
      ? c.messages.slice(0, -1)
      : [
          ...c.messages,
          { id: crypto.randomUUID(), role: "user", content: draft },
        ];
    const reply: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
      model,
    };
    const run = { controller: new AbortController(), messageId: reply.id };
    runs.current.set(id, run);
    setBusy(new Set(runs.current.keys()));
    const attempt: Conversation = {
      ...c,
      title: c.messages.length
        ? c.title
        : history[0]?.content.slice(0, 55) || c.title,
      draft: retry ? c.draft : "",
      messages: [...history, reply],
    };
    // Atomic Send/Retry is committed before the UI clears the draft or calls Ollama.
    if (persistence.current) {
      const before = durable.current[id];
      committing.current.add(id);
      durable.current = { ...durable.current, [id]: attempt };
      persistence.current.stage({ store: durable.current });
      try { await persistence.current.flush(); }
      catch {
        committing.current.delete(id);
        durable.current = { ...durable.current, [id]: { ...before, draft: current.current[id].draft } };
        persistence.current.stage({ store: durable.current });
        runs.current.delete(id);
        setBusy(new Set(runs.current.keys()));
        return;
      }
    }
    committing.current.delete(id);
    put({ ...attempt, draft: current.current[id].draft === c.draft ? attempt.draft : current.current[id].draft });
    const context = [
      { role: "system" as const, content: systemPrompt },
      ...c.inheritedContext,
      ...toModelMessages(history),
    ];
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checkpoint: ReturnType<typeof setInterval> | undefined;
    const update = (status?: Message["status"], error?: string) => {
      if (runs.current.get(id) !== run) return;
      const c = current.current[id];
      put({
        ...c,
        messages: c.messages.map((m) =>
          m.id === run.messageId ? { ...m, content: text, status, error } : m,
        ),
      }, status === "streaming" ? "transient" : "checkpoint");
    };
    const terminal = async (status?: Message["status"], error?: string) => {
      clearInterval(checkpoint);
      clearTimeout(timer);
      // Keep the reply unselectable while committing its terminal state.
      const c = current.current[id];
      const completed = { ...c, messages: c.messages.map((m) => m.id === reply.id ? { ...m, content: text, status, error } : m) };
      if (persistence.current) {
        committing.current.add(id);
        durable.current = { ...durable.current, [id]: completed };
        persistence.current.stage({ store: durable.current });
        try { await persistence.current.flush(); }
        catch {
          committing.current.delete(id);
          update("error", "The response could not be saved. Resolve the save error before retrying.");
          return;
        }
      }
      committing.current.delete(id);
      put({ ...completed, draft: current.current[id].draft });
    };
    checkpoint = setInterval(() => {
      const c = current.current[id];
      if (runs.current.get(id) === run && c) put(c, "checkpoint");
    }, 1000);
    try {
      await streamReply(model, context, run.controller.signal, (delta) => {
        if (runs.current.get(id) !== run || run.controller.signal.aborted)
          return;
        text += delta;
        if (!timer)
          timer = setTimeout(() => {
            timer = undefined;
            update("streaming");
          }, 32);
      }, { conversationId: id, messageId: reply.id, requestId: crypto.randomUUID() },
      (error) => {
        clearTimeout(timer);
        timer = undefined;
        update("streaming", error);
      });
      if (run.controller.signal.aborted) await terminal("stopped");
      else {
        if (!text.trim())
          throw new Error(
            "The model returned an empty response. Please retry.",
          );
        await terminal();
      }
    } catch (error) {
      await terminal(
        run.controller.signal.aborted ? "stopped" : "error",
        run.controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : "Something went wrong. Please retry.",
      );
    } finally {
      clearTimeout(timer);
      clearInterval(checkpoint);
      if (runs.current.get(id) === run) {
        runs.current.delete(id);
        setBusy(new Set(runs.current.keys()));
      }
    }
  }
  return {
    store,
    ready, saveError, restored,
    flush, saveWorkspace,
    current,
    put,
    patch,
    root,
    send,
    busy,
    stop: (id: string) => runs.current.get(id)?.controller.abort(),
  };
}
