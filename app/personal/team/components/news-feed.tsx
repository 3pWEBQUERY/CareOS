"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { POST_IMPORTANCE } from "@/lib/team-news-shared";
import { SearchField, relativeTime } from "../../components/personal-ui";
import { FILTERS, postIcon } from "./news-utils";
import type { NewsViewState } from "./use-news-view";

export function NewsFeed({ r }: { r: NewsViewState }) {
  const {
    setDialog,
    channelId,
    setChannelId,
    filter,
    setFilter,
    query,
    setQuery,
    selectedId,
    now,
    news,
    data,
    run,
    select,
    posts,
    filtered,
    channels,
    active,
    tabs,
    unread,
  } = r;
  return (
    <section className="card team-feed-card">
      <div className="team-feed-header">
        <div>
          <p className="eyebrow">{active ? `Kanal · ${active.members} Mitglieder` : "Hausweiter Austausch"}</p>
          <h2 className="card-title">{active ? active.name : "Neuigkeiten im Team"}</h2>
          <p className="card-subtitle">{active?.description ?? `${filtered.length} von ${posts.length} Beiträgen`}</p>
        </div>
        <SearchField label="Neuigkeiten durchsuchen" query={query} setQuery={setQuery} placeholder="Suchen…" />
      </div>
      <div className="team-channel-tabs" role="group" aria-label="Teamkanäle">
        {tabs.map((channel) => (
          <button
            className={(channel?.id ?? null) === channelId ? "active" : ""}
            type="button"
            key={channel?.id ?? "all"}
            aria-pressed={(channel?.id ?? null) === channelId}
            onClick={() => setChannelId(channel?.id ?? null)}
          >
            {channel ? channel.name : "Alle Beiträge"}
            {channel?.unread ? ` · ${channel.unread}` : ""}
          </button>
        ))}
      </div>
      {active && !active.isDefault && (
        <div className="team-channel-bar">
          <small>
            {active.joined ? "Du bist Mitglied." : "Du bist nicht Mitglied – Beiträge erscheinen nicht in deinem Feed."}
            {active.managersOnly ? " Nur die Leitung schreibt hier." : ""}
          </small>
          <button
            className="quiet-button"
            type="button"
            onClick={() =>
              void run(
                `/api/team-news/channels/${active.id}`,
                { action: active.joined ? "leave" : "join" },
                active.joined ? `„${active.name}“ verlassen` : `„${active.name}“ beigetreten`,
              )
            }
          >
            {active.joined ? "Verlassen" : "Beitreten"}
          </button>
          {data?.canManage && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                setChannelId(null);
                void run(`/api/team-news/channels/${active.id}`, { action: "archive" }, `„${active.name}“ archiviert`);
              }}
            >
              Archivieren
            </button>
          )}
        </div>
      )}
      {channels.some((channel) => channel.canPost) && (
        <div className="team-composer">
          <span className="team-composer-icon">
            <ModuleIcon name="note" />
          </span>
          <div>
            <strong>Was gibt es Neues?</strong>
            <small>Teile eine Information mit deinem Arbeitsbereich</small>
          </div>
          <button className="primary-button" type="button" onClick={() => setDialog({ kind: "post", post: null })}>
            <ModuleIcon name="plus" /> Beitrag
          </button>
        </div>
      )}
      <div className="team-filter-row operations-filter-buttons" aria-label="Einträge filtern">
        {FILTERS.map((item) => (
          <button
            className={filter === item ? "active" : ""}
            type="button"
            key={item}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
        {unread > 0 && (
          <button
            type="button"
            className="team-read-all"
            onClick={() => void run("/api/team-news/read-all", { channelId }, "Alle Beiträge als gelesen markiert")}
          >
            Alle gelesen
          </button>
        )}
      </div>
      <div className="team-post-list">
        {filtered.map((post) => {
          const importance = POST_IMPORTANCE[post.importance];
          const open = selectedId === post.id;
          const badge = post.requiresAck
            ? post.acknowledgedAt
              ? { label: "Bestätigt", tone: "stable" }
              : { label: "Bestätigen", tone: "attention" }
            : !post.readAt
              ? { label: "Neu", tone: "info" }
              : post.importance !== "normal"
                ? importance
                : { label: "Gelesen", tone: "stable" };
          const showStats = post.canEdit && post.audience > 0;
          return (
            <article
              className={`team-post ${open ? "selected" : ""} ${post.readAt ? "" : "unread"} ${post.pinned ? "pinned" : ""}`}
              key={post.id}
              id={`post-${post.id}`}
            >
              <button className="team-post-main" type="button" aria-expanded={open} onClick={() => select(post)}>
                <span className={`governance-icon ${post.importance === "normal" ? "" : importance.tone}`}>
                  <ModuleIcon name={postIcon(post)} />
                </span>
                <span>
                  <strong>{post.title}</strong>
                  <small className={open ? "team-post-body" : ""}>
                    {open || post.body.length <= 180 ? post.body : `${post.body.slice(0, 180)} …`}
                  </small>
                  <em>
                    {post.pinned ? "Angeheftet · " : ""}
                    {relativeTime(post.createdAt, now)} · Kanal {post.channelName}
                    {post.editedAt ? " · bearbeitet" : ""}
                    {showStats
                      ? ` · ${post.requiresAck ? `${post.ackCount}/${post.audience} bestätigt` : `${post.readCount}/${post.audience} gelesen`}`
                      : ""}
                  </em>
                </span>
              </button>
              <div className="team-post-side">
                <span className={`status-badge ${badge.tone}`}>{badge.label}</span>
                <small>{post.authorName ?? "Unbekannt"}</small>
                {post.requiresAck && !post.acknowledgedAt ? (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() =>
                      void run(`/api/team-news/posts/${post.id}`, { action: "ack" }, "Gelesen und bestätigt")
                    }
                  >
                    Bestätigen
                  </button>
                ) : !post.readAt ? (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void run(`/api/team-news/posts/${post.id}`, { action: "read" })}
                  >
                    Gelesen
                  </button>
                ) : (
                  <button className="quiet-button" type="button" onClick={() => select(post)}>
                    {open ? "Schliessen" : "Öffnen"}
                  </button>
                )}
              </div>
              {open && (post.canEdit || data?.canManage) && (
                <div className="team-post-actions">
                  {post.isOwn && (
                    <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "post", post })}>
                      Bearbeiten
                    </button>
                  )}
                  {data?.canManage && (
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() =>
                        void run(
                          `/api/team-news/posts/${post.id}`,
                          { action: post.pinned ? "unpin" : "pin" },
                          post.pinned ? "Beitrag gelöst" : "Beitrag angeheftet",
                        )
                      }
                    >
                      {post.pinned ? "Lösen" : "Anheften"}
                    </button>
                  )}
                  {post.canEdit && (
                    <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "archive", post })}>
                      Archivieren
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {data && filtered.length === 0 && (
          <div className="resident-empty">
            <ModuleIcon name={posts.length ? "search" : "note"} />
            <strong>{posts.length ? "Keine Beiträge gefunden" : "Noch keine Beiträge"}</strong>
            <p>
              {posts.length ? "Suchbegriff oder Filter anpassen." : "Hier erscheinen Neuigkeiten aus deinen Kanälen."}
            </p>
          </div>
        )}
        {!data && news.loading && <p className="list-hint">Neuigkeiten werden geladen …</p>}
      </div>
    </section>
  );
}
