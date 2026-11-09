export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "error" | "stopped";
  error?: string;
};

export type Anchor = {
  messageId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  streamVersion: "afterlight-markdown-v1";
};

export type SideChat = {
  id: string;
  anchor: Anchor;
  messages: Message[];
  draft: string;
};

export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  threads: SideChat[];
  draft: string;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function newChat(): Chat {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    threads: [],
    draft: "",
  };
}
