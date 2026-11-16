import { invoke } from "@tauri-apps/api/core";
import type { ConversationStore, Workspace } from "./types";

export type Snapshot = { revision: number; store: ConversationStore; workspace: Workspace | null; model: string };
// One writer owns the whole workspace revision. Pending saves coalesce; failures
// retain the newest snapshot and never permit an older checkpoint to win.
export class Persistence {
  snapshot: Snapshot = { revision: 0, store: {}, workspace: null, model: "qwen3:8b" };
  private pending: Snapshot | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: Promise<void>;
  constructor(private report: (error: string) => void) {}
  async load() { this.snapshot = await invoke<Snapshot>("load_workspace"); return this.snapshot; }
  stage(change: Partial<Omit<Snapshot, "revision">>) {
    this.snapshot = structuredClone({ ...this.snapshot, ...change, revision: this.snapshot.revision + 1 });
    this.pending = this.snapshot;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}); }, 250);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try { await invoke("save_workspace", { snapshot: next }); }
        catch (error) {
          if (!this.pending) this.pending = next;
          this.report(`Changes are not saved: ${String(error)}`);
          throw error;
        }
      }
      this.report("");
    })().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
  dispose() { clearTimeout(this.timer); }
}
