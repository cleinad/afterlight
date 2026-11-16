import { invoke } from "@tauri-apps/api/core";

export function createQuitHandler(flush: () => Promise<void>, report: (message: string) => void) {
  let pending = false;
  return async () => {
    if (pending) return;
    pending = true;
    try {
      try { await flush(); }
      catch {
        if (!await invoke<boolean>("confirm_exit_without_saving")) return;
      }
      await invoke("finish_quit");
    } catch (error) {
      report(`Could not finish quitting: ${String(error)}. The app remains open.`);
    } finally { pending = false; }
  };
}
