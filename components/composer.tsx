"use client";

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "./icons";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  side,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  side?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 180)}px`;
  }, [value]);
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!busy && !disabled && value.trim()) onSend();
    }
  }
  return (
    <form
      className={`composer ${side ? "composer-side" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !disabled && value.trim()) onSend();
      }}
    >
      <textarea
        ref={ref}
        data-composer={side ? "side" : "main"}
        aria-label={side ? "Side chat message" : "Message lightspeed"}
        placeholder={side ? "Ask about this passage…" : "Ask anything…"}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keyDown}
      />
      <div className="composer-bottom">
        <div className="composer-options">{children}</div>
        {busy ? (
          <button
            type="button"
            className="send-button"
            aria-label="Stop response"
            onClick={onStop}
          >
            <Icon name="stop" size={17} />
          </button>
        ) : (
          <button
            type="submit"
            className="send-button"
            aria-label={side ? "Send side message" : "Send message"}
            disabled={disabled || !value.trim()}
          >
            <Icon name="arrow" size={20} />
          </button>
        )}
      </div>
    </form>
  );
}
