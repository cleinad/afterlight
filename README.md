# afterlight

afterlight turns questions into durable learning. Ask about a topic, highlight a passage, explore it in a side chat, and turn what you want to remember into flashcards.

## Product direction

This is a fresh implementation of Orchard's core chat experience. Orchard demonstrated strong highlighting and conversation branching, but its navigation, animations, and perceived inference speed motivated a smaller, faster rebuild. Preserve the quality of its highlighting while making the main chat feel immediate and reliable.

The current implementation is a chatbot you can talk to and highlight. Recursive passage follow-ups are in scope: every conversation can open as main and its completed responses can create further follow-ups. Alternate-history editing, transcript forks, and merges are deferred. Authentication, databases, durable chat history, and a separate backend service are outside the current scope; refreshing clears the page session. Flashcard generation is the product direction; it is not implemented yet.

The visual reference is Claude Code's layout: a quiet navigation sidebar, a clear main reading area, a bottom composer, and a side panel for follow-ups. Use restrained typography and normal letter spacing. Avoid all-caps labels, text eyebrows, unnecessary explanatory copy, and decorative animations. Keep the name **afterlight** lowercase.

## Run locally

Requires Node.js 26+ and [Ollama](https://ollama.com).

Start Ollama if it is not already running, and install a model if needed:

```sh
ollama serve
# In another terminal, if the model is not installed:
ollama pull qwen3:8b
```

From the repository root:

```sh
npm install
npm run dev
```

Open [localhost:3001](http://localhost:3001). The model menu lists your installed Ollama models. For a production build, run `npm run build` then `npm start`.

Next.js forwards chat and model-list requests to Ollama at `127.0.0.1:11434`; there are no custom API routes. The app binds to loopback. Responses stream, thinking is disabled in the request, and UI updates are batched at 32 ms. Actual generation speed depends on the model, hardware, and context length.

## Using the app

- Enter sends; Shift+Enter inserts a newline. Stop cancels a response; Retry replaces the last assistant response.
- Select part of a completed assistant response in either pane and choose **Ask a follow-up**. With browser caret browsing enabled, keyboard users can select text and press Cmd/Ctrl+Enter.
- Continue in the side panel, or choose **Open as main** to explore further. Selecting in a side panel moves that conversation to main and opens its child beside it. Each child receives a frozen ancestor prefix through its source, the quoted passage, and its own local history. Sibling replies stay independent. Model context remains finite; provider errors are shown without silent truncation.
- Click a highlighted passage or its **Follow-ups** entry to reopen it. Breadcrumbs open ancestors; **Back** restores the previous workspace. **Show in parent** reveals the source range, including a read-only earlier response if Retry replaced it. On narrow screens this reveals the parent first.
- Escape dismisses a selection first, then closes the panel. Closing preserves background responses. Only Stop cancels generation. Drafts and reading positions follow each conversation between panes.
- **New chat** starts a fresh conversation. The sidebar switches between chats from the current page session. There is no persistent browser storage.

## Working in the code

| Area | Source |
| --- | --- |
| Navigation and recursive selection | [components/chat-app.tsx](components/chat-app.tsx) |
| Normalized conversations, frozen context, and requests | [lib/conversations.ts](lib/conversations.ts), [components/use-conversations.ts](components/use-conversations.ts) |
| Shared transcript, source previews, and reading state | [components/conversation-pane.tsx](components/conversation-pane.tsx) |
| Markdown, code, math, and highlight geometry | [components/markdown.tsx](components/markdown.tsx), [components/message.tsx](components/message.tsx) |
| Selection offsets and structural boundaries | [lib/selection.ts](lib/selection.ts), [lib/selection-stream.ts](lib/selection-stream.ts) |
| Ollama streaming and local forwarding | [lib/ollama.ts](lib/ollama.ts), [next.config.ts](next.config.ts) |
| Layout and visual styling | [app/globals.css](app/globals.css) |

Selection adapts Orchard's rendered-text index using the local `afterlight-markdown-v1` stream. Anchors store half-open UTF-16 offsets rather than searching for matching text. Structural newlines and table tabs are preserved; hidden MathML and copy controls are excluded. Highlights use restored DOM ranges without rewriting Markdown or syntax tokens, and are measured again when layout changes.

Keep changes small and readable. Protect selection correctness and request cancellation when improving performance. Agent-specific constraints are in [AGENTS.md](AGENTS.md).

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The tests cover the actual Markdown renderer and canonical DOM selections, plus recursive frozen context, workspace navigation, drafts/reading state, Retry provenance, split/incomplete streams, transport failures, and cancellation. These checks do not establish browser interaction or real-model performance. For UI or streaming changes, also exercise real main/side replies, selection and reopening across prose/code/math, Stop/Retry, navigation, scrolling, and narrow-screen behavior. Report what was checked and any remaining gaps.

Verification on 2026-11-09: 22 tests, typecheck, and the production build passed. Local qwen3:8b was exercised in the in-app browser at 1280 × 720 and 390 × 844: recursive A → B → C → D replies, side-to-main selection, Retry with an earlier-response highlight, source navigation/reopening, code/math/table selections, keyboard follow-up, Escape/focus restoration, a background child response completing while hidden, and Stop after promoting a running child to main. Fresh reviews found no outstanding actionable defects after repairs. Scroll races and horizontal source reveal also have deterministic regressions; exhaustive real-browser horizontal-scroll, delayed-font, screen-reader, and cross-browser checks remain unverified.
