"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamReply, systemPrompt, toModelMessages } from "@/lib/ollama";
import {
  newChat,
  type Conversation,
  type ConversationStore,
  type Message,
} from "@/lib/types";

type Run = { controller: AbortController; messageId: string };
export function useConversations() {
  const [store, setStore] = useState<ConversationStore>({});
  const current = useRef(store);
  const runs = useRef(new Map<string, Run>());
  const [busy, setBusy] = useState(new Set<string>());
  const put = useCallback((c: Conversation) => {
    current.current = { ...current.current, [c.id]: c };
    setStore(current.current);
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
    const c =
      Object.values(current.current).find(
        (c) => !c.source && !c.messages.length,
      ) || newChat();
    put(c);
    return c.id;
  }, [put]);
  async function send(id: string, model: string, retry = false) {
    const c = current.current[id];
    if (!c || runs.current.has(id)) return;
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
    };
    const run = { controller: new AbortController(), messageId: reply.id };
    runs.current.set(id, run);
    setBusy(new Set(runs.current.keys()));
    put({
      ...c,
      title: c.messages.length
        ? c.title
        : history[0]?.content.slice(0, 55) || c.title,
      draft: retry ? c.draft : "",
      messages: [...history, reply],
    });
    const context = [
      { role: "system" as const, content: systemPrompt },
      ...c.inheritedContext,
      ...toModelMessages(history),
    ];
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (status?: Message["status"], error?: string) => {
      if (runs.current.get(id) !== run) return;
      patch(id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === run.messageId ? { ...m, content: text, status, error } : m,
        ),
      }));
    };
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
      });
      if (run.controller.signal.aborted) update("stopped");
      else {
        if (!text.trim())
          throw new Error(
            "The model returned an empty response. Please retry.",
          );
        update();
      }
    } catch (error) {
      update(
        run.controller.signal.aborted ? "stopped" : "error",
        run.controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : "Something went wrong. Please retry.",
      );
    } finally {
      clearTimeout(timer);
      if (runs.current.get(id) === run) {
        runs.current.delete(id);
        setBusy(new Set(runs.current.keys()));
      }
    }
  }
  return {
    store,
    current,
    put,
    patch,
    root,
    send,
    busy,
    stop: (id: string) => runs.current.get(id)?.controller.abort(),
  };
}
