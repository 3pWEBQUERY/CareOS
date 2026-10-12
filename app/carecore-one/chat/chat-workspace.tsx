"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowBendUpLeft,
  At,
  BellSlash,
  ChatsCircle,
  Checks,
  CheckSquare,
  Copy,
  DotsThree,
  DownloadSimple,
  FolderOpen,
  ListDashes,
  MagnifyingGlass,
  NotePencil,
  Paperclip,
  PaperPlaneTilt,
  PencilSimple,
  PushPin,
  SignOut,
  Smiley,
  TextB,
  TextItalic,
  Trash,
  UploadSimple,
  UserPlus,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useLiveEvent } from "@/app/components/live-events";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  MESSAGE_PRIORITIES,
  MESSAGE_REACTIONS,
  plainPreview,
  type ChatAttachment,
  type ChatMessage,
  type ChatPayload,
  type ChatSummary,
  type MessagePriority,
  type MessageReaction,
} from "@/lib/messenger-shared";
import { isTextEditable, prettyBytes, type ExplorerFile } from "@/lib/files-shared";
import { call, download, fileUrl } from "@/app/carecore-one/files/explorer-api";
import { FileIcon } from "@/app/carecore-one/files/file-icon";
import { NameDialog, PreviewDialog } from "@/app/carecore-one/files/explorer-dialogs";
import { AblagePickerDialog, AddMembersDialog, Avatar, NewChatDialog, Presence, TaskDialog } from "./chat-dialogs";
import { RichText, dayLabel, listTime, sameDay, time, wrapSelection } from "./chat-utils";

type Filter = "all" | "unread" | "groups" | "mentions";
type Tab = "chat" | "files" | "pinned";
type Pending = { id: string; name: string; mimeType: string; sizeBytes: number; uploading?: boolean };
type Dialog =
  | { kind: "new"; people: string[] }
  | { kind: "add" }
  | { kind: "rename" }
  | { kind: "task"; message: ChatMessage }
  | { kind: "ablage" }
  | { kind: "preview"; file: ExplorerFile }
  | null;

const QUICK_EMOJI = ["😊", "👍", "🙏", "❤️", "👏", "✅", "☕", "🎉"];
const GROUP_GAP = 5 * 60_000;

// Datei einer Nachricht für Vorschau und Download (gleiche Felder wie in der Ablage).
const asExplorerFile = (file: ChatAttachment): ExplorerFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  folderId: null,
  uploadedByName: null,
  updatedByName: null,
  createdAt: "",
  updatedAt: "",
  versionNo: 1,
  canEdit: false,
  deletedAt: null,
  path: file.source === "shared" ? "Gemeinsame Ablage" : "Datei im Chat",
});

export default function ChatWorkspace() {
  const requested = useSearchParams().get("conversation");
  const [data, setData] = useState<ChatPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requested);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("normal");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [listMenu, setListMenu] = useState<string | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [priorityMenu, setPriorityMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async (id: string | null) => {
    try {
      const payload = await call<ChatPayload>(`/api/conversations${id ? `?conversationId=${id}` : ""}`);
      setData((current) => {
        // Trennlinie „Neue Nachrichten“: beim Öffnen eines Chats ab der ersten ungelesenen Nachricht.
        if (id && loadedFor.current !== id) {
          loadedFor.current = id;
          const before = current?.conversations.find((item) => item.id === id);
          const unread = before?.unreadCount ?? 0;
          const messages = payload.conversation?.messages.filter((message) => message.kind === "text") ?? [];
          setUnreadFrom(unread > 0 ? (messages[messages.length - unread]?.id ?? null) : null);
        }
        return payload;
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nachrichten konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(selectedId), 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedId]);
  // Neue Nachrichten sofort (Echtzeit); zur Sicherheit jede Minute.
  useLiveEvent("messages", () => void load(selectedId));
  useEffect(() => {
    const timer = window.setInterval(() => void load(selectedId), 60_000);
    return () => window.clearInterval(timer);
  }, [load, selectedId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const conversation = data?.conversation ?? null;
  const actorId = data?.actor.id ?? "";
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);
  const lastId = messages.at(-1)?.id;
  // Beim Öffnen und bei neuen Nachrichten nach unten scrollen.
  useEffect(() => {
    if (tab !== "chat" || find) return;
    const box = feed.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lastId, selectedId, tab, find]);

  function open(id: string) {
    setSelectedId(id);
    setTab("chat");
    setReplyTo(null);
    setEditing(null);
    setPending([]);
    setText("");
    setFind("");
    setFindOpen(false);
    window.history.replaceState(null, "", `/c/carecore-one/messenger?conversation=${id}`);
  }

  async function post(json: Record<string, unknown>, success?: string) {
    try {
      const result = await call("/api/conversations", { method: "POST", json });
      if (success) setNotice(success);
      await load(selectedId);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt.");
      return null;
    }
  }

  const people = useMemo(() => (data?.people ?? []).filter((person) => person.id !== actorId), [data, actorId]);
  const personById = useMemo(() => new Map((data?.people ?? []).map((person) => [person.id, person])), [data]);
  const chats = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return (data?.conversations ?? []).filter((chat) => {
      if (filter === "unread" && !chat.unreadCount) return false;
      if (filter === "groups" && chat.kind === "direct") return false;
      if (filter === "mentions" && !chat.mentioned) return false;
      return !needle || `${chat.title} ${chat.lastMessage?.preview ?? ""}`.toLocaleLowerCase("de-CH").includes(needle);
    });
  }, [data, filter, query]);
  const pinnedChats = chats.filter((chat) => chat.pinned);
  const otherChats = chats.filter((chat) => !chat.pinned);
  const memberNames = conversation?.members.map((member) => member.name) ?? [];
  const pinnedMessages = messages.filter((message) => message.pinnedAt && !message.deleted);
  const partner = conversation?.partnerId ? personById.get(conversation.partnerId) : null;

  // Offene Erwähnung am Ende des Textes („@Ann“) und passende Mitglieder (in Gruppen auch „alle“).
  const mentionQuery = /(?:^|\s)@([^@\n]{0,40})$/u.exec(text)?.[1] ?? null;
  const mentionOptions =
    mentionQuery === null || !conversation
      ? []
      : [
          ...(conversation.kind !== "direct" && "alle".startsWith(mentionQuery.toLocaleLowerCase("de-CH"))
            ? [{ id: "alle", name: "alle", detail: "Alle Mitglieder benachrichtigen" }]
            : []),
          ...conversation.members
            .filter((member) => member.userId !== actorId)
            .filter((member) =>
              member.name.toLocaleLowerCase("de-CH").startsWith(mentionQuery.toLocaleLowerCase("de-CH")),
            )
            .map((member) => ({ id: member.userId, name: member.name, detail: member.jobTitle })),
        ].slice(0, 6);
  const insertMention = (name: string) => {
    setText((current) => current.replace(/@([^@\n]{0,40})$/u, `@${name} `));
    input.current?.focus();
  };

  async function attachFromDevice(list: FileList | null) {
    if (!list?.length || !selectedId) return;
    for (const file of Array.from(list).slice(0, 10)) {
      const temp = `upload-${crypto.randomUUID()}`;
      setPending((current) => [
        ...current,
        { id: temp, name: file.name, mimeType: file.type, sizeBytes: file.size, uploading: true },
      ]);
      const form = new FormData();
      form.append("conversationId", selectedId);
      form.append("file", file);
      try {
        const result = await call<{ file: ChatAttachment }>("/api/conversations", { method: "POST", body: form });
        setPending((current) => current.map((item) => (item.id === temp ? { ...result.file } : item)));
      } catch (cause) {
        setPending((current) => current.filter((item) => item.id !== temp));
        setError(cause instanceof Error ? cause.message : "Datei konnte nicht hochgeladen werden.");
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || busy || pending.some((file) => file.uploading)) return;
    if (editing) {
      if (!text.trim()) return;
      setBusy(true);
      await post({ action: "edit", messageId: editing.id, text });
      setEditing(null);
      setText("");
      setBusy(false);
      return;
    }
    if (!text.trim() && !pending.length) return;
    setBusy(true);
    const result = await post({
      action: "message",
      conversationId: selectedId,
      text,
      priority,
      replyToId: replyTo?.id,
      attachmentIds: pending.map((file) => file.id),
    });
    setBusy(false);
    if (result) {
      setText("");
      setPending([]);
      setReplyTo(null);
      setPriority("normal");
      setUnreadFrom(null);
    }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      if (mentionOptions.length) {
        event.preventDefault();
        insertMention(mentionOptions[0].name);
        return;
      }
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") {
      setReplyTo(null);
      if (editing) {
        setEditing(null);
        setText("");
      }
    } else if (event.key === "ArrowUp" && !text) {
      // Wie gewohnt: Pfeil nach oben bearbeitet die letzte eigene Nachricht.
      const own = [...messages]
        .reverse()
        .find((message) => message.authorId === actorId && message.kind === "text" && !message.deleted);
      if (own) {
        event.preventDefault();
        setEditing({ id: own.id, text: own.body });
        setText(own.body);
      }
    } else if ((event.metaKey || event.ctrlKey) && (event.key === "b" || event.key === "i")) {
      event.preventDefault();
      format(event.key === "b" ? "bold" : "italic");
    }
  }

  function format(kind: "bold" | "italic" | "list") {
    const area = input.current;
    if (!area) return;
    const next = wrapSelection(area, text, kind);
    setText(next.value);
    window.requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.start, next.end);
    });
  }

  // Textarea wächst mit (bis 8 Zeilen).
  useEffect(() => {
    const area = input.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  function jumpTo(messageId: string) {
    setTab("chat");
    setFind("");
    window.setTimeout(() => {
      const element = document.getElementById(`message-${messageId}`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.classList.add("is-flash");
      window.setTimeout(() => element?.classList.remove("is-flash"), 1600);
    }, 50);
  }

  function openAttachment(file: ChatAttachment) {
    if (!file.available) return;
    const type = file.mimeType.toLowerCase();
    if (
      type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.startsWith("audio/") ||
      type === "application/pdf" ||
      isTextEditable(file)
    )
      setDialog({ kind: "preview", file: asExplorerFile(file) });
    else download(fileUrl(file.id));
  }

  const seenBy = (message: ChatMessage) =>
    (conversation?.members ?? []).filter(
      (member) => member.userId !== actorId && member.lastReadAt && member.lastReadAt >= message.createdAt,
    );
  const ownLast = [...messages]
    .reverse()
    .find((message) => message.authorId === actorId && message.kind === "text" && !message.deleted);
  const visibleMessages = find.trim()
    ? messages.filter((message) =>
        message.body.toLocaleLowerCase("de-CH").includes(find.trim().toLocaleLowerCase("de-CH")),
      )
    : messages;

  const renderChatItem = (chat: ChatSummary) => {
    const person = chat.partnerId ? personById.get(chat.partnerId) : null;
    const own = chat.lastMessage && chat.lastMessage.authorName === data?.actor.displayName;
    return (
      <li
        key={chat.id}
        className={`chat-item ${chat.id === selectedId ? "active" : ""} ${chat.unreadCount ? "unread" : ""}`}
      >
        <button type="button" className="chat-item-main" onClick={() => open(chat.id)}>
          <Avatar name={chat.title} duty={person?.duty ?? null} group={chat.kind !== "direct"} />
          <span className="chat-item-copy">
            <strong>{chat.title}</strong>
            <small>
              {chat.lastMessage
                ? `${own ? "Du: " : chat.kind !== "direct" && chat.lastMessage.authorName ? `${chat.lastMessage.authorName.split(" ")[0]}: ` : ""}${chat.lastMessage.preview}`
                : "Noch keine Nachricht"}
            </small>
          </span>
          <span className="chat-item-meta">
            <time>{listTime(chat.lastMessage?.createdAt ?? chat.updatedAt)}</time>
            <span>
              {chat.muted && <BellSlash aria-label="Stummgeschaltet" />}
              {chat.mentioned && (
                <b className="chat-badge mention" aria-label="Du wurdest erwähnt">
                  @
                </b>
              )}
              {chat.unreadCount > 0 && (
                <b className="chat-badge" aria-label={`${chat.unreadCount} ungelesen`}>
                  {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                </b>
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="chat-item-more"
          aria-label={`Optionen für ${chat.title}`}
          aria-expanded={listMenu === chat.id}
          onClick={() => setListMenu((current) => (current === chat.id ? null : chat.id))}
        >
          <DotsThree weight="bold" />
        </button>
        {listMenu === chat.id && (
          <span className="chat-menu chat-list-menu" role="menu" onMouseLeave={() => setListMenu(null)}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setListMenu(null);
                void post({ action: "membership", conversationId: chat.id, pinned: !chat.pinned });
              }}
            >
              <PushPin aria-hidden="true" />
              {chat.pinned ? "Nicht mehr anheften" : "Oben anheften"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setListMenu(null);
                void post(
                  { action: "membership", conversationId: chat.id, muted: !chat.muted },
                  chat.muted ? "Benachrichtigungen wieder an" : "Stummgeschaltet – nur Erwähnungen und Dringendes",
                );
              }}
            >
              <BellSlash aria-hidden="true" />
              {chat.muted ? "Stummschaltung aufheben" : "Stummschalten"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!chat.lastMessage}
              onClick={() => {
                setListMenu(null);
                if (chat.id === selectedId) setSelectedId(null);
                void post({ action: "membership", conversationId: chat.id, unread: true });
              }}
            >
              <Checks aria-hidden="true" />
              Als ungelesen markieren
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <ModulePageShell activeModule="messenger" activeChild="Nachrichten" pageClass="messages-page chat-page">
      {() => (
        <main className="workspace chat-workspace">
          <section
            className={`chat-shell card ${peopleOpen && conversation ? "with-people" : ""}`}
            aria-label="Messenger"
          >
            <aside className="chat-list" aria-label="Chats">
              <header className="chat-list-head">
                <div>
                  <p className="eyebrow">Nachrichten</p>
                  <h1>Chat</h1>
                </div>
                <button
                  type="button"
                  className="chat-icon-button primary"
                  aria-label="Neuer Chat"
                  title="Neuer Chat"
                  onClick={() => setDialog({ kind: "new", people: [] })}
                >
                  <NotePencil weight="bold" />
                </button>
              </header>
              <label className="chat-search">
                <MagnifyingGlass aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Chats durchsuchen"
                  aria-label="Chats durchsuchen"
                />
              </label>
              <div className="chat-filters" role="group" aria-label="Filter">
                {(
                  [
                    ["all", "Alle"],
                    ["unread", "Ungelesen"],
                    ["mentions", "Erwähnungen"],
                    ["groups", "Gruppen"],
                  ] as Array<[Filter, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={filter === key ? "active" : ""}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chat-list-scroll">
                {pinnedChats.length > 0 && (
                  <>
                    <p className="chat-list-label">Angeheftet</p>
                    <ul>{pinnedChats.map(renderChatItem)}</ul>
                  </>
                )}
                <p className="chat-list-label">Zuletzt</p>
                <ul>{otherChats.map(renderChatItem)}</ul>
                {data && !chats.length && (
                  <p className="chat-list-empty">
                    {filter === "all" && !query
                      ? "Noch keine Unterhaltung. Starte einen Chat mit deinem Team."
                      : "Keine passenden Chats."}
                  </p>
                )}
                <p className="chat-list-label">Im Dienst</p>
                <ul className="chat-duty">
                  {people
                    .filter((person) => person.duty)
                    .slice(0, 12)
                    .map((person) => (
                      <li key={person.id}>
                        <button type="button" onClick={() => setDialog({ kind: "new", people: [person.id] })}>
                          <Avatar name={person.name} duty={person.duty} />
                          <span>
                            <strong>{person.name}</strong>
                            <small>
                              {person.dutyDetail || (person.duty === "present" ? "Im Dienst" : "Eingeteilt")}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  {data && !people.some((person) => person.duty) && (
                    <li className="chat-list-empty">Gerade niemand eingeteilt.</li>
                  )}
                </ul>
              </div>
            </aside>

            <section className="chat-main">
              {conversation ? (
                <>
                  <header className="chat-head">
                    <Avatar
                      name={conversation.title}
                      duty={partner?.duty ?? null}
                      group={conversation.kind !== "direct"}
                    />
                    <div className="chat-head-title">
                      <h2>{conversation.title}</h2>
                      <small>
                        {conversation.kind === "direct"
                          ? partner?.duty === "present"
                            ? `Im Dienst${partner.dutyDetail ? ` · ${partner.dutyDetail}` : ""}`
                            : partner?.duty === "planned"
                              ? `Eingeteilt${partner.dutyDetail ? ` · ${partner.dutyDetail}` : ""}`
                              : [partner?.jobTitle, partner?.careUnit].filter(Boolean).join(" · ") || "Direktnachricht"
                          : `${conversation.memberCount} Mitglieder${conversation.muted ? " · stummgeschaltet" : ""}`}
                      </small>
                    </div>
                    <nav className="chat-tabs" role="tablist" aria-label="Bereiche">
                      {(
                        [
                          ["chat", "Chat"],
                          ["files", `Dateien${conversation.files.length ? ` (${conversation.files.length})` : ""}`],
                          ["pinned", `Angeheftet${pinnedMessages.length ? ` (${pinnedMessages.length})` : ""}`],
                        ] as Array<[Tab, string]>
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={tab === key}
                          className={tab === key ? "active" : ""}
                          onClick={() => setTab(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </nav>
                    <span className="chat-head-actions">
                      <button
                        type="button"
                        className={`chat-icon-button ${findOpen ? "active" : ""}`}
                        aria-label="Im Chat suchen"
                        title="Im Chat suchen"
                        aria-pressed={findOpen}
                        onClick={() => {
                          setFindOpen((current) => !current);
                          setFind("");
                          setTab("chat");
                        }}
                      >
                        <MagnifyingGlass />
                      </button>
                      <button
                        type="button"
                        className={`chat-icon-button ${peopleOpen ? "active" : ""}`}
                        aria-label="Personen"
                        title="Personen"
                        aria-pressed={peopleOpen}
                        onClick={() => setPeopleOpen((current) => !current)}
                      >
                        <UsersThree />
                      </button>
                      {conversation.kind !== "direct" && (
                        <span className="chat-menu-anchor">
                          <button
                            type="button"
                            className="chat-icon-button"
                            aria-label="Gruppe verwalten"
                            aria-expanded={headerMenu}
                            onClick={() => setHeaderMenu((current) => !current)}
                          >
                            <DotsThree weight="bold" />
                          </button>
                          {headerMenu && (
                            <span className="chat-menu right" role="menu" onMouseLeave={() => setHeaderMenu(false)}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => (setHeaderMenu(false), setDialog({ kind: "rename" }))}
                              >
                                <PencilSimple aria-hidden="true" />
                                Gruppe umbenennen
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => (setHeaderMenu(false), setDialog({ kind: "add" }))}
                              >
                                <UserPlus aria-hidden="true" />
                                Personen hinzufügen
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                onClick={() => {
                                  setHeaderMenu(false);
                                  void post(
                                    { action: "removeMember", conversationId: conversation.id, userId: actorId },
                                    "Gruppe verlassen",
                                  ).then(
                                    (result) =>
                                      result &&
                                      (setSelectedId(null),
                                      window.history.replaceState(null, "", "/c/carecore-one/messenger")),
                                  );
                                }}
                              >
                                <SignOut aria-hidden="true" />
                                Gruppe verlassen
                              </button>
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </header>
                  {findOpen && (
                    <label className="chat-find">
                      <MagnifyingGlass aria-hidden="true" />
                      <input
                        autoFocus
                        value={find}
                        onChange={(event) => setFind(event.target.value)}
                        placeholder="In diesem Chat suchen"
                        aria-label="In diesem Chat suchen"
                      />
                      <span>{find.trim() ? `${visibleMessages.length} Treffer` : ""}</span>
                    </label>
                  )}
                  {tab === "chat" && pinnedMessages.length > 0 && !find && (
                    <button type="button" className="chat-pinned-bar" onClick={() => jumpTo(pinnedMessages.at(-1)!.id)}>
                      <PushPin weight="fill" aria-hidden="true" />
                      <span>
                        <strong>Angeheftet</strong>
                        {plainPreview(pinnedMessages.at(-1)!.body) || "Datei"}
                      </span>
                    </button>
                  )}

                  {tab === "chat" && (
                    <div className="chat-feed" ref={feed} role="log" aria-live="polite" aria-label="Verlauf">
                      {visibleMessages.map((message, index) => {
                        const previous = visibleMessages[index - 1];
                        const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
                        const own = message.authorId === actorId;
                        const grouped =
                          !newDay &&
                          previous &&
                          previous.kind === "text" &&
                          message.kind === "text" &&
                          previous.authorId === message.authorId &&
                          Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_GAP &&
                          message.id !== unreadFrom &&
                          !message.replyTo &&
                          message.priority === "normal";
                        const seen =
                          own && conversation.kind === "direct" && message.id === ownLast?.id ? seenBy(message) : [];
                        return (
                          <div key={message.id}>
                            {newDay && (
                              <p className="chat-day">
                                <span>{dayLabel(message.createdAt)}</span>
                              </p>
                            )}
                            {message.id === unreadFrom && !find && (
                              <p className="chat-unread-line">
                                <span>Neue Nachrichten</span>
                              </p>
                            )}
                            {message.kind === "system" ? (
                              <p className="chat-system" id={`message-${message.id}`}>
                                {message.body} <time>{time(message.createdAt)}</time>
                              </p>
                            ) : (
                              <article
                                id={`message-${message.id}`}
                                className={`chat-message ${own ? "own" : ""} ${grouped ? "grouped" : ""} ${message.priority !== "normal" ? `is-${message.priority}` : ""} ${message.mentions.includes(actorId) ? "mentions-me" : ""}`}
                                onMouseLeave={() => menu === message.id && setMenu(null)}
                              >
                                {!own && !grouped && <Avatar name={message.authorName} />}
                                <div className="chat-bubble-wrap">
                                  {!grouped && (
                                    <header>
                                      {!own && <strong>{message.authorName}</strong>}
                                      <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                                      {message.editedAt && !message.deleted && <span>bearbeitet</span>}
                                    </header>
                                  )}
                                  <div className="chat-bubble">
                                    {message.priority !== "normal" && !message.deleted && (
                                      <p className="chat-priority">
                                        <WarningCircle weight="fill" aria-hidden="true" />
                                        {message.priority === "urgent" ? "DRINGEND!" : "WICHTIG!"}
                                      </p>
                                    )}
                                    {message.pinnedAt && !message.deleted && (
                                      <p className="chat-pin-note">
                                        <PushPin weight="fill" aria-hidden="true" />
                                        Angeheftet{message.pinnedByName ? ` von ${message.pinnedByName}` : ""}
                                      </p>
                                    )}
                                    {message.replyTo && (
                                      <button
                                        type="button"
                                        className="chat-quote"
                                        onClick={() => jumpTo(message.replyTo!.id)}
                                      >
                                        <strong>{message.replyTo.authorName}</strong>
                                        <span>
                                          {message.replyTo.deleted
                                            ? "Nachricht gelöscht"
                                            : message.replyTo.body || "Datei"}
                                        </span>
                                      </button>
                                    )}
                                    {message.deleted ? (
                                      <p className="chat-deleted">Diese Nachricht wurde gelöscht.</p>
                                    ) : (
                                      message.body && (
                                        <div className="chat-text">
                                          <RichText text={message.body} names={memberNames} />
                                        </div>
                                      )
                                    )}
                                    {message.attachments.length > 0 && (
                                      <div className="chat-attachments">
                                        {message.attachments.map((file) => (
                                          <div key={file.id} className={`chat-file ${file.available ? "" : "gone"}`}>
                                            {file.available && file.mimeType.startsWith("image/") ? (
                                              <button
                                                type="button"
                                                className="chat-file-image"
                                                onClick={() => openAttachment(file)}
                                                aria-label={`${file.name} anzeigen`}
                                              >
                                                {/* Vorschau des geteilten Bildes (über die Datei-Schnittstelle, mit Zugriffsprüfung). */}
                                                <span style={{ backgroundImage: `url(${fileUrl(file.id, true)})` }} />
                                              </button>
                                            ) : null}
                                            <span className="chat-file-row">
                                              <FileIcon file={file} />
                                              <button
                                                type="button"
                                                className="chat-file-name"
                                                onClick={() => openAttachment(file)}
                                                disabled={!file.available}
                                              >
                                                <strong>{file.name}</strong>
                                                <small>
                                                  {file.available
                                                    ? `${prettyBytes(file.sizeBytes)}${file.source === "shared" ? " · Gemeinsame Ablage" : ""}`
                                                    : "Nicht mehr verfügbar"}
                                                </small>
                                              </button>
                                              {file.available && (
                                                <button
                                                  type="button"
                                                  className="chat-icon-button small"
                                                  aria-label={`${file.name} herunterladen`}
                                                  title="Herunterladen"
                                                  onClick={() => download(fileUrl(file.id))}
                                                >
                                                  <DownloadSimple />
                                                </button>
                                              )}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {message.reactions.length > 0 && (
                                    <div className="chat-reactions">
                                      {message.reactions.map((reaction) => (
                                        <button
                                          type="button"
                                          key={reaction.emoji}
                                          className={reaction.mine ? "mine" : ""}
                                          aria-pressed={reaction.mine}
                                          title={reaction.names.join(", ")}
                                          aria-label={`${reaction.emoji} ${reaction.count}: ${reaction.names.join(", ")}`}
                                          onClick={() =>
                                            void post({ action: "react", messageId: message.id, emoji: reaction.emoji })
                                          }
                                        >
                                          <span aria-hidden="true">{reaction.emoji}</span> {reaction.count}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {seen.length > 0 && (
                                    <p className="chat-seen">
                                      <Checks weight="bold" aria-hidden="true" />
                                      Gesehen
                                    </p>
                                  )}
                                </div>
                                {!message.deleted && (
                                  <div
                                    className={`chat-actions ${menu === message.id ? "open" : ""}`}
                                    role="toolbar"
                                    aria-label="Aktionen zur Nachricht"
                                  >
                                    {MESSAGE_REACTIONS.map((emoji: MessageReaction) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        aria-label={`Mit ${emoji} reagieren`}
                                        onClick={() => void post({ action: "react", messageId: message.id, emoji })}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      aria-label="Antworten"
                                      title="Antworten"
                                      onClick={() => {
                                        setReplyTo(message);
                                        setEditing(null);
                                        input.current?.focus();
                                      }}
                                    >
                                      <ArrowBendUpLeft />
                                    </button>
                                    <span className="chat-menu-anchor">
                                      <button
                                        type="button"
                                        aria-label="Weitere Aktionen"
                                        aria-expanded={menu === message.id}
                                        onClick={() =>
                                          setMenu((current) => (current === message.id ? null : message.id))
                                        }
                                      >
                                        <DotsThree weight="bold" />
                                      </button>
                                      {menu === message.id && (
                                        <span className={`chat-menu ${own ? "right" : ""}`} role="menu">
                                          {own && (
                                            <button
                                              type="button"
                                              role="menuitem"
                                              onClick={() => {
                                                setMenu(null);
                                                setEditing({ id: message.id, text: message.body });
                                                setReplyTo(null);
                                                setText(message.body);
                                                input.current?.focus();
                                              }}
                                            >
                                              <PencilSimple aria-hidden="true" />
                                              Bearbeiten
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                              setMenu(null);
                                              void post(
                                                { action: "pin", messageId: message.id, pinned: !message.pinnedAt },
                                                message.pinnedAt ? "Nicht mehr angeheftet" : "Für alle oben angeheftet",
                                              );
                                            }}
                                          >
                                            <PushPin aria-hidden="true" />
                                            {message.pinnedAt ? "Lösen" : "Anheften"}
                                          </button>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                              setMenu(null);
                                              setDialog({ kind: "task", message });
                                            }}
                                          >
                                            <CheckSquare aria-hidden="true" />
                                            Als Aufgabe übernehmen
                                          </button>
                                          {message.body && (
                                            <button
                                              type="button"
                                              role="menuitem"
                                              onClick={() => {
                                                setMenu(null);
                                                void navigator.clipboard
                                                  .writeText(message.body)
                                                  .then(() => setNotice("Text kopiert"));
                                              }}
                                            >
                                              <Copy aria-hidden="true" />
                                              Text kopieren
                                            </button>
                                          )}
                                          {own && (
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="danger"
                                              onClick={() => {
                                                setMenu(null);
                                                void post(
                                                  { action: "delete", messageId: message.id },
                                                  "Nachricht gelöscht",
                                                );
                                              }}
                                            >
                                              <Trash aria-hidden="true" />
                                              Löschen
                                            </button>
                                          )}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                )}
                              </article>
                            )}
                          </div>
                        );
                      })}
                      {!messages.length && (
                        <div className="chat-empty">
                          <ChatsCircle aria-hidden="true" />
                          <strong>Starte die Unterhaltung</strong>
                          <p>Schreib eine erste Nachricht, teile eine Datei oder erwähne jemanden mit @.</p>
                        </div>
                      )}
                      {find.trim() && !visibleMessages.length && (
                        <p className="chat-list-empty">Keine Nachricht mit „{find}“.</p>
                      )}
                    </div>
                  )}

                  {tab === "files" && (
                    <div className="chat-tab-panel">
                      {conversation.files.length ? (
                        <table className="files-table chat-files">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Geteilt von</th>
                              <th>Datum</th>
                              <th className="files-col-menu">
                                <span className="sr-only">Aktionen</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {conversation.files.map((file) => (
                              <tr key={file.id}>
                                <td>
                                  <span className="files-name">
                                    <FileIcon file={file} />
                                    <button
                                      type="button"
                                      className="files-name-link"
                                      onClick={() => openAttachment(file)}
                                    >
                                      {file.name}
                                    </button>
                                  </span>
                                </td>
                                <td>{file.sharedByName}</td>
                                <td>{`${dayLabel(file.sharedAt)}, ${time(file.sharedAt)}`}</td>
                                <td className="files-col-menu">
                                  <span className="chat-file-actions">
                                    <button
                                      type="button"
                                      className="chat-icon-button small"
                                      aria-label="Im Chat zeigen"
                                      title="Im Chat zeigen"
                                      onClick={() => jumpTo(file.messageId)}
                                    >
                                      <ChatsCircle />
                                    </button>
                                    <button
                                      type="button"
                                      className="chat-icon-button small"
                                      aria-label={`${file.name} herunterladen`}
                                      title="Herunterladen"
                                      onClick={() => download(fileUrl(file.id))}
                                    >
                                      <DownloadSimple />
                                    </button>
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="chat-empty">
                          <FolderOpen aria-hidden="true" />
                          <strong>Noch keine Dateien</strong>
                          <p>Dateien, die in diesem Chat geteilt werden, erscheinen hier gesammelt.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "pinned" && (
                    <div className="chat-tab-panel">
                      {pinnedMessages.length ? (
                        <ul className="chat-pinned-list">
                          {[...pinnedMessages].reverse().map((message) => (
                            <li key={message.id}>
                              <Avatar name={message.authorName} />
                              <span>
                                <strong>
                                  {message.authorName} · {dayLabel(message.createdAt)}, {time(message.createdAt)}
                                </strong>
                                <span className="chat-text">
                                  <RichText
                                    text={
                                      message.body || message.attachments.map((file) => `📎 ${file.name}`).join("\n")
                                    }
                                    names={memberNames}
                                  />
                                </span>
                              </span>
                              <button type="button" className="secondary-button" onClick={() => jumpTo(message.id)}>
                                Im Chat zeigen
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="chat-empty">
                          <PushPin aria-hidden="true" />
                          <strong>Nichts angeheftet</strong>
                          <p>
                            Wichtige Nachrichten (z. B. Telefonnummern, Abmachungen) über „⋯ › Anheften“ für alle oben
                            festhalten.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "chat" && (
                    <form
                      className={`chat-composer ${priority !== "normal" ? `is-${priority}` : ""} ${editing ? "is-editing" : ""}`}
                      onSubmit={send}
                    >
                      {mentionOptions.length > 0 && (
                        <div className="chat-mentions" role="listbox" aria-label="Person erwähnen">
                          {mentionOptions.map((option) => (
                            <button
                              type="button"
                              role="option"
                              aria-selected={false}
                              key={option.id}
                              onClick={() => insertMention(option.name)}
                            >
                              {option.id === "alle" ? (
                                <span className="chat-avatar is-group" aria-hidden="true">
                                  <At weight="bold" />
                                </span>
                              ) : (
                                <Avatar name={option.name} />
                              )}
                              <span>
                                <strong>{option.name}</strong>
                                {option.detail && <small>{option.detail}</small>}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {(replyTo || editing) && (
                        <div className="chat-composer-context">
                          {editing ? <PencilSimple aria-hidden="true" /> : <ArrowBendUpLeft aria-hidden="true" />}
                          <span>
                            <strong>{editing ? "Nachricht bearbeiten" : `Antwort an ${replyTo!.authorName}`}</strong>
                            {!editing && <small>{plainPreview(replyTo!.body) || "Datei"}</small>}
                          </span>
                          <button
                            type="button"
                            aria-label="Abbrechen"
                            onClick={() => {
                              setReplyTo(null);
                              if (editing) {
                                setEditing(null);
                                setText("");
                              }
                            }}
                          >
                            <X />
                          </button>
                        </div>
                      )}
                      {priority !== "normal" && (
                        <p className="chat-composer-priority">
                          <WarningCircle weight="fill" aria-hidden="true" />
                          {priority === "urgent"
                            ? "Dringend – alle Mitglieder werden sofort benachrichtigt"
                            : "Als wichtig markiert"}
                        </p>
                      )}
                      {pending.length > 0 && (
                        <div className="chat-pending">
                          {pending.map((file) => (
                            <span key={file.id} className={file.uploading ? "uploading" : ""}>
                              <FileIcon file={file} />
                              <span>
                                <strong>{file.name}</strong>
                                <small>{file.uploading ? "Wird hochgeladen …" : prettyBytes(file.sizeBytes)}</small>
                              </span>
                              <button
                                type="button"
                                aria-label={`${file.name} entfernen`}
                                onClick={() => setPending((list) => list.filter((item) => item.id !== file.id))}
                              >
                                <X />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <textarea
                        ref={input}
                        rows={1}
                        value={text}
                        maxLength={5000}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={onComposerKey}
                        onPaste={(event) => {
                          if (event.clipboardData.files.length) {
                            event.preventDefault();
                            void attachFromDevice(event.clipboardData.files);
                          }
                        }}
                        placeholder={editing ? "Nachricht bearbeiten" : "Nachricht schreiben – @ erwähnt jemanden"}
                        aria-label="Nachricht"
                      />
                      <div className="chat-toolbar">
                        <span className="chat-toolbar-group">
                          <button type="button" aria-label="Fett" title="Fett (Strg+B)" onClick={() => format("bold")}>
                            <TextB weight="bold" />
                          </button>
                          <button
                            type="button"
                            aria-label="Kursiv"
                            title="Kursiv (Strg+I)"
                            onClick={() => format("italic")}
                          >
                            <TextItalic />
                          </button>
                          <button
                            type="button"
                            aria-label="Aufzählung"
                            title="Aufzählung"
                            onClick={() => format("list")}
                          >
                            <ListDashes />
                          </button>
                          <span className="chat-menu-anchor">
                            <button
                              type="button"
                              aria-label="Emoji"
                              title="Emoji"
                              aria-expanded={emojiOpen}
                              onClick={() => setEmojiOpen((value) => !value)}
                            >
                              <Smiley />
                            </button>
                            {emojiOpen && (
                              <span
                                className="chat-menu chat-emoji up"
                                role="menu"
                                onMouseLeave={() => setEmojiOpen(false)}
                              >
                                {QUICK_EMOJI.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    role="menuitem"
                                    aria-label={emoji}
                                    onClick={() => {
                                      setText((current) => `${current}${emoji}`);
                                      setEmojiOpen(false);
                                      input.current?.focus();
                                    }}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </span>
                            )}
                          </span>
                          {!editing && (
                            <span className="chat-menu-anchor">
                              <button
                                type="button"
                                aria-label="Datei anhängen"
                                title="Datei anhängen"
                                aria-expanded={attachMenu}
                                onClick={() => setAttachMenu((value) => !value)}
                              >
                                <Paperclip />
                              </button>
                              {attachMenu && (
                                <span className="chat-menu up" role="menu" onMouseLeave={() => setAttachMenu(false)}>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => (setAttachMenu(false), fileInput.current?.click())}
                                  >
                                    <UploadSimple aria-hidden="true" />
                                    Vom Gerät hochladen
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => (setAttachMenu(false), setDialog({ kind: "ablage" }))}
                                  >
                                    <FolderOpen aria-hidden="true" />
                                    Aus der Ablage
                                  </button>
                                </span>
                              )}
                            </span>
                          )}
                          {!editing && (
                            <span className="chat-menu-anchor">
                              <button
                                type="button"
                                className={priority !== "normal" ? `is-${priority}` : ""}
                                aria-label="Wichtigkeit"
                                title="Wichtigkeit"
                                aria-expanded={priorityMenu}
                                onClick={() => setPriorityMenu((value) => !value)}
                              >
                                <WarningCircle />
                              </button>
                              {priorityMenu && (
                                <span className="chat-menu up" role="menu" onMouseLeave={() => setPriorityMenu(false)}>
                                  {(Object.keys(MESSAGE_PRIORITIES) as MessagePriority[]).map((key) => (
                                    <button
                                      key={key}
                                      type="button"
                                      role="menuitemradio"
                                      aria-checked={priority === key}
                                      className={priority === key ? "active" : ""}
                                      onClick={() => {
                                        setPriority(key);
                                        setPriorityMenu(false);
                                      }}
                                    >
                                      <WarningCircle
                                        weight={key === "normal" ? "regular" : "fill"}
                                        className={`is-${key}`}
                                        aria-hidden="true"
                                      />
                                      <span>
                                        {MESSAGE_PRIORITIES[key]}
                                        <small>
                                          {key === "normal"
                                            ? "Ohne Hervorhebung"
                                            : key === "important"
                                              ? "Hervorgehoben im Verlauf"
                                              : "Benachrichtigt alle Mitglieder sofort"}
                                        </small>
                                      </span>
                                    </button>
                                  ))}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        <span className="chat-toolbar-hint">Enter sendet · Umschalt+Enter neue Zeile</span>
                        <button
                          className="primary-button chat-send"
                          disabled={busy || pending.some((file) => file.uploading) || (!text.trim() && !pending.length)}
                          aria-label={editing ? "Änderung speichern" : "Nachricht senden"}
                        >
                          <PaperPlaneTilt weight="fill" />
                          <span>{editing ? "Speichern" : "Senden"}</span>
                        </button>
                      </div>
                      <input
                        ref={fileInput}
                        className="cloud-file-input"
                        type="file"
                        multiple
                        aria-label="Dateien für den Chat auswählen"
                        onChange={(event) => void attachFromDevice(event.target.files)}
                      />
                    </form>
                  )}
                </>
              ) : (
                <div className="chat-welcome">
                  <ChatsCircle aria-hidden="true" />
                  <h2>Willkommen im Chat</h2>
                  <p>
                    Direktnachrichten und Gruppen für das ganze Team – mit Dateien aus der Ablage, Aufgaben aus
                    Nachrichten und wer gerade im Dienst ist.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setDialog({ kind: "new", people: [] })}
                  >
                    <NotePencil aria-hidden="true" />
                    Neuer Chat
                  </button>
                </div>
              )}
            </section>

            {conversation && peopleOpen && (
              <aside className="chat-people" aria-label="Personen">
                <header>
                  <strong>
                    {conversation.kind === "direct" ? "Person" : `Mitglieder (${conversation.memberCount})`}
                  </strong>
                  {conversation.kind !== "direct" && (
                    <button
                      type="button"
                      className="chat-icon-button small"
                      aria-label="Personen hinzufügen"
                      title="Personen hinzufügen"
                      onClick={() => setDialog({ kind: "add" })}
                    >
                      <UserPlus />
                    </button>
                  )}
                </header>
                <ul>
                  {conversation.members.map((member) => (
                    <li key={member.userId}>
                      <Avatar name={member.name} duty={member.duty} />
                      <span>
                        <strong>
                          {member.name}
                          {member.userId === actorId ? " (ich)" : ""}
                        </strong>
                        <small>
                          {member.duty === "present"
                            ? `Im Dienst${member.dutyDetail ? ` · ${member.dutyDetail}` : ""}`
                            : member.duty === "planned"
                              ? `Eingeteilt${member.dutyDetail ? ` · ${member.dutyDetail}` : ""}`
                              : member.jobTitle || "Nicht im Dienst"}
                        </small>
                      </span>
                      {conversation.canManage && member.userId !== actorId && (
                        <button
                          type="button"
                          className="chat-icon-button small"
                          aria-label={`${member.name} entfernen`}
                          title="Aus der Gruppe entfernen"
                          onClick={() =>
                            void post(
                              { action: "removeMember", conversationId: conversation.id, userId: member.userId },
                              `${member.name} entfernt`,
                            )
                          }
                        >
                          <X />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="chat-people-legend">
                  <span>
                    <Presence duty="present" /> im Dienst
                  </span>
                  <span>
                    <Presence duty="planned" /> eingeteilt
                  </span>
                  <span>
                    <Presence duty={null} /> nicht im Dienst
                  </span>
                </p>
              </aside>
            )}
          </section>

          {(notice || error) && (
            <div className={`files-undo ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
              {error || notice}
              {error && (
                <button type="button" onClick={() => setError("")}>
                  Schliessen
                </button>
              )}
            </div>
          )}

          {dialog?.kind === "new" && (
            <NewChatDialog
              people={people}
              initial={dialog.people}
              onClose={() => setDialog(null)}
              onCreated={(id) => {
                setDialog(null);
                open(id);
              }}
            />
          )}
          {dialog?.kind === "add" && conversation && (
            <AddMembersDialog
              people={people}
              members={conversation.members}
              conversationId={conversation.id}
              onClose={() => setDialog(null)}
              onDone={() => {
                setDialog(null);
                setNotice("Personen hinzugefügt");
                void load(selectedId);
              }}
            />
          )}
          {dialog?.kind === "rename" && conversation && (
            <NameDialog
              eyebrow="Messenger · Gruppe"
              title="Gruppe umbenennen"
              label="Gruppenname"
              initial={conversation.title}
              submitLabel="Umbenennen"
              onClose={() => setDialog(null)}
              onSubmit={async (name) => {
                await call("/api/conversations", {
                  method: "POST",
                  json: { action: "rename", conversationId: conversation.id, title: name },
                });
                setDialog(null);
                await load(selectedId);
              }}
            />
          )}
          {dialog?.kind === "task" && conversation && (
            <TaskDialog
              text={dialog.message.body}
              author={dialog.message.authorName}
              members={conversation.members}
              actorId={actorId}
              onClose={() => setDialog(null)}
              onCreated={() => {
                setDialog(null);
                setNotice("Aufgabe erstellt");
              }}
            />
          )}
          {dialog?.kind === "ablage" && (
            <AblagePickerDialog
              onClose={() => setDialog(null)}
              onPick={(files) => {
                setDialog(null);
                setPending((list) => [
                  ...list,
                  ...files
                    .filter((file) => !list.some((item) => item.id === file.id))
                    .map((file) => ({
                      id: file.id,
                      name: file.name,
                      mimeType: file.mimeType,
                      sizeBytes: file.sizeBytes,
                    })),
                ]);
                input.current?.focus();
              }}
            />
          )}
          {dialog?.kind === "preview" && <PreviewDialog file={dialog.file} onClose={() => setDialog(null)} />}
        </main>
      )}
    </ModulePageShell>
  );
}
