// Messenger: Reaktionen und @Erwähnungen, gemeinsam für API und Oberfläche.

// Feste Auswahl, damit Reaktionen kurz und einheitlich bleiben.
export const MESSAGE_REACTIONS = ["👍", "❤️", "✅", "👀", "🙏"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

export type ReactionSummary = { emoji: MessageReaction; count: number; mine: boolean; names: string[] };

// Erwähnte Mitglieder: „@Vorname Nachname“ im Text. Längere Namen zuerst, damit „@Anna Müller-Meier“ nicht als
// „@Anna Müller“ gilt; Gross-/Kleinschreibung spielt keine Rolle.
export function mentionedMembers<T extends { user_id: string; display_name: string }>(text: string, members: T[]) {
  const lower = text.toLocaleLowerCase("de-CH");
  const found = new Set<string>();
  const sorted = [...members].sort((a, b) => b.display_name.length - a.display_name.length);
  let rest = lower;
  for (const member of sorted) {
    const needle = `@${member.display_name.toLocaleLowerCase("de-CH")}`;
    let index = rest.indexOf(needle);
    while (index >= 0) {
      const after = rest[index + needle.length];
      if (after === undefined || !/[\p{L}\p{N}-]/u.test(after)) {
        found.add(member.user_id);
        rest = `${rest.slice(0, index)}${" ".repeat(needle.length)}${rest.slice(index + needle.length)}`;
      }
      index = rest.indexOf(needle, index + 1);
    }
  }
  return [...found];
}

// „@alle“ erreicht alle Mitglieder einer Gruppe (wie „@channel“).
export const mentionsEveryone = (text: string) => /(^|\s)@alle(?![\p{L}\p{N}-])/iu.test(text);

// Wichtigkeit einer Nachricht: wichtig wird hervorgehoben, dringend benachrichtigt alle Mitglieder sofort.
export const MESSAGE_PRIORITIES = { normal: "Normal", important: "Wichtig", urgent: "Dringend" } as const;
export type MessagePriority = keyof typeof MESSAGE_PRIORITIES;

export type DutyState = "present" | "planned" | null;

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  // chat: in der Unterhaltung hochgeladen; shared: Datei der gemeinsamen Ablage (verknüpft)
  source: "chat" | "shared";
  available: boolean;
};

export type ChatMember = {
  userId: string;
  name: string;
  jobTitle: string;
  lastReadAt: string | null;
  duty: DutyState;
  dutyDetail: string;
};

export type ChatReply = { id: string; authorName: string; body: string; deleted: boolean };

export type ChatMessage = {
  id: string;
  kind: "text" | "system";
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  priority: MessagePriority;
  replyTo: ChatReply | null;
  mentions: string[];
  reactions: ReactionSummary[];
  attachments: ChatAttachment[];
  pinnedAt: string | null;
  pinnedByName: string | null;
};

export type ChatSummary = {
  id: string;
  title: string;
  kind: "direct" | "group" | "channel";
  createdBy: string | null;
  updatedAt: string;
  memberIds: string[];
  memberCount: number;
  partnerId: string | null;
  lastMessage: { preview: string; authorName: string | null; createdAt: string } | null;
  unreadCount: number;
  mentioned: boolean;
  pinned: boolean;
  muted: boolean;
};

export type ChatPerson = {
  id: string;
  name: string;
  role: string;
  jobTitle: string;
  careUnit: string;
  duty: DutyState;
  dutyDetail: string;
};

export type ChatFile = ChatAttachment & { sharedByName: string; sharedAt: string; messageId: string };

export type ChatConversation = ChatSummary & {
  members: ChatMember[];
  messages: ChatMessage[];
  files: ChatFile[];
  canManage: boolean;
};

export type ChatPayload = {
  actor: { id: string; displayName: string };
  conversations: ChatSummary[];
  people: ChatPerson[];
  selectedId: string | null;
  conversation: ChatConversation | null;
};

// Kurzform ohne Formatierung (Chatliste, Zitat, angeheftet): **fett**/_kursiv_ ohne Zeichen, Aufzählung in einer Zeile.
export function plainPreview(text: string, max = 140) {
  const plain = text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:!?])/g, "$1$2");
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
