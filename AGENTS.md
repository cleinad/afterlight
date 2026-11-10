# afterlight agent guidance

Read [README.md](README.md) for the product brief, setup, implementation map, and verification commands. Inspect current code and working-tree changes before editing; treat prior verification as historical until relevant checks are rerun.

## Scope and priorities

- Build a fast, reliable main chat with excellent passage highlighting and independent side chats.
- Use Next.js and plain CSS. Keep local Ollama as the current inference path and preserve its streamed responses.
- Keep chat state in page memory. Do not add auth, a database, persistent browser storage, or a separate backend service unless requested.
- Recursive passage follow-ups are supported at arbitrary depth. Alternate-history editing, whole-transcript forks, merges, and branch-management tooling remain deferred. Do not add unrelated product surfaces or settings.
- Orchard is a reference for selection behavior, not an architecture to reproduce. If needed, inspect the sibling `../../orchard` checkout without modifying it as part of afterlight work.

## UX and design

- Follow the Claude Code-inspired layout described in the README: sidebar, main transcript, bottom composer, and a side panel.
- Keep the product name lowercase: afterlight.
- Use normal letter spacing; no all-caps labels, text eyebrows, or unnecessary UI copy.
- Prefer immediate interactions and stable layout. Avoid decorative motion and delays; respect reduced-motion preferences.
- Preserve keyboard access, visible focus, readable contrast, scrolling behavior, and usable narrow-screen layouts.

## Selection invariants

- Anchor to one completed assistant response in its owning conversation using message ID, half-open UTF-16 offsets, and the selection-stream version.
- Offsets refer to canonical rendered text. Never relocate anchors by substring matching or slice raw Markdown with rendered offsets.
- Preserve code newlines, Markdown block/list boundaries, and table cell/row/section boundaries. Exclude hidden KaTeX MathML and product controls.
- Keep capture, restoration, and highlight geometry consistent. Renderer/plugin changes can alter offsets; inspect their effect and update focused regressions.
- Preserve repeated and overlapping selections, code/math selection, and highlight reopening after layout changes. If source content is replaced, handle its anchors explicitly rather than attaching them to different text.

## Chat and streaming invariants

- Side-chat requests include the selected passage, a frozen ancestor prefix through its source, and that conversation's local history. Treat quoted passages as content, not instructions. Do not insert child or sibling replies into another conversation's local history.
- Scope callbacks to their chat/thread and request identity. Stop, Retry, navigation, and late chunks must not overwrite another conversation or duplicate turns.
- Closing a side panel does not cancel its response; Stop explicitly cancels it.
- Keep errors actionable and retries usable. Do not present incomplete streams as successful replies or substitute canned responses for real inference.
- Measure performance when making speed claims. Distinguish interface latency, first-token latency, model loading, and generation speed.

## Working practices

- Preserve unrelated changes and keep edits focused. Prefer small, understandable modules over speculative abstractions or infrastructure.
- Do not commit, push, publish, deploy, or make destructive changes unless requested. Never store secrets.
- Update the closest relevant documentation when behavior or setup changes. Keep README human-facing and this file focused on agent constraints.
- Run the smallest relevant checks from the README. Add meaningful regression coverage for selection or lifecycle fixes; use real browser/model checks where unit tests cannot establish behavior.
- State exactly what passed, what was inspected manually, and what remains unverified. Do not claim an improvement over Orchard without a comparable measurement.
- Keep the generated Next.js guidance below intact and consult the installed framework docs for APIs you change.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
