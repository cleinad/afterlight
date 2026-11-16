# Desktop implementation checkpoint

The contract remains [IMAGE_DESKTOP_SPEC.md](IMAGE_DESKTOP_SPEC.md), preserved unchanged. This implementation is incomplete: slice 1 has native evidence, slice 2 has source and focused tests but awaits packaged restart/export acceptance, and images are not implemented.

## Implemented

- Tauri 2 packages the existing Next.js/React UI as static assets, with plain CSS and no production Node server. Browser development keeps its proxy and memory-only state.
- Native Ollama requests use loopback only, with proxies and redirects disabled. Streams carry conversation/message/request identity, detect incomplete replies, retain provider errors, and cancel the HTTP future on Stop. Failed cancellation remains visible and keeps the run busy until native termination.
- SQLite uses `rusqlite`, bundled SQLite, foreign keys, WAL, FULL synchronization, transactional schema versioning, pre-migration consistent backups, and refusal of newer schemas. Conversations, drafts, messages, attempt models/states, frozen context/source snapshots, workspace, and selected model are stored outside the bundle. Unknown selection versions remain readable but cannot restore highlights.
- Native database work runs on blocking workers. One frontend writer serializes workspace revisions and coalesces pending writes. Drafts have a 250 ms maximum wait before a save attempt; continuous typing cannot postpone saving indefinitely. Crash loss also includes any in-flight write. Responses checkpoint once per second independently of the 32 ms display batching. Terminal state commits before successful completion becomes selectable.
- Send/Retry commits before inference, preserving the draft on write failure. Pending commits preserve newer draft edits. Save failures show a persistent alert and pause new sends until saving succeeds.
- Startup marks streaming attempts interrupted and retryable while retaining partial text. Normal quit flushes pending saves; failure requires an awaited native decision to exit without saving. Cancel keeps the app open.
- File → Export backup flushes frontend writes, opens a native destination picker, and uses SQLite's consistent backup API. It never exports by copying a live database file.

Images, attachment BLOBs/references, picker/paste/drop attachment UI, previews, vision capability discovery, and multimodal requests are not implemented. The required persistence/image integration review remains outstanding. Early shell review and a targeted persistence data-preservation review have been completed; their actionable findings were addressed.

## Run

Requires Apple Silicon macOS, Node.js 26+, current stable Rust/Cargo, Xcode command-line tools, and an independently installed Ollama. Rust/Cargo 1.99.1 was available for this checkpoint.

```sh
npm install
npm run desktop:dev         # native app + Next development server
npm run desktop:test        # Rust transport/database tests
npm run desktop:build       # unsigned release-identity .app
npm run desktop:acceptance  # unsigned .app with isolated acceptance identity
```

Both package commands write `src-tauri/target/release/bundle/macos/afterlight.app`; the last command determines its identity. Acceptance is not a release build to use for personal conversations. `npm run desktop:assets` builds only the static frontend in `out/`. Signing, notarization, deployment, and installation on another Mac were not performed.

## Data and recovery

The application resolves its data directory through Tauri's platform API. On macOS, the database is `~/Library/Application Support/<identifier>/afterlight.sqlite`, with WAL/SHM files as needed. Identities are:

| Build | Identifier |
| --- | --- |
| Release | `app.afterlight.desktop` |
| Development | `app.afterlight.desktop.dev` |
| Acceptance | `app.afterlight.desktop.acceptance` |

Data is ordinary local SQLite storage, not application-encrypted or synced. Relocating/updating the bundle does not determine the data path. There is no chat-deletion UI.

Use File → Export backup for a consistent standalone database. Never copy just a live `.sqlite` file while its journal/WAL may contain writes. On migration failure or newer-schema refusal, keep the original database and any generated `afterlight.before-v<version>-<timestamp>.sqlite` backup; do not reset the directory. Resolve filesystem errors or use a compatible newer app. A user-facing restore workflow is deferred. To inspect/reopen an export for acceptance, quit the acceptance app, preserve its existing isolated directory, and place the exported database in a fresh isolated acceptance directory as `afterlight.sqlite`. Do not replace release data as a test.

## Evidence on 2026-11-10

- Frontend: 34 tests and typecheck passed. Browser production build and desktop static export passed during this checkpoint; the final acceptance package rebuilt successfully after persistence review repairs.
- Native: all 4 tests passed, covering transport parser, transactional recovery/export, stale-write refusal, actual SQLite disk-full rollback, read-only failure, Retry/frozen-source retention, failed migration rollback, and newer-schema refusal are covered using temporary databases. Fixtures use isolated temporary paths.
- Slice 1 packaged app: real `qwen3:8b` main and side replies; stopped partial generation; Retry; closed-panel background completion; recursive follow-up creation; keyboard Cmd+Enter; prose/code/math/table selection and source reveal; reopening through Follow-ups. No afterlight Next server was running; an unrelated project's Next server was left untouched.
- Initial shell package: 15.26 MiB. Final storage acceptance package: 17.69 MiB. Initial app-process RSS sample: 19,520 KiB, before the real reply had visibly completed. This excludes WebKit children and model memory and is not a total-memory baseline. Launch-to-usable timing is unavailable because computer-use calls stalled; no performance improvement is claimed.
- Ollama service was reachable; installed inventory contained only `qwen3:8b`. No vision model has been verified.

Native screenshots returned blank images despite an accessible, interactive transcript. Native path launch/inspection calls stalled for long periods; later attempts to launch the changed acceptance identifier failed and Finder automation reported ScreenCaptureKit error -3812. The user was asked to open the acceptance artifact. These tool failures are not evidence that the app itself is blank or broken.

## Next required work

Open the isolated acceptance artifact and verify completed/interrupted restart round trips, drafts/workspace restoration, concurrent conversations, Retry provenance, quit-save failure decisions, and File → Export backup/reopening. Those packaged storage checks are outstanding; unit tests do not replace them. Recheck frontend/native tests and the package after any findings.

After slice 2's evidence gate passes, implement images/vision (slice 3), conduct the required persistence/image integration review, and complete the cumulative packaged matrix and performance baselines (slice 4). No image acceptance criteria have passed.
