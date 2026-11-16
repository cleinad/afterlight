# afterlight desktop and image attachments

Status: proposed implementation contract; no desktop, persistence, or image support is implemented by this document.

## Outcome and scope

Ship a macOS Apple Silicon desktop version of afterlight using Tauri 2, the existing Next.js/React interface, plain CSS, and local Ollama. Users can attach images to main or recursive side chats and reopen their conversations after quitting. Preserve passage highlighting, frozen ancestor context, streaming, Stop/Retry, and side-to-main navigation.

Use SQLite for conversation data and original image bytes. Keep user data outside the application bundle. Start without a separate attachment folder or persistent thumbnail cache; these are optional later optimizations requiring evidence.

Out of scope: BYOK, Claude Code/Codex runtimes, accounts, cloud sync, a hosted database, embedded model weights, automatic Ollama installation, OCR pipelines, PDFs, image generation, image-region selection, transcript forks/merges, and a frontend-framework migration. Provider integrations belong in a separate branch/worktree. Windows, Linux, Intel Mac distribution, auto-update, and App Store submission are deferred.

## Current implementation

- [README.md](README.md) describes the browser app and verification commands. Chat state currently lives in page memory; restarting loses it. There is no durable state to migrate from previous releases.
- [lib/types.ts](lib/types.ts) defines text-only messages, per-conversation drafts, anchors, source snapshots, and frozen model context.
- [components/use-conversations.ts](components/use-conversations.ts) owns requests and batches stream rendering at 32 ms. [lib/ollama.ts](lib/ollama.ts) sends text-only requests through Next.js rewrites in [next.config.ts](next.config.ts).
- [components/chat-app.tsx](components/chat-app.tsx) owns workspace navigation and model selection. [components/composer.tsx](components/composer.tsx) currently requires nonempty text to send.

This spec authorizes a future persistence change in place of the current memory-only behavior. Until implementation, the README remains accurate about the running application.

## Desktop architecture

Package the Next.js frontend as static assets inside Tauri. A production launch must not start Node, Next.js, or a custom HTTP server. Retain the existing browser development command and memory-only browser behavior through a small runtime adapter; desktop persistence and image support must not silently fall back to memory if native initialization fails.

Use narrow Rust commands for storage, attachment access, Ollama model/capability discovery, starting a response, and cancelling it. Keep SQL and image encoding out of React. Select one maintained SQLite binding during the first implementation slice; do not expose arbitrary SQL, filesystem paths, shell execution, or arbitrary network destinations to the webview. Retain the existing conversation domain logic rather than recreating it in Rust.

Ollama remains an independently installed local service at `127.0.0.1:11434`. Native HTTP replaces Next.js forwarding in desktop mode. Preserve incremental parsing, incomplete-stream detection, actionable errors, `think: false`, and the current keep-alive behavior. No response may be replaced by a canned fallback. Missing Ollama must leave saved chats readable with a retryable connection message.

Each native stream event carries conversation ID, assistant message ID, and a unique request ID. The frontend accepts events only for the matching active run. Subscribe before starting a request; acknowledgement identifies that run. Cancellation aborts the actual HTTP request. Retire event subscriptions on termination. Closing a side panel or navigating does not cancel; Stop does. Quitting terminates active requests without marking them complete.

Single-instance desktop behavior prevents two app processes from racing on the same workspace. Heavy decoding, encoding, and database operations must not block the UI thread. Restrict capabilities and content security policy to bundled application content and required native operations; remote content cannot invoke commands. Block unrequested external resource loads from rendered messages, including remote Markdown images; use user-initiated external links through the system browser.

## Storage and data contract

Resolve the application data directory through platform APIs, never a hardcoded username or a path relative to the executable. An illustrative layout is:

```text
/Applications/afterlight.app/                         installed code/resources
~/Library/Application Support/<stable-app-id>/
  afterlight.sqlite                                 conversations and images
  afterlight.sqlite-wal / afterlight.sqlite-shm       if WAL mode is enabled
```

Choose a stable bundle identifier before distributing builds. Updating or relocating the `.app` must leave data intact. Development and test databases use distinct identities or explicitly isolated paths and must never open a user's release database. Keep databases, backups, and imported images out of Git. This is ordinary local storage, not application-level encryption; do not describe it as encrypted or synced.

Persist the following logical records; exact SQL is an implementation detail:

| Record | Required content |
| --- | --- |
| Conversation | Stable ID, title, creation/order metadata, text draft, source relationship, frozen inherited context |
| Message | Stable ID, owning conversation, order, role, Markdown content, explicit completion state, error, model used for the attempt |
| Source snapshot | Original assistant message ID and immutable content; selected text, half-open UTF-16 offsets, and selection-stream version |
| Attachment | Stable ID, original binary BLOB, validated MIME type, display filename, byte count, oriented width/height |
| Attachment reference | Ordered attachment IDs owned by a message, draft, or frozen context entry; enforce referential integrity for every owner type |
| Workspace | Last main/side/source view and selected model; validate IDs on restore |
| Schema metadata | Ordered migration version |

Extend user and model-context messages with ordered attachment IDs. Never store image base64 or object URLs in conversation JSON. Frozen context copies text and ordered IDs, not image bytes. Original image bytes are immutable; duplicates may have separate IDs in v1. Do not add deduplication infrastructure.

Preserve frozen text/context and source snapshots exactly across restarts and Retry. Retrying a parent must not rebind children to its replacement response or recompute their inherited context. Treat an unknown selection-stream version as unsupported, retain its data, and explain why its highlight cannot be restored; never relocate by substring matching.

Use versioned, transactional migrations and enabled foreign-key enforcement. Before upgrading an existing schema, create a consistent backup. On migration failure or a database newer than the app supports, preserve the original and present a recovery error; never reset or overwrite it automatically.

### Save ordering and recovery

- Finish importing an image and commit its draft reference in one transaction before showing it as saved. Failed imports leave no partial BLOB/reference. Capture the destination conversation when import begins; navigation cannot redirect a late result into another draft. Serialize draft mutations so removal, import completion, and Send cannot resurrect an attachment or lose newer edits.
- On Send, atomically commit the user message, its attachment references, cleared sent draft, and a streaming assistant attempt before inference starts. If that write fails, keep the draft and do not call Ollama. Image-only sends are valid.
- Commit child creation, frozen context references, and source provenance together before opening the child. Retry commits its replacement attempt without discarding retained child snapshots or the original user attachments.
- Serialize saves by conversation revision. A delayed draft or stream checkpoint cannot overwrite a newer message, terminal state, or workspace. Save draft text with a short debounce and flush on normal close; disclose and test the bounded crash-loss window.
- Checkpoint response text at most once per second, independently of 32 ms UI batching. Persist completion, Stop, and error immediately. Terminal writes must supersede queued checkpoints. Never show durable completion until its commit succeeds.
- On restart, recover attempts still marked streaming as interrupted and retryable, with the last saved partial text. Do not resume inference automatically or make partial replies selectable as completed sources.
- On disk-full or other write failures, retain visible text/drafts in memory, show a persistent save error, and pause new sends until saving succeeds. Do not claim those changes are saved. Normal quit flushes pending saves and offers retry or an explicit exit without saving if flushing fails.
- Closing a panel, changing the main conversation, or choosing New chat never deletes data. No chat-deletion UI is added. Removing a draft attachment deletes its BLOB only if no message, draft, or frozen context references it; cleanup and reference removal are transactional.

Provide a minimal native File → Export backup action using SQLite's consistent backup facility, including image BLOBs. Never instruct users to copy only the live database while journal/WAL files may contain writes. Acceptance includes opening an export against an isolated data directory; a user-facing restore workflow is deferred. Explain the data location and recovery procedure in the implementation README.

## Image interactions

The same composer behavior applies to main and side chats:

1. Attach through a keyboard-accessible file picker, image clipboard paste, or drop onto an explicit composer target. Preserve ordinary text paste. Reject ambiguous drops outside a composer instead of guessing the conversation.
2. Show ordered previews, importing/error state, accessible filenames and remove controls. Keep successful imports when another file fails. Block Send while imports are pending. Draft images follow their conversation between panes and survive restart once saved.
3. Allow text plus images or images alone. Enter sends, Shift+Enter inserts a newline, and IME composition remains respected. For an image-only first message, use the first image's display filename as a bounded title. Do not insert a hidden user prompt to manufacture text.
4. Display sent images with reserved dimensions to avoid layout shifts. Clicking or keyboard activation opens a larger in-app preview with a close control, Escape dismissal, and focus restoration. Keep originals unmodified and openable without Ollama.

Proposed v1 limits: PNG, JPEG, and static WebP; four images per message, 10 MiB per image, 25 MiB of original image bytes across the entire inference request, and 20 megapixels per image. These are application defaults, not claims about model limits. Validate actual bytes and bounded decoded dimensions in native code; reject corrupt, animated, mismatched, and unsupported files with an actionable reason. Do not trust file extensions or clipboard MIME labels. Check dimensions before allocating a full decode and bound concurrent imports. Revalidate clipboard and picker imports through the same path. Do not retain full source paths.

Generate previews on demand; there is no persistent thumbnail cache in v1. A thumbnail is an optional smaller display derivative, never the model input or the only retained image. Load BLOBs lazily for visible previews or an active inference request, not during sidebar/history hydration. Release object URLs and decoded previews when no longer used, and bound the preview cache.

## Vision requests and side-chat context

Discover vision capability from Ollama's model metadata rather than names or a hardcoded model list. Cache by model identity and refresh on reconnect/change. Unknown capability is not treated as vision support. Attachment import and history reading remain available with a text-only model, but Send/Retry must explain that a vision model is required whenever the effective request contains images, including inherited history. Never silently switch models or drop images. A capability-query failure is retryable.

Resolve ordered attachment IDs to bytes at the native request boundary. Encode only there into Ollama's documented per-message `images` arrays. Preserve image-only messages when building history. Keep the existing filtering/context semantics and quoted-source instruction boundary; attachments and their contents are untrusted source material.

A child receives the same frozen ancestor prefix through its source assistant message, with all image references in that prefix, the quoted passage, and its own local history. Further descendants inherit that frozen context. Sibling replies and future parent turns never leak into it. Retry uses the original local user message and images; unsent draft changes are excluded. Changing models still uses the same context and must pass capability checks again.

Preflight the whole effective request, including inherited images, against byte limits before base64 allocation and network transmission. If it exceeds a limit or a referenced BLOB is unavailable, block sending with a clear error and retain the draft/history. Do not truncate context, resize originals silently, omit attachments, or claim success after an incomplete stream. Provider context-size failures remain visible even if app limits pass.

Image previews and controls must not change the canonical selectable text of assistant Markdown. Preserve existing UTF-16 anchors, block/code/math/table boundaries, geometry recalculation, keyboard selection, and source reveal after images load or panes resize. Image-region anchors are outside scope.

## Implementation slices and evidence

| Slice | Deliverable | Required evidence before proceeding |
| --- | --- | --- |
| 1. Desktop shell and transport | Static Next.js build, Tauri window, single instance, native model discovery and cancellable streaming; memory-only initially | Packaged `.app` launches without Next/Node running; real Ollama main/side replies, Stop/Retry, background completion, keyboard and prose/code/math/table selection/reopening work in the macOS webview |
| 2. Durable conversations | SQLite schema, hydration, ordered writes, frozen context/snapshots, interrupted-run recovery, consistent export | Restart round trips, Retry provenance, draft/workspace restoration, concurrent conversations, disk/write failure injection, migration rollback/newer-schema refusal, and export reopening in isolated storage |
| 3. Images end to end | Picker/paste/drop, BLOBs, draft/message references, lazy previews, capability gating, multimodal context | Binary validation/limits, atomic import/send/removal, navigation during import, image-only send, real vision-model replies, text-only/unknown-capability errors, recursive image inheritance and Retry across restart |
| 4. Integration and handoff | Documentation, release build, cumulative review | Existing checks plus native tests pass; packaged-app acceptance matrix is exercised; actionable review findings resolved or explicitly recorded |

Continue running `npm test`, `npm run typecheck`, and `npm run build`. Add focused native database/transport tests and regression coverage for the new ownership and lifecycle boundaries. Read the installed Next.js docs before changing export/build configuration. Rust/Cargo is a new development prerequisite; document setup rather than silently installing system tooling.

Use one independent review at the persistence/image integration checkpoint, focusing on races, recovery, attachment retention, and selection invariants. Verify with temporary databases and fixtures, never real user data. Record native build/test commands after implementing them; do not present planned commands as verified.

Final manual acceptance must include quit/relaunch during a reply; completed and interrupted images/text; A → B → C side chats with inherited images; Retry retaining old-source highlights; navigation/import races; closed-panel background completion; image preview keyboard/focus behavior; narrow windows; and reopening saved images with Ollama unavailable. Include a real installed vision-capable model; ordinary qwen3:8b text checks do not establish vision support.

Record packaged artifact size, launch-to-usable time, and process memory with model state identified. These are baseline measurements, not promised improvements over the browser app or Orchard. Performance must not be inferred from framework choice alone.

The work is complete when all four slices meet their evidence requirements, data survives restart/export, original images and frozen references remain correct, and the packaged app preserves existing chat/selection behavior. Signing/notarization and distribution require a separate explicit request; local unsigned acceptance does not establish installation behavior on another Mac. Do not commit, publish, or deploy as part of implementation unless requested.

## Reference constraints

- [Tauri Next.js integration](https://v2.tauri.app/start/frontend/nextjs/) describes static export. Its example targets an earlier Next.js release; the installed framework docs govern implementation details.
- [Tauri architecture](https://v2.tauri.app/concept/architecture/) describes the webview/native boundary and bundled assets.
- [Apple file-system guidance](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html) describes application data placement.
- [Ollama vision](https://docs.ollama.com/capabilities/vision) documents image-capable models and REST base64 image inputs.
- [SQLite backup API](https://sqlite.org/backup.html) describes consistent database snapshots. Storage simplicity motivates BLOBs here; no relative-performance claim is assumed.
