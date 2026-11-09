# afterlight

afterlight turns questions into durable learning. Ask about a topic, highlight a passage, explore it in a side chat, and turn what you want to remember into flashcards.

## Product direction

This is a fresh implementation of Orchard's core chat experience. Orchard demonstrated strong highlighting and conversation branching, but its navigation, animations, and perceived inference speed motivated a smaller, faster rebuild. Preserve the quality of its highlighting while making the main chat feel immediate and reliable.

The current implementation is a chatbot you can talk to and highlight. Main chat and side chats are in scope. Conversation branching is deferred. Authentication, databases, durable chat history, and a separate backend service are outside the current scope; refreshing clears the page session. Flashcard generation is the product direction; it is not implemented yet.

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
- Select part of a completed main-chat response and choose **Ask a follow-up**. With browser caret browsing enabled, keyboard users can select text and press Cmd/Ctrl+Enter.
- Continue in the side panel. It receives the selected passage, main conversation through the source response, and its own message history. Side replies do not enter the main chat.
- Click a highlighted passage or its **Side chats** entry to reopen it. Escape closes the panel; closing it does not stop a response.
- **New chat** starts a fresh conversation. The sidebar switches between chats from the current page session. There is no persistent browser storage.

## Working in the code

| Area | Source |
| --- | --- |
| Chat state, navigation, side-chat context, and request lifecycle | [components/chat-app.tsx](components/chat-app.tsx) |
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

The tests cover the actual Markdown renderer and canonical DOM selections, plus split/incomplete streams, transport failures, and cancellation. These checks do not establish browser interaction or real-model performance. For UI or streaming changes, also exercise real main/side replies, selection and reopening across prose/code/math, Stop/Retry, navigation, scrolling, and narrow-screen behavior. Report what was checked and any remaining gaps.
