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
export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  draft: string;
  source: {
    conversationId: string;
    anchor: Anchor;
    messageSnapshot: Message;
  } | null;
  inheritedContext: ModelMessage[];
};
export type ConversationStore = Record<string, Conversation>;
export type Workspace = {
  mainId: string;
  sideId: string | null;
  sourceId?: string;
};
// The highlight renderer needs only an ID and anchor, independent of pane position.
export type Highlight = { id: string; anchor: Anchor };
export function newChat(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    draft: "",
    source: null,
    inheritedContext: [],
  };
}
