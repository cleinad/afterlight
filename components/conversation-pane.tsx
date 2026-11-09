"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation, Highlight } from "@/lib/types";
import { restoreRangeFromOffsets } from "@/lib/selection";
import { Message } from "./message";
import { Composer } from "./composer";
import { Icon } from "./icons";

export type ReadingState = { top: number; following: boolean };
export function ConversationPane({
  conversation: c,
  side,
  hidden,
  header,
  children,
  highlights,
  activeId,
  busy,
  readings,
  preview,
  sourceTarget,
  revealRevision,
  onSource,
  onOpen,
  onDraft,
  onSend,
  onRetry,
  onStop,
}: {
  conversation: Conversation;
  side?: boolean;
  hidden?: boolean;
  header: ReactNode;
  children?: ReactNode;
  highlights: Highlight[];
  activeId: string | null;
  busy: boolean;
  readings: Map<string, ReadingState>;
  preview?: Conversation;
  sourceTarget?: Conversation;
  revealRevision: number;
  onSource: () => void;
  onOpen: (id: string) => void;
  onDraft: (draft: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onStop: () => void;
}) {
  const pane = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const [away, setAway] = useState(false);
  const save = () => {
    const el = scroll.current;
    if (el && !hidden) {
      lastTop.current = el.scrollTop;
      readings.set(c.id, { top: el.scrollTop, following: following.current });
    }
  };
  useLayoutEffect(() => {
    if (hidden) return;
    const el = scroll.current!;
    const saved = readings.get(c.id);
    following.current = saved?.following ?? true;
    el.scrollTop = following.current ? el.scrollHeight : saved!.top;
    lastTop.current = el.scrollTop;
    setAway(!following.current);
    return () => {
      // CSS can hide a pane before this cleanup runs at a responsive breakpoint.
      const visible =
        pane.current && getComputedStyle(pane.current).display !== "none";
      readings.set(c.id, {
        top: visible ? el.scrollTop : lastTop.current,
        following: following.current,
      });
    };
  }, [c.id, hidden, readings]);
  useLayoutEffect(() => {
    if (!hidden && following.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [c.messages, hidden]);
  useLayoutEffect(() => {
    if (hidden || !scroll.current) return;
    const el = scroll.current;
    let frame = 0;
    const followResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (following.current) el.scrollTop = el.scrollHeight;
      });
    };
    const observer = new ResizeObserver(followResize);
    observer.observe(el);
    const messages = el.querySelector(side ? ".side-messages" : ".messages");
    if (messages) observer.observe(messages);
    document.fonts?.addEventListener("loadingdone", followResize);
    followResize();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.fonts?.removeEventListener("loadingdone", followResize);
    };
  }, [side, hidden, c.id]);
  useLayoutEffect(() => {
    if (hidden || !sourceTarget?.source) return;
    const source = sourceTarget.source;
    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      const container = pane.current?.querySelector<HTMLElement>(
        `[data-message-content="${source.anchor.messageId}"]`,
      );
      const el = scroll.current;
      if (!container || !el) return;
      const range = restoreRangeFromOffsets(
        container,
        source.anchor.startOffset,
        source.anchor.endOffset,
        source.anchor.streamVersion,
      );
      // Reveal the start of selections inside horizontally clipped code and tables.
      let ancestor =
        range?.startContainer instanceof Element
          ? range.startContainer
          : range?.startContainer.parentElement;
      while (range && ancestor && container.contains(ancestor)) {
        if (
          ancestor instanceof HTMLElement &&
          ancestor.scrollWidth > ancestor.clientWidth
        ) {
          const bounds =
            range.getClientRects()[0] || range.getBoundingClientRect();
          const clip = ancestor.getBoundingClientRect();
          if (bounds.left < clip.left || bounds.right > clip.right)
            ancestor.scrollLeft += bounds.left - clip.left - 12;
        }
        ancestor = ancestor.parentElement;
      }
      const bounds =
        range?.getClientRects()[0] ||
        range?.getBoundingClientRect() ||
        container.getBoundingClientRect();
      el.scrollTop +=
        bounds.top - el.getBoundingClientRect().top - el.clientHeight / 3;
      lastTop.current = el.scrollTop;
      following.current = false;
      setAway(true);
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(reveal);
    void document.fonts?.ready.then(reveal);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // Only discrete navigation reveals a source; child token/draft updates must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTarget?.id, revealRevision, hidden]);
  return (
    <section
      ref={pane}
      className={side ? "side-chat" : "main-chat"}
      data-conversation-id={c.id}
      aria-label={side ? "Side chat" : "Main chat"}
      inert={hidden}
    >
      <header className={side ? "side-header" : "chat-header"}>{header}</header>
      <div
        className={side ? "side-transcript" : "transcript"}
        ref={scroll}
        onScroll={() => {
          const el = scroll.current!;
          if (
            hidden ||
            (pane.current && getComputedStyle(pane.current).display === "none")
          )
            return;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 90;
          setAway(!following.current);
          save();
        }}
      >
        {c.source && (
          <div className="source-passage">
            <blockquote>{c.source.anchor.selectedText}</blockquote>
            <button className="text-button" onClick={onSource}>
              Show in parent
            </button>
          </div>
        )}
        <div className={side ? "side-messages" : "messages"}>
          {preview?.source && (
            <div className="earlier-response" aria-label="Earlier response">
              <p>Earlier response</p>
              <Message
                message={preview.source.messageSnapshot}
                threads={highlights}
                activeThreadId={preview.id}
                selectable={false}
                onOpenThread={onOpen}
              />
            </div>
          )}
          {!c.messages.length && !c.source && (
            <div className="empty-chat">
              <Icon name="sun" size={44} />
              <h1>What’s on your mind?</h1>
            </div>
          )}
          {c.messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              threads={highlights}
              activeThreadId={activeId}
              onOpenThread={onOpen}
              onRetry={
                i === c.messages.length - 1 && m.role === "assistant" && !busy
                  ? onRetry
                  : undefined
              }
            />
          ))}
        </div>
      </div>
      <div className={side ? "side-composer-dock" : "composer-dock"}>
        {away && (
          <button
            className="jump-button icon-button"
            aria-label="Jump to latest message"
            onClick={() => {
              following.current = true;
              setAway(false);
              scroll.current!.scrollTop = scroll.current!.scrollHeight;
              save();
            }}
          >
            <Icon name="down" />
          </button>
        )}
        <div className="composer-width">
          <Composer
            side={side}
            value={c.draft}
            onChange={onDraft}
            busy={busy}
            onStop={onStop}
            onSend={() => {
              following.current = true;
              setAway(false);
              onSend();
            }}
          >
            {children}
          </Composer>
        </div>
      </div>
    </section>
  );
}
