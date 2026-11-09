"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import type { Message as MessageType, SideChat } from "@/lib/types";
import { restoreRangeFromOffsets } from "@/lib/selection";
import { Markdown } from "./markdown";
import { Icon } from "./icons";

type Fragment = {
  left: number;
  top: number;
  width: number;
  height: number;
  threadId: string;
};

export const Message = memo(function Message({
  message,
  threads,
  activeThreadId,
  onOpenThread,
  onRetry,
  selectable = true,
}: {
  message: MessageType;
  threads?: SideChat[];
  activeThreadId?: string | null;
  onOpenThread?: (id: string) => void;
  onRetry?: () => void;
  selectable?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [copied, setCopied] = useState(false);
  useLayoutEffect(() => {
    if (!root.current || !threads?.length) return;
    const element = root.current;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const next: Fragment[] = [];
        for (const thread of threads) {
          if (thread.anchor.messageId !== message.id) continue;
          const range = restoreRangeFromOffsets(
            element,
            thread.anchor.startOffset,
            thread.anchor.endOffset,
            thread.anchor.streamVersion,
          );
          if (!range) continue;
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width < 1 || rect.height < 1) continue;
            const fragment = {
              left: rect.left - bounds.left,
              top: rect.top - bounds.top,
              width: rect.width,
              height: rect.height,
              threadId: thread.id,
            };
            if (
              !next.some(
                (r) =>
                  r.threadId === fragment.threadId &&
                  Math.abs(r.left - fragment.left) < 1 &&
                  Math.abs(r.top - fragment.top) < 1 &&
                  Math.abs(r.width - fragment.width) < 1 &&
                  Math.abs(r.height - fragment.height) < 1,
              )
            )
              next.push(fragment);
          }
        }
        setFragments(next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Horizontal code/table scrolling moves ranges without resizing the message.
    element.addEventListener("scroll", measure, true);
    document.fonts.addEventListener("loadingdone", measure);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", measure, true);
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [message.id, message.content, threads]);

  return (
    <article
      className={`message message-${message.role}`}
      aria-label={
        message.role === "user" ? "Your message" : "lightspeed response"
      }
    >
      {message.role === "assistant" && (
        <div className="assistant-mark">
          <Icon name="sun" size={22} />
        </div>
      )}
      <div className="message-inner">
        <div
          className="message-render"
          onClick={(event) => {
            if (window.getSelection()?.toString()) return;
            const rect = root.current?.getBoundingClientRect();
            if (!rect) return;
            const hit = fragments.find(
              (f) =>
                event.clientX - rect.left >= f.left &&
                event.clientX - rect.left <= f.left + f.width &&
                event.clientY - rect.top >= f.top &&
                event.clientY - rect.top <= f.top + f.height,
            );
            if (hit) {
              event.preventDefault();
              onOpenThread?.(hit.threadId);
            }
          }}
        >
          <div className="highlight-layer" aria-hidden="true">
            {fragments.map((f, i) => (
              <span
                key={i}
                data-highlight-thread={f.threadId}
                className={activeThreadId === f.threadId ? "active" : ""}
                style={{
                  left: f.left,
                  top: f.top,
                  width: f.width,
                  height: f.height,
                }}
              />
            ))}
          </div>
          <div
            ref={root}
            className={message.role === "assistant" ? "prose" : "user-content"}
            data-message-content={message.id}
            data-selectable={
              selectable && message.role === "assistant" && !message.status
                ? "true"
                : undefined
            }
          >
            {message.content ? (
              message.role === "assistant" ? (
                <Markdown content={message.content} />
              ) : (
                message.content
              )
            ) : message.status === "streaming" ? (
              <span
                className="waiting"
                role="status"
                aria-label="Waiting for response"
              >
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        </div>
        {message.status === "streaming" && message.content && (
          <span className="writing-dot" role="status" aria-label="Writing" />
        )}
        {message.error && (
          <div className="message-error" role="alert">
            {message.error}
          </div>
        )}
        {message.status === "stopped" && (
          <div className="stopped-label">Stopped</div>
        )}
        {message.role === "assistant" && message.status !== "streaming" && (
          <div className="message-actions">
            {message.content && (
              <button
                className="icon-button"
                aria-label={copied ? "Copied response" : "Copy response"}
                title="Copy response"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(message.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <Icon name={copied ? "check" : "copy"} size={15} />
              </button>
            )}
            {onRetry && (
              <button
                className={message.error ? "text-button" : "icon-button"}
                aria-label="Retry response"
                title="Retry response"
                onClick={onRetry}
              >
                <Icon name="retry" size={15} />
                {message.error ? "Retry" : null}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
