"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOffsetsFromRange } from "@/lib/selection";
import { DEFAULT_SELECTION_STREAM_VERSION } from "@/lib/selection-stream";
import {
  ancestors,
  childrenOf,
  createChild,
  highlightsOf,
  validWorkspace,
} from "@/lib/conversations";
import type { Anchor, Workspace } from "@/lib/types";
import { ConversationPane, type ReadingState } from "./conversation-pane";
import { useConversations } from "./use-conversations";
import { Icon } from "./icons";

type PendingSelection = Anchor & {
  conversationId: string;
  x: number;
  y: number;
};
export function ChatApp() {
  const { store, current, put, patch, root, send, busy, stop } =
    useConversations();
  const [view, setView] = useState<Workspace>({ mainId: "", sideId: null });
  const viewRef = useRef(view);
  const [revealRevision, setRevealRevision] = useState(0);
  const [history, setHistory] = useState<Workspace[]>([]);
  const [sidebar, setSidebar] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectionButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const readings = useRef(new Map<string, ReadingState>());
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("qwen3:8b");
  const [connection, setConnection] = useState<"checking" | "ready" | "error">(
    "checking",
  );
  function focusComposer(side: boolean) {
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(
          `[data-composer="${side ? "side" : "main"}"]`,
        )
        ?.focus({ preventScroll: true }),
    );
  }
  const navigate = useCallback(
    (
      next: Workspace,
      focus: "main" | "side" | "source" = "main",
      back = false,
    ) => {
      if (!validWorkspace(current.current, next)) return;
      const previous = viewRef.current;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        if (!back && previous.mainId) setHistory((h) => [...h, previous]);
        viewRef.current = next;
        setView(next);
      }
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      if (window.innerWidth < 1100) setSidebar(false);
      if (focus === "source") setRevealRevision((n) => n + 1);
      if (focus !== "source") focusComposer(focus === "side");
    },
    [current],
  );
  useEffect(() => {
    const id = root();
    viewRef.current = { mainId: id, sideId: null };
    setView(viewRef.current);
  }, [root]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const resize = () => {
      setNarrow(query.matches);
      if (window.innerWidth < 760) setSidebar(false);
      if (query.matches && viewRef.current.sideId) focusComposer(true);
    };
    resize();
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  const connect = useCallback(async () => {
    setConnection("checking");
    try {
      const response = await fetch("/ollama/models", {
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const names: string[] =
        data.models?.map((m: { name: string }) => m.name) || [];
      if (!names.length) throw new Error();
      setModels(names);
      setModel((c) => (names.includes(c) ? c : names[0]));
      setConnection("ready");
    } catch {
      setConnection("error");
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  const closeSide = useCallback(() => {
    navigate({ ...viewRef.current, sideId: null });
    requestAnimationFrame(() => {
      if (opener.current?.isConnected && !opener.current.closest("[inert]"))
        opener.current.focus({ preventScroll: true });
    });
  }, [navigate]);
  function openChild(id: string) {
    const c = current.current[id];
    if (!c?.source) return;
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    navigate({ mainId: c.source.conversationId, sideId: id }, "side");
  }
  function showSource(id: string) {
    const c = current.current[id];
    if (c?.source)
      navigate(
        {
          mainId: c.source.conversationId,
          sideId: window.innerWidth < 900 ? null : id,
          sourceId: id,
        },
        "source",
      );
  }
  function back() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    navigate(
      previous,
      previous.sourceId ? "source" : previous.sideId ? "side" : "main",
      true,
    );
  }
  function createFollowup() {
    const pending = selectionRef.current;
    if (!pending) return;
    const active = viewRef.current;
    if (
      pending.conversationId !== active.mainId &&
      pending.conversationId !== active.sideId
    )
      return;
    const { conversationId, x: _x, y: _y, ...anchor } = pending;
    const child = createChild(current.current, conversationId, anchor);
    if (!child) {
      setSelection(null);
      return;
    }
    put(child);
    openChild(child.id);
  }
  const followupAction = useRef(createFollowup);
  followupAction.current = createFollowup;
  useEffect(() => {
    const capture = () => {
      selectionRef.current = null;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) {
        setSelection(null);
        return;
      }
      const range = selected.getRangeAt(0);
      const parent =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const element = parent?.closest<HTMLElement>('[data-selectable="true"]');
      const pane = element?.closest<HTMLElement>("[data-conversation-id]");
      const id = pane?.dataset.conversationId;
      if (
        !element ||
        !id ||
        pane?.hasAttribute("inert") ||
        !element.contains(range.endContainer) ||
        ![viewRef.current.mainId, viewRef.current.sideId].includes(id)
      ) {
        setSelection(null);
        return;
      }
      const offsets = getOffsetsFromRange(element, range);
      if (!offsets) {
        setSelection(null);
        return;
      }
      const rects = range.getClientRects();
      const rect = rects[rects.length - 1] || range.getBoundingClientRect();
      const pending = {
        ...offsets,
        conversationId: id,
        messageId: element.dataset.messageContent!,
        streamVersion: DEFAULT_SELECTION_STREAM_VERSION,
        x: Math.max(12, Math.min(rect.left, window.innerWidth - 200)),
        y: Math.max(12, Math.min(rect.bottom + 9, window.innerHeight - 56)),
      };
      selectionRef.current = pending;
      setSelection(pending);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectionRef.current) {
          setSelection(null);
          window.getSelection()?.removeAllRanges();
        } else if (viewRef.current.sideId) closeSide();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "Enter" &&
        window.getSelection()?.toString()
      ) {
        e.preventDefault();
        capture();
        followupAction.current();
      }
    };
    const dismiss = () => setSelection(null);
    document.addEventListener("selectionchange", capture);
    document.addEventListener("keydown", keydown);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [closeSide]);
  const main = store[view.mainId];
  const side = view.sideId ? store[view.sideId] : undefined;
  const navControls = (
    <>
      <button
        className="text-button"
        onClick={back}
        disabled={!history.length}
        aria-label="Back to previous workspace"
      >
        Back
      </button>
      <button
        className="icon-button"
        aria-label={sidebar ? "Collapse sidebar" : "Expand sidebar"}
        onClick={() => setSidebar(!sidebar)}
      >
        <Icon name="panel" />
      </button>
    </>
  );
  const crumb = (id: string, title: string) => (
    <button
      key={id}
      className="breadcrumb"
      title={title}
      aria-label={`Open ${title} as main`}
      aria-current={id === view.mainId ? "page" : undefined}
      onClick={() => navigate({ mainId: id, sideId: null })}
    >
      {title}
    </button>
  );
  const breadcrumbs = (id: string) => {
    const path = ancestors(store, id);
    return (
      <nav className="breadcrumbs" aria-label="Conversation path">
        {path.length > 2 ? (
          <>
            {crumb(path[0].id, path[0].title)}
            <details className="ancestor-menu">
              <summary aria-label="Intermediate conversations">…</summary>
              <div>{path.slice(1, -1).map((c) => crumb(c.id, c.title))}</div>
            </details>
            {crumb(id, store[id].title)}
          </>
        ) : (
          path.map((c) => crumb(c.id, c.title))
        )}
      </nav>
    );
  };
  const sourceChild = view.sourceId ? store[view.sourceId] : undefined;
  const preview =
    sourceChild?.source &&
    !main?.messages.some((m) => m.id === sourceChild.source!.anchor.messageId)
      ? sourceChild
      : undefined;
  const pane = (id: string, isSide: boolean) => {
    const c = store[id];
    return (
      <ConversationPane
        key={id}
        conversation={c}
        side={isSide}
        hidden={!isSide && narrow && !!side}
        header={
          isSide ? (
            <>
              <div className="side-navigation">
                {narrow && (
                  <>
                    {navControls}
                    {breadcrumbs(id)}
                  </>
                )}
                {!narrow && (
                  <span className="chat-title" title={c.title}>
                    {c.title}
                  </span>
                )}
              </div>
              <div>
                <button
                  className="text-button"
                  onClick={() => navigate({ mainId: id, sideId: null })}
                >
                  Open as main
                </button>
                <button
                  className="icon-button"
                  aria-label="Close side chat"
                  onClick={closeSide}
                >
                  <Icon name="close" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="header-left">
                {navControls}
                {breadcrumbs(view.mainId)}
              </div>
              <button
                className="icon-button"
                aria-label="New chat"
                onClick={() => navigate({ mainId: root(), sideId: null })}
              >
                <Icon name="plus" />
              </button>
            </>
          )
        }
        highlights={highlightsOf(store, id)}
        activeId={view.sideId || view.sourceId || null}
        busy={busy.has(id)}
        readings={readings.current}
        preview={isSide ? undefined : preview}
        sourceTarget={isSide ? undefined : sourceChild}
        revealRevision={revealRevision}
        onSource={() => showSource(id)}
        onOpen={openChild}
        onDraft={(draft) => patch(id, (c) => ({ ...c, draft }))}
        onSend={() => void send(id, model)}
        onRetry={() => void send(id, model, true)}
        onStop={() => stop(id)}
      >
        {isSide ? (
          <span className="side-model">{model}</span>
        ) : (
          <>
            <label className="model-picker">
              <span className={`connection-dot ${connection}`} />
              <select
                aria-label="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {(models.length ? models : [model]).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            {connection === "error" && (
              <button className="text-button" onClick={connect}>
                Reconnect to Ollama
              </button>
            )}
          </>
        )}
      </ConversationPane>
    );
  };
  return (
    <div
      className={`app ${sidebar ? "sidebar-open" : ""} ${side ? "thread-open" : ""}`}
    >
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar" aria-label="Chat navigation" inert={!sidebar}>
        <div className="sidebar-brand">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate({ mainId: root(), sideId: null });
            }}
          >
            <Icon name="sun" size={24} />
            <span>afterlight</span>
          </a>
          <button
            className="icon-button"
            aria-label="Collapse sidebar"
            onClick={() => setSidebar(false)}
          >
            <Icon name="panel" />
          </button>
        </div>
        <button
          className="new-chat"
          onClick={() => navigate({ mainId: root(), sideId: null })}
        >
          <Icon name="plus" />
          New chat
        </button>
        <nav className="chat-list" aria-label="Chats">
          <p className="list-label">Chats</p>
          {Object.values(store)
            .filter((c) => !c.source)
            .map((c) => (
              <button
                key={c.id}
                className={`chat-link ${c.id === view.mainId ? "selected" : ""}`}
                onClick={() => navigate({ mainId: c.id, sideId: null })}
              >
                <span>{c.title}</span>
                {busy.has(c.id) && <i className="running-dot" />}
              </button>
            ))}
          {!!childrenOf(store, view.mainId).length && (
            <>
              <p className="list-label side-list-label">Follow-ups</p>
              {childrenOf(store, view.mainId).map((c) => (
                <button
                  key={c.id}
                  className={`chat-link side-link ${c.id === view.sideId ? "selected" : ""}`}
                  onClick={() => openChild(c.id)}
                >
                  <Icon name="follow" size={15} />
                  <span>{c.title}</span>
                  {busy.has(c.id) && <i className="running-dot" />}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <span className={`connection-dot ${connection}`} />
          <span>
            {connection === "ready"
              ? "Running locally"
              : connection === "checking"
                ? "Connecting to Ollama…"
                : "Ollama is offline"}
          </span>
          {connection === "error" && (
            <button className="text-button" onClick={connect}>
              Reconnect
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        {main && pane(main.id, false)}
        {side && pane(side.id, true)}
      </div>
      {selection && (
        <button
          ref={selectionButton}
          className="selection-popover"
          style={{ left: selection.x, top: selection.y }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={createFollowup}
        >
          Ask a follow-up
          <Icon name="follow" size={16} />
        </button>
      )}
    </div>
  );
}
