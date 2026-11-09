import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatApp } from "../components/chat-app";
import { restoreRangeFromOffsets } from "../lib/selection";
import type { ModelMessage } from "../lib/types";
const requests = vi.hoisted(
  () =>
    [] as {
      messages: ModelMessage[];
      signal: AbortSignal;
      chunk: (s: string) => void;
      resolve: () => void;
      reject: (e: Error) => void;
    }[],
);
vi.mock("../lib/ollama", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  streamReply: (
    _model: string,
    messages: ModelMessage[],
    signal: AbortSignal,
    chunk: (s: string) => void,
  ) =>
    new Promise<void>((resolve, reject) =>
      requests.push({ messages, signal, chunk, resolve, reject }),
    ),
}));
let root: Root;
const tick = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};
function button(label: string, scope: ParentNode = document) {
  const b = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  );
  if (!b) throw new Error(`Missing button ${label}`);
  return b;
}
async function click(label: string, scope?: ParentNode) {
  await act(async () => button(label, scope).click());
  await tick();
}
function pane(side = false) {
  return document.querySelector<HTMLElement>(
    side ? ".side-chat" : ".main-chat",
  )!;
}
async function draft(text: string, side = false) {
  const input = pane(side).querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(text: string, side = false) {
  await draft(text, side);
  await click(side ? "Send side message" : "Send message", pane(side));
}
async function finish(text: string) {
  await act(async () => {
    const r = requests.at(-1)!;
    r.chunk(text);
    r.resolve();
  });
  await tick();
}
async function select(side = false, start = 0, end = 4) {
  const content = pane(side).querySelector<HTMLElement>(
    '[data-selectable="true"]',
  )!;
  const range = restoreRangeFromOffsets(content, start, end)!;
  await act(async () => {
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await tick();
}
async function follow(side = false, start = 0, end = 4) {
  await select(side, start, end);
  await click("Ask a follow-up");
}
beforeEach(async () => {
  requests.length = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "qwen3:8b" }] }),
    }),
  );
  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById("test")!);
  await act(async () => root.render(<ChatApp />));
  await tick();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("explores A → B → C → D from either pane, restores workspaces/drafts, and keeps frozen request context", async () => {
  await send("root question");
  await finish("AAAA root passage");
  const a = pane().dataset.conversationId;
  await follow();
  const b = pane(true).dataset.conversationId;
  expect(document.activeElement).toBe(pane(true).querySelector("textarea"));
  await send("child question", true);
  await finish("BBBB child passage");
  await draft("draft A");
  await draft("draft B", true);
  await follow(true);
  const c = pane(true).dataset.conversationId;
  expect(pane().dataset.conversationId).toBe(b);
  expect(pane().querySelector("textarea")!.value).toBe("draft B");
  await send("grandchild question", true);
  await finish("CCCC next passage");
  await follow(true);
  const d = pane(true).dataset.conversationId;
  expect(pane().dataset.conversationId).toBe(c);
  await send("deep question", true);
  await finish("DDDD final passage");
  const context = requests.at(-1)!.messages;
  for (const value of [
    "AAAA root passage",
    "BBBB child passage",
    "CCCC next passage",
    "deep question",
  ])
    expect(context.filter((m) => m.content === value)).toHaveLength(1);
  expect(document.querySelectorAll("[data-conversation-id]")).toHaveLength(2);
  await click("Open as main");
  expect(pane().dataset.conversationId).toBe(d);
  await click("Show in parent");
  expect(pane().dataset.conversationId).toBe(c);
  expect(pane(true).dataset.conversationId).toBe(d);
  await click("Back to previous workspace", pane());
  expect(pane().dataset.conversationId).toBe(d);
  await click("Open root question as main");
  expect(pane().dataset.conversationId).toBe(a);
  expect(pane().querySelector("textarea")!.value).toBe("draft A");
  await follow();
  expect(pane(true).dataset.conversationId).toBe(b);
  expect(pane(true).querySelector("textarea")!.value).toBe("draft B");
  await select();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector(".selection-popover")).toBeNull();
  expect(pane(true)).toBeTruthy();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await tick();
  expect(pane(true)).toBeNull();
});
it("keeps streams attached across promotion/navigation, stops after moving, retries with a new ID, and reveals earlier sources", async () => {
  await send("root");
  await finish("AAAA original");
  await follow();
  const child = pane(true).dataset.conversationId;
  await send("continue", true);
  const run = requests.at(-1)!;
  await act(async () => run.chunk("partial"));
  await click("Open as main");
  await click("Stop response", pane());
  expect(run.signal.aborted).toBe(true);
  await act(async () => {
    run.chunk("late");
    run.resolve();
  });
  await tick();
  expect(pane().textContent).toContain("Stopped");
  expect(pane().textContent).not.toContain("late");
  await click("Retry response", pane());
  await click("Open root as main");
  await act(async () => {
    requests.at(-1)!.chunk("child completed");
    requests.at(-1)!.resolve();
  });
  await tick();
  const originalId = pane()
    .querySelector("[data-selectable]")!
    .getAttribute("data-message-content");
  await click("Retry response", pane());
  await finish("replacement source");
  expect(
    pane()
      .querySelector("[data-selectable]")!
      .getAttribute("data-message-content"),
  ).not.toBe(originalId);
  await click("continue", document.querySelector(".chat-list")!);
  expect(pane(true).dataset.conversationId).toBe(child);
  expect(pane(true).textContent).toContain("child completed");
  await click("Show in parent", pane(true));
  await tick();
  expect(pane().querySelector(".earlier-response")!.textContent).toContain(
    "AAAA original",
  );
  expect(
    pane().querySelector(".earlier-response [data-selectable]"),
  ).toBeNull();
  await send("after retry", true);
  await finish("ok");
  expect(requests.at(-1)!.messages.map((m) => m.content)).toContain(
    "AAAA original",
  );
  expect(requests.at(-1)!.messages.map((m) => m.content)).not.toContain(
    "replacement source",
  );
});
it("restores scrolled-away positions and bottom following across promotion and Back", async () => {
  await send("root");
  await finish("AAAA original");
  const mainScroll = pane().querySelector<HTMLElement>(".transcript")!;
  Object.defineProperties(mainScroll, {
    scrollHeight: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 300 },
  });
  await act(async () => {
    mainScroll.scrollTop = 120;
    mainScroll.dispatchEvent(new Event("scroll"));
  });
  await follow();
  await send("child", true);
  await finish("BBBB child");
  const sideScroll = pane(true).querySelector<HTMLElement>(".side-transcript")!;
  Object.defineProperties(sideScroll, {
    scrollHeight: { configurable: true, value: 1400 },
    clientHeight: { configurable: true, value: 300 },
  });
  await act(async () => {
    sideScroll.scrollTop = 240;
    sideScroll.dispatchEvent(new Event("scroll"));
  });
  await click("Open as main");
  expect(pane().querySelector(".transcript")!.scrollTop).toBe(240);
  await click("Back to previous workspace", pane());
  expect(pane().querySelector(".transcript")!.scrollTop).toBe(120);
  expect(pane(true).querySelector(".side-transcript")!.scrollTop).toBe(240);
  await click("Jump to latest message", pane(true));
  expect(sideScroll.scrollTop).toBe(1400);
  await click("Close side chat");
  await click("child", document.querySelector(".chat-list")!);
  // Newly mounted bottom followers use current height, not the former saved pixel offset.
  expect(pane(true).querySelector(".side-transcript")!.scrollTop).toBe(
    pane(true).querySelector(".side-transcript")!.scrollHeight,
  );
});
it("reveals sources only on navigation, repeats explicit reveals, and supports keyboard opening after popover dismissal", async () => {
  await send("root");
  await finish("AAAA original");
  await follow();
  await send("child", true);
  await finish("BBBB child");
  await click("Show in parent", pane(true));
  const source = pane().querySelector<HTMLElement>('[data-selectable="true"]')!;
  expect(document.activeElement).toBe(source);
  const scroll = pane().querySelector<HTMLElement>(".transcript")!;
  const focus = vi.spyOn(source, "focus");
  scroll.scrollTop = 200;
  await draft("child draft", true);
  expect(scroll.scrollTop).toBe(200);
  await click("Show in parent", pane(true));
  expect(focus).toHaveBeenCalled();
  await select();
  await act(async () => document.dispatchEvent(new Event("scroll")));
  expect(document.querySelector(".selection-popover")).toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    ),
  );
  await tick();
  expect(pane(true).querySelector("textarea")!.value).toBe("child draft");
  expect(document.activeElement).toBe(pane(true).querySelector("textarea"));
});
it("keeps narrow breadcrumbs reachable and shows the parent before its source child", async () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 600,
  });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("test")!);
  await act(async () => root.render(<ChatApp />));
  await tick();
  await send("root");
  await finish("AAAA original");
  await follow();
  expect(pane().hasAttribute("inert")).toBe(true);
  expect(
    pane(true).querySelector('[aria-label="Conversation path"]'),
  ).not.toBeNull();
  await send("child", true);
  await finish("BBBB child");
  await follow(true);
  expect(pane(true).querySelector("summary")?.getAttribute("aria-label")).toBe(
    "Intermediate conversations",
  );
  await click("Show in parent", pane(true));
  expect(pane(true)).toBeNull();
  expect(pane().hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(
    pane().querySelector('[data-selectable="true"]'),
  );
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
});

it("reveals source offsets inside horizontally clipped code", async () => {
  await send("root");
  await finish("```js\nAAAA very long line of source code\n```");
  await follow();
  const pre = pane().querySelector("pre")!;
  Object.defineProperties(pre, {
    scrollWidth: { configurable: true, value: 2000 },
    clientWidth: { configurable: true, value: 100 },
  });
  Range.prototype.getClientRects = () =>
    [new DOMRect(500, 0, 40, 20)] as unknown as DOMRectList;
  await click("Show in parent", pane(true));
  expect(pre.scrollLeft).toBeGreaterThan(0);
});

it("does not overwrite a visible reading position with hidden CSS geometry", async () => {
  await send("root");
  await finish("AAAA original");
  const mainScroll = pane().querySelector<HTMLElement>(".transcript")!;
  Object.defineProperties(mainScroll, {
    scrollHeight: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 300 },
  });
  await act(async () => {
    mainScroll.scrollTop = 120;
    mainScroll.dispatchEvent(new Event("scroll"));
  });
  await follow();
  pane().style.display = "none";
  mainScroll.scrollTop = 0;
  await act(async () => mainScroll.dispatchEvent(new Event("scroll")));
  await click("Open as main");
  await click("Back to previous workspace", pane());
  expect(pane().querySelector(".transcript")!.scrollTop).toBe(120);
});

it("creates roots rather than reusing empty children and dismisses stale selections on navigation", async () => {
  await send("root");
  await finish("AAAA original");
  await follow();
  const emptyChild = pane(true).dataset.conversationId;
  await click("Open as main");
  await click("New chat", pane());
  expect(pane().dataset.conversationId).not.toBe(emptyChild);
  expect(pane().textContent).toContain("What’s on your mind?");
  await click("root", document.querySelector(".chat-list")!);
  await select();
  expect(document.querySelector(".selection-popover")).not.toBeNull();
  await click("New chat", pane());
  expect(document.querySelector(".selection-popover")).toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    ),
  );
  expect(pane(true)).toBeNull();
});
