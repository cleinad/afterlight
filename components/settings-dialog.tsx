"use client";
import { useEffect, useRef, useState } from "react";
import { defaultPersonalityPrompt } from "@/lib/ollama";
import { Icon } from "./icons";

export function SettingsDialog({
  prompt, model, models, connection, onReconnect, onSave, onClose,
}: {
  prompt: string;
  model: string;
  models: string[];
  connection: "checking" | "ready" | "error";
  onReconnect: () => void;
  onSave: (prompt: string, model: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState("Prompt");
  const [draft, setDraft] = useState(prompt);
  const [draftModel, setDraftModel] = useState(model);
  const changed = draft !== prompt || draftModel !== model;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <header className="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button className="icon-button" aria-label="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {["Prompt", "General"].map((name) => (
            <button
              key={name}
              aria-pressed={section === name}
              onClick={() => setSection(name)}
            >
              <Icon name={name === "Prompt" ? "chat" : "settings"} />
              {name}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "Prompt" ? (
            <section aria-labelledby="prompt-title">
              <h3 id="prompt-title">Prompt</h3>
              <label htmlFor="personality-prompt">Personality and response style</label>
              <p id="prompt-help">Set the tone, level of detail, and structure of answers. Applies to future replies and retries in all chats, including follow-ups.</p>
              <textarea
                id="personality-prompt"
                aria-describedby="prompt-help"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              <div className="prompt-actions">
                <button
                  className="settings-button"
                  disabled={draft === defaultPersonalityPrompt}
                  onClick={() => setDraft(defaultPersonalityPrompt)}
                >Restore default</button>
              </div>
            </section>
          ) : (
            <section aria-labelledby="general-title">
              <h3 id="general-title">General</h3>
              <div className="settings-row">
                <div>
                  <label htmlFor="settings-model">Default model</label>
                  <p>Used for your next reply in any chat.</p>
                </div>
                <select id="settings-model" value={draftModel} onChange={(e) => setDraftModel(e.target.value)}>
                  {[...new Set([draftModel, ...models])].map((name) => <option key={name}>{name}</option>)}
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <h4>Local inference</h4>
                  <p role="status">{connection === "ready" ? "Connected to Ollama" : connection === "checking" ? "Connecting to Ollama…" : "Ollama is offline. Start Ollama, then reconnect."}</p>
                </div>
                <button className="settings-button" disabled={connection === "checking"} onClick={onReconnect}>Reconnect</button>
              </div>
            </section>
          )}
        </div>
      </div>
      <footer className="settings-actions">
        <button className="settings-button" onClick={onClose}>Cancel</button>
        <button className="settings-button primary" disabled={!changed} onClick={() => { onSave(draft, draftModel); onClose(); }}>Save changes</button>
      </footer>
    </dialog>
  );
}
