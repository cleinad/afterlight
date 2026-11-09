import type { Message, ModelMessage } from "./types";

export const systemPrompt =
  "Be a thoughtful, clear conversational assistant. Answer directly and naturally, with only as much detail as useful. Use Markdown where it helps. For math, use $...$ inline and $$...$$ on separate lines for display equations. Use fenced code blocks with a language. Avoid unnecessary headings or follow-up questions.";

export function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages
    .filter((m) => m.content && m.status !== "error")
    .map(({ role, content }) => ({ role, content }));
}

export async function streamReply(
  model: string,
  messages: ModelMessage[],
  signal: AbortSignal,
  onText: (text: string) => void,
) {
  const response = await fetch("/ollama/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      think: false,
      keep_alive: "10m",
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      detail?.error || "Couldn’t reach Ollama. Run ollama serve, then retry.",
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(chunk.error);
    if (chunk.message?.content) onText(chunk.message.content);
    if (chunk.done) complete = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(consume);
      if (done) break;
    }
    consume(buffer);
    if (!complete)
      throw new Error(
        "The connection ended before the reply finished. Please retry.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
